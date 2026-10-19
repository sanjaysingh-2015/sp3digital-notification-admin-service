# sp3digital-notification-service

One place that delivers messages for the whole SP3 Digital platform. Other services say
**which template** to send and **with what values**; this service renders it with the
tenant's wording, queues it, delivers it in the background with retries, respects
suppression and quiet hours, and keeps a delivery log. **Email** today; SMS or WhatsApp
plug in behind the same API (`channel` is a column everywhere; add an adapter in
`src/providers/`).

Same stack and layering as the other services: Node + Express 5 + Sequelize + MySQL,
controller → service → model, Joi validation, Swagger at `/docs`, JWTs from
`sp3digital-identity-admin-service`, strict tenant isolation.

## How it works

```
caller ──POST /notifications──▶ render template ──▶ outbox row (PENDING) ──202──▶ caller
                                                        │
                      delivery worker (every 5 s) ◀─────┘  claims due rows, sends, retries
                              │
                    SENT (text wiped) · retry later · FAILED · SUPPRESSED
```

| Piece | What it does |
|---|---|
| **Templates** | Platform defaults (appointment confirmation / reminder / cancelled / rescheduled, password changed, test) written at start-up; a tenant can reword any of them. `{{name}}` and `{{#name}}…{{/name}}` (shown only when not empty) — no code runs in a template. Variables are HTML-escaped and stripped of line breaks in the subject, so they can never inject markup or mail headers. A tenant may use only the template's declared variables; scripts, iframes, forms and `on…=` handlers are refused. |
| **Outbox + retries** | Rows are claimed with a conditional UPDATE, so two workers never send the same message. Failures retry after 1 min, 5 min, 30 min, 2 h, 6 h (`MAX_ATTEMPTS`, default 5). A worker that dies releases its rows after 5 minutes. Every attempt is logged. |
| **Idempotency** | The same `idempotencyKey` returns the first notification (HTTP 200) instead of sending again. |
| **Scheduling** | `scheduledAt` holds a message until then (a reminder for tomorrow morning). |
| **Suppression** | Unsubscribed / bounced / complained / manual. A hard bounce (SMTP 550/551/553/554 on the recipient) fails at once and blocks the address for every category. An opt-out covers every category **except SECURITY** (a "password changed" notice still goes out). Checked when queued **and** again when sent. |
| **Quiet hours** | Per tenant (e.g. 21:00–07:00 in `NOTIFICATION_TIMEZONE`): **reminders only** wait until the window ends. Waiting is not a failed attempt. |
| **Limits** | Per tenant per hour (default 500, configurable); max 10 per recipient per hour. Over the limit means *held back*, never dropped. |
| **Sender identity** | With no settings, the platform's mail account sends. A tenant can set its name/reply address (the platform still sends, tenant address becomes Reply-To so SPF/DKIM keep passing) or bring its **own SMTP account** (then From is the tenant's address). The SMTP password is stored **AES-256-GCM encrypted** and is never returned. |
| **Never fails the caller** | A switched-off channel or a suppressed address answers 202 with the row logged as `SUPPRESSED`, so a booking never fails because of email trouble. |

## Privacy

A health-care message can name a patient and an appointment, so: templates say *that* and
*when/where*, never *why*; the rendered text is **wiped the moment a message is delivered**
(only metadata stays; failed ones keep their text for diagnosis); recipients are **always
masked** in responses (`a***@example.com`) and the text is never returned; everything
finished is purged after `NOTIFICATION_RETENTION_DAYS` (default 90, `npm run purge`).

## API (base `/api/v1/notification`)

| Method | Path | Permission |
|---|---|---|
| POST | `/notifications` — queue one (202) | `notification:send` |
| GET | `/notifications`, `/notifications/:id` — delivery log + attempts | `notification:read` |
| POST | `/notifications/:id/cancel`, `/notifications/:id/retry`, `/notifications/cancel-by-source` | `notification:update` |
| GET / POST | `/templates`, `/templates/:key`, `/templates/preview` | `template:read` |
| PUT / DELETE | `/templates/:key` — reword / revert for the tenant | `template:manage` |
| GET / PUT | `/settings/email`; POST `/settings/email/test` | `settings:manage` |
| GET / POST | `/suppressions`; POST `/suppressions/:id/lift` | `suppression:manage` |

All permissions are `notification-admin:…`, granted to **Tenant admin** by
`database/seeds/identity-admin-notification-rbac.sql`.

### Sending from another service

Services do not use a user's permissions: they send on a tenant's behalf with the shared
`NOTIFICATION_SERVICE_INTERNAL_TOKEN` and an `X-Tenant-Uuid` header.

```js
await axios.post(`${NOTIFICATION_URL}/notifications`, {
  templateKey: 'APPOINTMENT_REMINDER',
  to: { address: patient.email, name: patient.displayName },
  variables: { patientName, appointmentDate, startTime, serviceName, facilityName, doctorName, tokenNumber },
  scheduledAt: reminderTime,                       // omit to send now
  idempotencyKey: `appointment:${id}:reminder`,    // a retry of YOUR request never double-sends
  sourceService: 'appointment-admin-service',
  sourceRef: `appointment:${id}`,                  // lets you cancel it later
}, { headers: { Authorization: `Bearer ${INTERNAL_TOKEN}`, 'X-Tenant-Uuid': tenantUuid } });

// the appointment was cancelled: stop the reminder
await axios.post(`${NOTIFICATION_URL}/notifications/cancel-by-source`,
  { sourceService: 'appointment-admin-service', sourceRef: `appointment:${id}` }, { headers });
```

The appointment service already plans reminders (`tenant_notification_settings`,
`appointment_reminders`): it decides **when**; this service does the **delivery**. Its
`template_code` is a template key here. Wiring that up is the next step.

## Setup

```bash
cp .env.example .env      # DB credentials, JWT values, internal token, mail settings — never commit .env
npm install
mysql -u <user> -p < database/complete_db_script/script-sp3digital_notifications.sql
mysql -u <user> -p sp3digital_identity < database/seeds/identity-admin-notification-rbac.sql
npm run dev               # http://localhost:3500/docs
npm test                  # 24 tests: in-memory SQLite + a real local SMTP server
```

- `EMAIL_TRANSPORT=log` (default) prints a line and sends nothing — safe for development.
  Use `smtp` with `SMTP_HOST`/… for real delivery.
- Generate `NOTIFICATION_ENCRYPTION_KEY` with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`; without it tenants
  cannot save their own SMTP password.
- The API process also runs the delivery loop. For a separate worker set `NOTIFICATION_WORKER=false`
  on the API and run `npm run worker`.
- Schedule `npm run purge -- --apply` nightly (the bare `npm run purge` is a dry run).
- MySQL runs locally for now; for a cloud database set `DB_HOST`/credentials and `DB_SSL=true`.

## Not built yet

SMS / WhatsApp adapters; a public unsubscribe link and consent records (you said consent will
be added — `CONSENT_WITHDRAWN` is already a suppression reason); provider delivery webhooks
(bounces that arrive later); a UI (the delivery log, templates and settings are API-only for now).
