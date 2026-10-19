const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

process.env.DB_DIALECT = 'sqlite';
process.env.ADMIN_JWT_SECRET = 'test-only-shared-secret';
process.env.ADMIN_JWT_AUDIENCE = 'sp3-notification-test';
process.env.NOTIFICATION_SERVICE_INTERNAL_TOKEN = 'test-internal-token';
process.env.NOTIFICATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
process.env.EMAIL_TRANSPORT = 'memory';
process.env.MAIL_FROM_ADDRESS = 'no-reply@sp3.example';
process.env.MAIL_FROM_NAME = 'SP3 Digital';
process.env.NOTIFICATION_TIMEZONE = 'Asia/Kolkata';
process.env.MAX_ATTEMPTS = '3';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const tokenFor = (tenantUuid, permissions, userId = 9) =>
  jwt.sign({ tenant_uuid: tenantUuid, user_id: userId, permissions }, process.env.ADMIN_JWT_SECRET, { audience: process.env.ADMIN_JWT_AUDIENCE, expiresIn: '5m' });

const ALL = [
  'notification-admin:notification:send', 'notification-admin:notification:read', 'notification-admin:notification:update',
  'notification-admin:template:read', 'notification-admin:template:manage', 'notification-admin:settings:manage', 'notification-admin:suppression:manage',
];
const admin = tokenFor(TENANT_A, ALL);
const adminB = tokenFor(TENANT_B, ALL);
const reader = tokenFor(TENANT_A, ['notification-admin:notification:read']);

// "Now" is pinned and moved by the tests: Wednesday 14 Oct 2026, 10:00 in Kolkata.
let current = new Date('2026-10-14T04:30:00Z');
const setNow = (iso) => { current = new Date(iso); };
const advance = (minutes) => { current = new Date(current.getTime() + minutes * 60000); };

let server;
let baseUrl;
let db;
let outbox;
let dispatcher;

