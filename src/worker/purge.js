const { Op } = require('sequelize');
const { Notification } = require('../models');
const { clock } = require('../utils/clock');

/**
 * Deletes finished notifications (sent, failed, cancelled, suppressed) older than the retention
 * period, with their attempt logs. Queued ones are never touched. Dry run unless { apply: true }.
 */
async function purgeOld({ days = Number(process.env.NOTIFICATION_RETENTION_DAYS) || 90, apply = false, now = clock.now() } = {}) {
  const cutoff = new Date(now.getTime() - days * 86400000);
  const where = { status: { [Op.in]: ['SENT', 'FAILED', 'CANCELLED', 'SUPPRESSED'] }, created_on: { [Op.lt]: cutoff } };
  const matching = await Notification.count({ where });
  if (!apply) return { days, matching, deleted: 0, apply };
  const deleted = await Notification.destroy({ where });
  return { days, matching, deleted, apply };
}

module.exports = { purgeOld };
