const { Op } = require('sequelize');
const { Notification, NotificationAttempt } = require('../models');
const templateService = require('./templateService');
const settingsService = require('./settingsService');
const suppressionService = require('./suppressionService');
const { providerFor } = require('../providers');
const { httpError, notFound } = require('../utils/errors');
const { render, missingRequired } = require('../utils/template.util');
const { maskEmail, maskPhone } = require('../utils/mask');
const { clock } = require('../utils/clock');
const { toSequelizePage, buildEnvelope } = require('../utils/pagination');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[1-9]\d{1,14}$/; // E.164 format
const MAX_SCHEDULE_AHEAD_DAYS = 366;
const maxAttempts = () => Number(process.env.MAX_ATTEMPTS) || 5;

const summary = (n, extra = {}) => ({
  notificationId: n.notificationId,
  notificationUuid: n.notificationUuid,
  status: n.status,
  channel: n.channel,
  templateKey: n.templateKey,
  scheduledAt: n.scheduledAt,
  ...extra,
});

// Lists and details never show the recipient's whole address, and never the message body.
const detail = (n) => ({
  ...summary(n),
  category: n.category,
  recipient: maskEmail(n.recipientAddress),
  recipientName: n.recipientName,
  subject: n.subject,
  priority: n.priority,
  attempts: n.attempts,
  maxAttempts: n.maxAttempts,
  lastError: n.lastError,
  provider: n.provider,
  providerMessageId: n.providerMessageId,
  sentAt: n.sentAt,
  nextAttemptAt: n.status === 'PENDING' ? n.nextAttemptAt : null,
  sourceService: n.sourceService,
  sourceRef: n.sourceRef,
  createdOn: n.createdOn,
});

class NotificationService {
  /**
   * Queue one notification. The caller says WHICH template and gives the values; this renders
   * it with the tenant's wording, checks it can be sent, and puts it in the outbox for the
   * delivery worker. Returns at once (202): sending happens in the background, with retries.
   *
   * It never makes the caller fail because of notification trouble: a switched-off channel or
   * a suppressed address still produces a log row (status SUPPRESSED) rather than an error.
   */
  async send(payload, { tenantUuid, userId }) {
    console.log(`NotificationService.send: ${JSON.stringify(payload)} for tenant ${tenantUuid} by user ${userId}`);
    const channel = payload.channel || 'EMAIL';
    providerFor(channel); // 400 for a channel that does not exist yet

    const address = String(payload.to?.address || '').trim();
    if (channel === 'EMAIL') {
      const emailLower = address.toLowerCase();
      if (!EMAIL_RE.test(emailLower) || emailLower.length > 255) throw httpError(400, 'INVALID_RECIPIENT', 'The recipient address is not a valid email address');
    } else if (channel === 'WHATSAPP' || channel === 'SMS') {
      if (!PHONE_RE.test(address) || address.length > 20) throw httpError(400, 'INVALID_RECIPIENT', 'The recipient address is not a valid phone number (E.164 format, e.g. +15551234567)');
    }

    if (payload.idempotencyKey) {
      const existing = await Notification.findOne({ where: { tenant_uuid: tenantUuid, idempotency_key: payload.idempotencyKey } });
      if (existing) return summary(existing, { duplicate: true });
    }

    const template = await templateService.resolve({ tenantUuid, templateKey: payload.templateKey, channel, locale: payload.locale || 'en' });
    const variables = payload.variables || {};
    const missing = missingRequired(template.variables, variables);
    if (missing.length) throw httpError(400, 'MISSING_VARIABLES', `The template ${payload.templateKey} needs: ${missing.join(', ')}`, missing);
    const rendered = render(template, variables);

    const now = clock.now();
    let scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : now;
    if (Number.isNaN(scheduledAt.getTime())) throw httpError(400, 'INVALID_SCHEDULE', 'scheduledAt is not a valid date');
    if (scheduledAt < now) scheduledAt = now;
    if (scheduledAt.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_DAYS * 86400000) throw httpError(400, 'INVALID_SCHEDULE', 'scheduledAt is more than a year away');

    const row = {
      tenantUuid, channel, templateKey: template.templateKey, category: template.category,
      recipientAddress: address, recipientName: payload.to?.name ? String(payload.to.name).slice(0, 150) : null,
      subject: rendered.subject.slice(0, 255), priority: payload.priority || 5,
      scheduledAt, nextAttemptAt: scheduledAt, maxAttempts: maxAttempts(),
      idempotencyKey: payload.idempotencyKey || null, sourceService: payload.sourceService || null, sourceRef: payload.sourceRef || null,
      createdBy: userId || null,
    };

    const settings = await settingsService.effective(channel, tenantUuid);
    let status = 'PENDING';
    let reason = null;
    if (!settings.enabled) {
      status = 'SUPPRESSED';
      reason = `${channel} notifications are switched off for this organization`;
    } else {
      const block = await suppressionService.blocking({ tenantUuid, channel, address, category: template.category });
      if (block) {
        status = 'SUPPRESSED';
        reason = `This address is suppressed (${block.reason.toLowerCase().replace('_', ' ')})`;
      }
    }

    try {
      const created = await Notification.create({
        ...row, status, lastError: reason,
        // a message that will never be sent is not kept
        bodyText: status === 'PENDING' ? rendered.text : null,
        bodyHtml: status === 'PENDING' ? rendered.html : null,
      });
      return summary(created);
    } catch (error) {
      // two identical requests at the same instant: the second one finds the first
      if (error.name === 'SequelizeUniqueConstraintError' && payload.idempotencyKey) {
        const winner = await Notification.findOne({ where: { tenant_uuid: tenantUuid, idempotency_key: payload.idempotencyKey } });
        if (winner) return summary(winner, { duplicate: true });
      }
      throw error;
    }
  }

