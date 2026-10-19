const { Op } = require('sequelize');
const { Notification, NotificationAttempt } = require('../models');
const settingsService = require('../services/settingsService');
const suppressionService = require('../services/suppressionService');
const { providerFor } = require('../providers');
const { clock, quietHoursEnd } = require('../utils/clock');

// Wait before attempt 2, 3, 4, 5, 6 … (minutes). A message that keeps failing for ~9 hours gives up.
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
const LOCK_MINUTES = 5;               // a worker that dies mid-send releases its messages after this
const RECIPIENT_PER_HOUR = 10;        // guard against a loop mailing one person over and over
const minutes = (n) => n * 60000;

async function defer(n, until) {
  // putting a message back is not an attempt: nothing was tried
  await n.update({ status: 'PENDING', nextAttemptAt: until, lockedUntil: null, modifiedOn: clock.now() });
}

async function suppress(n, reason) {
  await n.update({ status: 'SUPPRESSED', lastError: reason, bodyText: null, bodyHtml: null, lockedUntil: null, modifiedOn: clock.now() });
}

async function deliver(n, now, tally) {
  const settings = await settingsService.effectiveEmail(n.tenantUuid);

  // Checked again at send time: the address may have been blocked, or the channel switched off, since it was queued.
  if (!settings.enabled) { await suppress(n, 'Email notifications are switched off for this organization'); tally.suppressed += 1; return; }
  const block = await suppressionService.blocking({ tenantUuid: n.tenantUuid, channel: n.channel, address: n.recipientAddress, category: n.category });
  if (block) { await suppress(n, `This address is suppressed (${block.reason.toLowerCase().replace('_', ' ')})`); tally.suppressed += 1; return; }

  // Reminders do not arrive in the middle of the night.
  if (n.category === 'REMINDER') {
    const resumes = quietHoursEnd(now, settings.quietHoursStart, settings.quietHoursEnd);
    if (resumes) { await defer(n, resumes); tally.deferred += 1; return; }
  }

  const hourAgo = new Date(now.getTime() - minutes(60));
  const tenantSent = await Notification.count({ where: { tenant_uuid: n.tenantUuid, channel: n.channel, status: 'SENT', sent_at: { [Op.gte]: hourAgo } } });
  if (tenantSent >= settings.hourlyLimit) { await defer(n, new Date(now.getTime() + minutes(10))); tally.deferred += 1; return; }
  const recipientSent = await Notification.count({ where: { tenant_uuid: n.tenantUuid, recipient_address: n.recipientAddress, status: 'SENT', sent_at: { [Op.gte]: hourAgo } } });
  if (recipientSent >= RECIPIENT_PER_HOUR) { await defer(n, new Date(now.getTime() + minutes(30))); tally.deferred += 1; return; }

  const attemptNo = n.attempts + 1;
  try {
    const result = await providerFor(n.channel).send({
      to: n.recipientAddress, toName: n.recipientName, subject: n.subject, text: n.bodyText, html: n.bodyHtml,
      from: settings.from, replyTo: settings.replyTo, smtp: settings.smtp,
    });
    await NotificationAttempt.create({ notificationId: n.notificationId, attemptNo, outcome: 'SENT', providerResponse: result.response ? String(result.response).slice(0, 500) : null });
    // Delivered: keep the metadata, drop the text (it may name a patient and an appointment).
    await n.update({
      status: 'SENT', sentAt: now, attempts: attemptNo, provider: result.provider, providerMessageId: String(result.messageId || '').slice(0, 255),
      bodyText: null, bodyHtml: null, lastError: null, lockedUntil: null, modifiedOn: clock.now(),
    });
    tally.sent += 1;
  } catch (error) {
    const message = String(error.message || error).slice(0, 500);
    const giveUp = error.permanent || attemptNo >= n.maxAttempts;
    await NotificationAttempt.create({ notificationId: n.notificationId, attemptNo, outcome: giveUp ? 'FAILED' : 'RETRY', error: message });
    if (giveUp) {
      await n.update({ status: 'FAILED', attempts: attemptNo, lastError: message, lockedUntil: null, modifiedOn: clock.now() });
      // A bounce means the address itself is bad: stop writing to it, for every kind of message.
      if (error.hardBounce) {
        await suppressionService.add({ tenantUuid: n.tenantUuid, channel: n.channel, address: n.recipientAddress, reason: 'BOUNCED', note: `Hard bounce on notification ${n.notificationId}` });
      }
      tally.failed += 1;
    } else {
      const wait = BACKOFF_MINUTES[Math.min(attemptNo - 1, BACKOFF_MINUTES.length - 1)];
      await n.update({ status: 'PENDING', attempts: attemptNo, lastError: message, nextAttemptAt: new Date(now.getTime() + minutes(wait)), lockedUntil: null, modifiedOn: clock.now() });
      tally.retried += 1;
    }
  }
}

/**
 * One pass of the delivery worker: pick the messages whose time has come, claim each one
 * (a conditional UPDATE, so two workers never send the same message), and deliver it.
 * Returns what happened, e.g. { claimed: 3, sent: 2, retried: 1, ... }.
 */
async function processDue({ limit, now = clock.now() } = {}) {
  const batch = limit || Number(process.env.WORKER_BATCH_SIZE) || 25;
  const tally = { claimed: 0, sent: 0, retried: 0, failed: 0, deferred: 0, suppressed: 0 };

  // messages claimed by a worker that then died
  await Notification.update({ status: 'PENDING', lockedUntil: null }, { where: { status: 'SENDING', locked_until: { [Op.lt]: now } } });

  const due = await Notification.findAll({
    where: { status: 'PENDING', next_attempt_at: { [Op.lte]: now } },
    order: [['priority', 'ASC'], ['nextAttemptAt', 'ASC'], ['notificationId', 'ASC']],
    limit: batch,
  });

  for (const n of due) {
    const [claimed] = await Notification.update(
      { status: 'SENDING', lockedUntil: new Date(now.getTime() + minutes(LOCK_MINUTES)), modifiedOn: now },
      { where: { notification_id: n.notificationId, status: 'PENDING' } },
    );
    if (claimed !== 1) continue; // another worker got it
    tally.claimed += 1;
    await n.reload();
    try {
      await deliver(n, now, tally);
    } catch (error) {
      // something unexpected (e.g. the database): put it back so it is not stuck
      console.error('[notification] unexpected error while delivering', n.notificationId, error.message);
      await Notification.update({ status: 'PENDING', lockedUntil: null, nextAttemptAt: new Date(now.getTime() + minutes(1)) }, { where: { notification_id: n.notificationId, status: 'SENDING' } });
    }
  }
  return tally;
}

/** Runs processDue on a timer until stopped. Passes never overlap. */
function startWorker({ intervalSeconds = Number(process.env.WORKER_INTERVAL_SECONDS) || 5 } = {}) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await processDue();
    } catch (error) {
      console.error('[notification] worker pass failed:', error.message);
    } finally {
      running = false;
    }
  }, intervalSeconds * 1000);
  return () => clearInterval(timer);
}

module.exports = { processDue, startWorker, BACKOFF_MINUTES };