test.before(async () => {
  const { clock } = require('../src/utils/clock');
  clock.now = () => current;
  const app = require('../src/app');
  db = require('../src/models');
  await db.sequelize.sync({ force: true });
  await require('../src/services/templateService').ensureDefaults();
  dispatcher = require('../src/worker/dispatcher');
  outbox = require('../src/providers/emailProvider').outbox;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { await new Promise((resolve) => server.close(resolve)); });

async function call(method, path, { token, body, headers } = {}) {
  const response = await fetch(`${baseUrl}/api/v1/notification${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const APPOINTMENT = { patientName: 'Asha Verma', appointmentDate: 'Wed, 21 Oct 2026', startTime: '11:00', serviceName: 'General consultation', facilityName: 'SP Healthcare', doctorName: 'Dr. Rao', tokenNumber: 'T003' };
const send = (over = {}, token = admin) =>
  call('POST', '/notifications', { token, body: { templateKey: 'APPOINTMENT_CONFIRMATION', to: { address: 'asha@example.com', name: 'Asha Verma' }, variables: APPOINTMENT, ...over } });
const run = () => dispatcher.processDue();

test.beforeEach(async () => {
  setNow('2026-10-14T04:30:00Z');
  outbox.length = 0;
  await db.Notification.destroy({ where: {} });
  await db.NotificationSuppression.destroy({ where: {} });
  await db.TenantChannelSetting.destroy({ where: {} });
  await db.NotificationTemplate.destroy({ where: { tenant_uuid: TENANT_A } });
});

test('who may call it: nobody without a token, readers cannot send, other services use the internal token', async () => {
  assert.equal((await call('GET', '/notifications')).status, 401);
  assert.equal((await call('GET', '/notifications', { token: reader })).status, 200);
  assert.equal((await send({}, reader)).status, 403);
  assert.equal((await call('GET', '/templates', { token: reader })).status, 403);

  const viaService = await call('POST', '/notifications', {
    token: 'test-internal-token', headers: { 'X-Tenant-Uuid': TENANT_A },
    body: { templateKey: 'APPOINTMENT_CONFIRMATION', to: { address: 'asha@example.com' }, variables: APPOINTMENT },
  });
  assert.equal(viaService.status, 202, JSON.stringify(viaService.json));
});

test('the platform templates are in place', async () => {
  const list = await call('GET', '/templates', { token: admin });
  assert.deepEqual(list.json.data.map((t) => t.templateKey).sort(), ['APPOINTMENT_CANCELLED', 'APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_RESCHEDULED', 'PASSWORD_CHANGED', 'TEST_EMAIL']);
  assert.ok(list.json.data.every((t) => t.isOverridden === false));
  assert.equal(list.json.data.find((t) => t.templateKey === 'PASSWORD_CHANGED').category, 'SECURITY');
});

test('queueing validates the request and reports what is missing', async () => {
  assert.equal((await send({ variables: { patientName: 'Asha' } })).json.error.code, 'MISSING_VARIABLES');
  const missing = (await send({ variables: { patientName: 'Asha' } })).json.error.details;
  assert.ok(missing.includes('appointmentDate') && missing.includes('facilityName'));
  assert.equal((await send({ templateKey: 'NO_SUCH_TEMPLATE' })).json.error.code, 'TEMPLATE_NOT_FOUND');
  assert.equal((await send({ to: { address: 'not-an-email' } })).status, 400);
  assert.equal((await send({ channel: 'SMS' })).status, 400); // not available yet
  assert.equal((await send({ variables: { ...APPOINTMENT, nested: { a: 1 } } })).status, 400); // values are plain text only
});

test('delivery: rendered with the values, HTML-escaped, sent from the platform address, then the text is wiped', async () => {
  const queued = await send({ variables: { ...APPOINTMENT, patientName: '<b>Asha</b> & Co' } });
  assert.equal(queued.status, 202);
  assert.equal(queued.json.status, 'PENDING');
  assert.equal(outbox.length, 0); // nothing leaves until the worker runs

  const tally = await run();
  assert.deepEqual([tally.claimed, tally.sent], [1, 1]);
  const mail = outbox[0];
  assert.equal(mail.to, 'asha@example.com');
  assert.equal(mail.subject, 'Your appointment on Wed, 21 Oct 2026 at 11:00');
  assert.match(mail.text, /Hello <b>Asha<\/b> & Co/);          // plain text is not escaped
  assert.match(mail.html, /Hello &lt;b&gt;Asha&lt;\/b&gt; &amp; Co/); // HTML is
  assert.match(mail.text, /Doctor: Dr\. Rao/);
  assert.deepEqual(mail.from, { name: 'SP3 Digital', address: 'no-reply@sp3.example' });

  const row = await db.Notification.findByPk(queued.json.notificationId);
  assert.equal(row.status, 'SENT');
  assert.equal(row.bodyText, null);   // the text may name a patient: gone once delivered
  assert.equal(row.bodyHtml, null);
  assert.ok(row.sentAt);

  const detail = (await call('GET', `/notifications/${queued.json.notificationId}`, { token: admin })).json;
  assert.equal(detail.recipient, 'a***@example.com'); // never the whole address
  assert.equal(detail.attemptLog[0].outcome, 'SENT');
  assert.equal(JSON.stringify(detail).includes('asha@example.com'), false);
  assert.equal(JSON.stringify(detail).includes('Hello'), false);
});

test('optional parts disappear cleanly, and a variable cannot inject mail headers', async () => {
  await send({ variables: { ...APPOINTMENT, doctorName: '', tokenNumber: undefined, serviceName: 'Consultation\r\nBcc: evil@example.com' } });
  await run();
  assert.doesNotMatch(outbox[0].text, /Doctor:|Token number:/);
  assert.equal(outbox[0].subject.includes('\n'), false);
  const preview = await call('POST', '/templates/preview', { token: admin, body: { templateKey: 'APPOINTMENT_CONFIRMATION', variables: { ...APPOINTMENT, serviceName: 'A\r\nBcc: x@y.z' } } });
  assert.equal(preview.json.subject.includes('\n'), false);
});

test('scheduled messages wait for their time; urgent ones go first', async () => {
  const later = await send({ scheduledAt: '2026-10-14T06:30:00Z', to: { address: 'later@example.com' } });
  assert.equal(later.status, 202);
  await send({ to: { address: 'normal@example.com' } });
  await send({ to: { address: 'urgent@example.com' }, priority: 1 });

  await run();
  assert.deepEqual(outbox.map((m) => m.to), ['urgent@example.com', 'normal@example.com']); // priority 1 first; the scheduled one waits
  advance(120);
  await run();
  assert.equal(outbox.at(-1).to, 'later@example.com');
});

test('the same idempotency key never sends twice', async () => {
  const first = await send({ idempotencyKey: 'appointment:42:confirm' });
  const again = await send({ idempotencyKey: 'appointment:42:confirm' });
  assert.equal(first.status, 202);
  assert.equal(again.status, 200);
  assert.equal(again.json.notificationId, first.json.notificationId);
  assert.equal(again.json.duplicate, true);
  await run();
  assert.equal(outbox.length, 1);
  assert.equal((await send({ idempotencyKey: 'appointment:42:confirm' }, adminB)).status, 202); // keys are per tenant
});

test('a temporary failure is retried with growing waits, then gives up; the log shows every try', async () => {
  const queued = await send({ to: { address: 'fail-temp@example.com' } });
  const id = queued.json.notificationId;

  assert.equal((await run()).retried, 1);
  let row = await db.Notification.findByPk(id);
  assert.deepEqual([row.status, row.attempts], ['PENDING', 1]);
  assert.equal(row.nextAttemptAt.getTime() - current.getTime(), 1 * 60000); // first wait: 1 minute

  assert.equal((await run()).claimed, 0); // not due yet
  advance(1);
  await run();
  row = await db.Notification.findByPk(id);
  assert.equal(row.attempts, 2);
  assert.equal(row.nextAttemptAt.getTime() - current.getTime(), 5 * 60000); // then 5 minutes

  advance(5);
  assert.equal((await run()).failed, 1); // the third attempt is the last (MAX_ATTEMPTS=3)
  row = await db.Notification.findByPk(id);
  assert.equal(row.status, 'FAILED');
  assert.match(row.lastError, /temporary failure/i);
  const log = (await call('GET', `/notifications/${id}`, { token: admin })).json.attemptLog;
  assert.deepEqual(log.map((a) => a.outcome), ['RETRY', 'RETRY', 'FAILED']);

  // a person can try again from the start
  const retried = await call('POST', `/notifications/${id}/retry`, { token: admin });
  assert.equal(retried.json.status, 'PENDING');
  assert.equal(retried.json.attempts, 0);
  assert.equal((await call('POST', `/notifications/${id}/retry`, { token: admin })).json.error.code, 'NOT_RETRYABLE'); // pending again
});

test('a hard bounce fails at once and blocks that address for everything', async () => {
  const bad = await send({ to: { address: 'fail-perm@example.com' } });
  assert.equal((await run()).failed, 1);
  assert.equal((await db.Notification.findByPk(bad.json.notificationId)).attempts, 1); // no pointless retries

  const suppressions = (await call('GET', '/suppressions', { token: admin })).json.data;
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0].reason, 'BOUNCED');
  assert.equal(suppressions[0].address, 'f***@example.com');

  // even a security notice is not attempted to an undeliverable address
  const next = await send({ templateKey: 'PASSWORD_CHANGED', to: { address: 'fail-perm@example.com' }, variables: { userName: 'X' } });
  assert.equal(next.json.status, 'SUPPRESSED');
});

test('suppression: an opt-out stops reminders but not security notices; lifting it restores them', async () => {
  const add = await call('POST', '/suppressions', { token: admin, body: { address: 'Asha@Example.com', reason: 'UNSUBSCRIBED' } }); // any case
  assert.equal(add.status, 201);

  assert.equal((await send({ templateKey: 'APPOINTMENT_REMINDER' })).json.status, 'SUPPRESSED');
  assert.equal((await send({ templateKey: 'PASSWORD_CHANGED', variables: { userName: 'Asha' } })).json.status, 'PENDING'); // SECURITY still goes out
  const suppressedRow = await db.Notification.findOne({ where: { status: 'SUPPRESSED' } });
  assert.match(suppressedRow.lastError, /unsubscribed/);
  assert.equal(suppressedRow.bodyText, null); // a message that will never be sent is not kept

  await call('POST', `/suppressions/${add.json.suppressionId}/lift`, { token: admin });
  assert.equal((await send({ templateKey: 'APPOINTMENT_REMINDER' })).json.status, 'PENDING');

  // blocked AFTER queuing: the worker checks again
  await call('POST', '/suppressions', { token: admin, body: { address: 'asha@example.com', category: 'REMINDER' } });
  const tally = await run();
  assert.equal(tally.suppressed, 1); // the reminder; the security notice went out
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].subject, 'Your password was changed');
});

test('a queued message can be cancelled, singly or by what it belongs to; sent ones cannot', async () => {
  const one = await send();
  const r1 = await send({ templateKey: 'APPOINTMENT_REMINDER', sourceService: 'appointment-admin-service', sourceRef: 'appointment:42' });
  const r2 = await send({ templateKey: 'APPOINTMENT_REMINDER', sourceService: 'appointment-admin-service', sourceRef: 'appointment:42', to: { address: 'b@example.com' } });
  await send({ templateKey: 'APPOINTMENT_REMINDER', sourceService: 'appointment-admin-service', sourceRef: 'appointment:43' });

  const byRef = await call('POST', '/notifications/cancel-by-source', { token: admin, body: { sourceService: 'appointment-admin-service', sourceRef: 'appointment:42' } });
  assert.equal(byRef.json.cancelled, 2);
  assert.equal((await db.Notification.findByPk(r1.json.notificationId)).status, 'CANCELLED');
  assert.equal((await db.Notification.findByPk(r2.json.notificationId)).bodyText, null);

  assert.equal((await call('POST', `/notifications/${one.json.notificationId}/cancel`, { token: admin })).json.status, 'CANCELLED');
  await run();
  assert.equal(outbox.length, 1); // only appointment:43's reminder went out
  const sent = await db.Notification.findOne({ where: { status: 'SENT' } });
  assert.equal((await call('POST', `/notifications/${sent.notificationId}/cancel`, { token: admin })).json.error.code, 'NOT_CANCELLABLE');
});

test('tenants cannot see each other', async () => {
  const mine = await send();
  assert.equal((await call('GET', `/notifications/${mine.json.notificationId}`, { token: adminB })).status, 404);
  assert.equal((await call('GET', '/notifications', { token: adminB })).json.data.length, 0);
  assert.equal((await call('POST', `/notifications/${mine.json.notificationId}/cancel`, { token: adminB })).status, 404);

  await call('PUT', '/templates/TEST_EMAIL', { token: admin, body: { subject: 'Only for A', bodyText: 'Hi from {{senderName}}' } });
  assert.equal((await call('GET', '/templates/TEST_EMAIL', { token: adminB })).json.subject, 'Test message from {{senderName}}');
  await call('POST', '/suppressions', { token: admin, body: { address: 'asha@example.com' } });
  assert.equal((await send({}, adminB)).json.status, 'PENDING'); // B did not suppress it
});

test('a tenant can reword a template within its variables, and go back to the default', async () => {
  const saved = await call('PUT', '/templates/APPOINTMENT_CONFIRMATION', {
    token: admin, body: { subject: 'See you on {{appointmentDate}}, {{patientName}}', bodyText: 'Hello {{patientName}}, we look forward to seeing you at {{facilityName}}.' },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.isOverridden, true);

  await send();
  await run();
  assert.equal(outbox[0].subject, 'See you on Wed, 21 Oct 2026, Asha Verma');
  assert.equal(outbox[0].html, null); // the override gave no HTML body

  const put = (body) => call('PUT', '/templates/APPOINTMENT_CONFIRMATION', { token: admin, body: { subject: 'x', bodyText: 'y', ...body } });
  assert.equal((await put({ bodyText: 'Your password is {{password}}' })).json.error.code, 'INVALID_TEMPLATE'); // not a declared variable
  assert.equal((await put({ subject: 'a\nb' })).json.error.code, 'INVALID_TEMPLATE');
  assert.equal((await put({ bodyHtml: '<p>hi</p><script>alert(1)</script>' })).json.error.code, 'UNSAFE_TEMPLATE');
  assert.equal((await put({ bodyHtml: '<a href="javascript:alert(1)">x</a>' })).json.error.code, 'UNSAFE_TEMPLATE');
  assert.equal((await put({ bodyHtml: '<img src=x onerror=alert(1)>' })).json.error.code, 'UNSAFE_TEMPLATE');

  const back = await call('DELETE', '/templates/APPOINTMENT_CONFIRMATION', { token: admin });
  assert.equal(back.json.isOverridden, false);
  outbox.length = 0;
  await send();
  await run();
  assert.equal(outbox[0].subject, 'Your appointment on Wed, 21 Oct 2026 at 11:00');
  assert.equal((await call('DELETE', '/templates/APPOINTMENT_CONFIRMATION', { token: admin })).json.error.code, 'NOT_OVERRIDDEN');
});

test('settings: own SMTP is encrypted and never shown; the From address follows who sends', async () => {
  const defaults = (await call('GET', '/settings/email', { token: admin })).json;
  assert.deepEqual([defaults.isEnabled, defaults.usesOwnSmtp, defaults.effectiveHourlyLimit], [true, false, 500]);

  assert.equal((await call('PUT', '/settings/email', { token: admin, body: { smtpHost: 'smtp.clinic.example' } })).json.error.code, 'INVALID_SETTINGS'); // needs a from address
  assert.equal((await call('PUT', '/settings/email', { token: admin, body: { quietHoursStart: '21:00' } })).json.error.code, 'INVALID_SETTINGS'); // needs both

  // name + reply address only: the platform still sends, so From stays the platform's and the tenant is Reply-To
  await call('PUT', '/settings/email', { token: admin, body: { fromName: 'City Clinic', fromAddress: 'frontdesk@clinic.example' } });
  await send();
  await run();
  assert.deepEqual(outbox[0].from, { name: 'City Clinic', address: 'no-reply@sp3.example' });
  assert.equal(outbox[0].replyTo, 'frontdesk@clinic.example');
  assert.equal(outbox[0].smtp, null);

  // their own SMTP account: now they send From their own address
  const own = await call('PUT', '/settings/email', { token: admin, body: { smtpHost: 'smtp.clinic.example', smtpPort: 465, smtpSecure: true, smtpUser: 'frontdesk', smtpPassword: 'S3cret-pass!' } });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.deepEqual([own.json.usesOwnSmtp, own.json.smtpPasswordSet], [true, true]);
  assert.equal(JSON.stringify(own.json).includes('S3cret-pass'), false);
  const stored = await db.TenantChannelSetting.findOne({ where: { tenant_uuid: TENANT_A } });
  assert.ok(stored.smtpPasswordEnc.startsWith('v1:'));
  assert.equal(stored.smtpPasswordEnc.includes('S3cret'), false);

  outbox.length = 0;
  await send();
  await run();
  assert.deepEqual(outbox[0].from, { name: 'City Clinic', address: 'frontdesk@clinic.example' });
  assert.deepEqual(outbox[0].smtp, { host: 'smtp.clinic.example', user: 'frontdesk' });

  // the password can be removed, and it cannot be stored at all without an encryption key
  assert.equal((await call('PUT', '/settings/email', { token: admin, body: { smtpPassword: null } })).json.smtpPasswordSet, false);
  const key = process.env.NOTIFICATION_ENCRYPTION_KEY;
  delete process.env.NOTIFICATION_ENCRYPTION_KEY;
  try {
    assert.equal((await call('PUT', '/settings/email', { token: admin, body: { smtpPassword: 'x' } })).json.error.code, 'ENCRYPTION_NOT_CONFIGURED');
  } finally { process.env.NOTIFICATION_ENCRYPTION_KEY = key; }
});

test('a switched-off channel does not fail the caller: it is logged as suppressed; the test button sends a test', async () => {
  await call('PUT', '/settings/email', { token: admin, body: { isEnabled: false } });
  const off = await send();
  assert.equal(off.status, 202);
  assert.equal(off.json.status, 'SUPPRESSED');
  await run();
  assert.equal(outbox.length, 0);

  await call('PUT', '/settings/email', { token: admin, body: { isEnabled: true } });
  const test = await call('POST', '/settings/email/test', { token: admin, body: { to: 'me@example.com' } });
  assert.equal(test.status, 202);
  await run();
  assert.match(outbox[0].subject, /^Test message from /);
});

test('reminders wait out the quiet hours; other messages do not', async () => {
  await call('PUT', '/settings/email', { token: admin, body: { quietHoursStart: '21:00', quietHoursEnd: '07:00' } });
  setNow('2026-10-14T16:30:00Z'); // 22:00 in Kolkata
  const reminder = await send({ templateKey: 'APPOINTMENT_REMINDER' });
  await send({ to: { address: 'other@example.com' } }); // a confirmation

  const tally = await run();
  assert.deepEqual([tally.sent, tally.deferred], [1, 1]);
  assert.equal(outbox[0].to, 'other@example.com');
  const held = await db.Notification.findByPk(reminder.json.notificationId);
  assert.equal(held.status, 'PENDING');
  assert.equal(held.nextAttemptAt.toISOString(), '2026-10-15T01:30:00.000Z'); // 07:00 Kolkata
  assert.equal(held.attempts, 0); // waiting is not a failed attempt

  setNow('2026-10-15T01:35:00Z');
  assert.equal((await run()).sent, 1);
  assert.equal(outbox.at(-1).to, 'asha@example.com');
});

test('the hourly limit holds messages back instead of dropping them', async () => {
  await call('PUT', '/settings/email', { token: admin, body: { hourlyLimit: 2 } });
  for (const n of [1, 2, 3]) await send({ to: { address: `p${n}@example.com` } });
  const first = await run();
  assert.equal(first.sent, 2);
  assert.equal(first.deferred, 1);
  assert.equal(outbox.length, 2);
  advance(65); // an hour later the window has moved on
  assert.equal((await run()).sent, 1);
});

test('two workers never send the same message; a worker that died does not strand its messages', async () => {
  await send();
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.sent + b.sent, 1);
  assert.equal(outbox.length, 1);

  const stuck = await send({ to: { address: 'stuck@example.com' } });
  await db.Notification.update({ status: 'SENDING', lockedUntil: new Date(current.getTime() - 60000) }, { where: { notification_id: stuck.json.notificationId } });
  await run();
  assert.equal(outbox.at(-1).to, 'stuck@example.com');
});

test('retention: finished notifications older than the period are purged; queued ones never', async () => {
  const { purgeOld } = require('../src/worker/purge');
  const old = await send();
  const queued = await send({ to: { address: 'new@example.com' } });
  await run();
  await db.Notification.update({ createdOn: new Date('2026-06-01T00:00:00Z') }, { where: { notification_id: old.json.notificationId } });
  await db.Notification.update({ status: 'PENDING', createdOn: new Date('2026-06-01T00:00:00Z') }, { where: { notification_id: queued.json.notificationId } });

  const dry = await purgeOld({ days: 90 });
  assert.deepEqual([dry.matching, dry.deleted], [1, 0]);
  assert.equal(await db.Notification.count(), 2);
  assert.equal((await purgeOld({ days: 90, apply: true })).deleted, 1);
  assert.equal(await db.Notification.count(), 1);
  assert.equal(await db.NotificationAttempt.count({ where: { notification_id: old.json.notificationId } }), 0); // its log went with it
});

test('encryption: round trip, and a tampered value is rejected', () => {
  const { encrypt, decrypt } = require('../src/utils/crypto.util');
  const stored = encrypt('smtp-pass');
  assert.equal(decrypt(stored), 'smtp-pass');
  assert.notEqual(encrypt('smtp-pass'), stored); // a fresh IV every time
  const tampered = stored.slice(0, -4) + 'AAAA';
  assert.throws(() => decrypt(tampered));
});