  async list({ tenantUuid, page, limit, status, templateKey, sourceService, sourceRef, dateFrom, dateTo }) {
    const { limit: safeLimit, offset, page: safePage } = toSequelizePage({ page, limit });
    const where = { tenant_uuid: tenantUuid };
    if (status) where.status = status;
    if (templateKey) where.template_key = templateKey;
    if (sourceService) where.source_service = sourceService;
    if (sourceRef) where.source_ref = sourceRef;
    if (dateFrom || dateTo) {
      where.created_on = {};
      if (dateFrom) where.created_on[Op.gte] = new Date(`${dateFrom}T00:00:00Z`);
      if (dateTo) where.created_on[Op.lte] = new Date(`${dateTo}T23:59:59.999Z`);
    }
    const result = await Notification.findAndCountAll({ where, limit: safeLimit, offset, order: [['createdOn', 'DESC'], ['notificationId', 'DESC']] });
    return buildEnvelope({ rows: result.rows.map(detail), count: result.count }, { page: safePage, limit: safeLimit });
  }

  async getById(notificationId, { tenantUuid }) {
    const n = await Notification.findOne({
      where: { notification_id: notificationId, tenant_uuid: tenantUuid },
      include: [{ model: NotificationAttempt, as: 'attemptLog' }],
      order: [[{ model: NotificationAttempt, as: 'attemptLog' }, 'attemptNo', 'ASC']],
    });
    if (!n) throw notFound('Notification');
    return {
      ...detail(n),
      attemptLog: (n.attemptLog || []).map((a) => ({ attemptNo: a.attemptNo, outcome: a.outcome, error: a.error, providerResponse: a.providerResponse, at: a.createdOn })),
    };
  }

  /** Stop a message that has not gone out yet (e.g. the appointment it reminds about was cancelled). */
  async cancel(notificationId, { tenantUuid }) {
    const n = await Notification.findOne({ where: { notification_id: notificationId, tenant_uuid: tenantUuid } });
    if (!n) throw notFound('Notification');
    if (n.status !== 'PENDING') throw httpError(409, 'NOT_CANCELLABLE', `A ${n.status.toLowerCase()} notification cannot be cancelled`);
    await n.update({ status: 'CANCELLED', bodyText: null, bodyHtml: null, modifiedOn: new Date() });
    return detail(n);
  }

  /** Cancel every queued message that belongs to one thing, e.g. { sourceService, sourceRef: "appointment:42" }. */
  async cancelBySource({ tenantUuid, sourceService, sourceRef, templateKey }) {
    const where = { tenant_uuid: tenantUuid, source_service: sourceService, source_ref: sourceRef, status: 'PENDING' };
    if (templateKey) where.template_key = templateKey;
    const [cancelled] = await Notification.update({ status: 'CANCELLED', bodyText: null, bodyHtml: null, modifiedOn: new Date() }, { where });
    return { cancelled };
  }

  /** Try a failed message again from the start. */
  async retry(notificationId, { tenantUuid }) {
    const n = await Notification.findOne({ where: { notification_id: notificationId, tenant_uuid: tenantUuid } });
    if (!n) throw notFound('Notification');
    if (n.status !== 'FAILED') throw httpError(409, 'NOT_RETRYABLE', `Only a failed notification can be retried (this one is ${n.status.toLowerCase()})`);
    if (!n.bodyText) throw httpError(409, 'NOT_RETRYABLE', 'The message text is no longer stored, so it cannot be sent again');
    const now = clock.now();
    await n.update({ status: 'PENDING', attempts: 0, nextAttemptAt: now, scheduledAt: now, lastError: null, lockedUntil: null, modifiedOn: now });
    return detail(n);
  }
}

module.exports = new NotificationService();
