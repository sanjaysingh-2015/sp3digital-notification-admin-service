const { Op } = require('sequelize');
const { NotificationSuppression } = require('../models');
const { httpError, notFound } = require('../utils/errors');
const { maskEmail, maskPhone } = require('../utils/mask');
const { toSequelizePage, buildEnvelope } = require('../utils/pagination');

const normalize = (address, channel) => {
  const str = String(address).trim();
  return channel === 'EMAIL' ? str.toLowerCase() : str;
};

const shape = (s) => ({
  suppressionId: s.suppressionId,
  channel: s.channel,
  address: s.channel === 'EMAIL' ? maskEmail(s.address) : maskPhone(s.address),
  category: s.category,
  reason: s.reason,
  note: s.note,
  status: s.status,
  createdOn: s.createdOn,
  liftedOn: s.liftedOn,
});

class SuppressionService {
  /**
   * The active suppression that stops this message, or null. A suppression with no category
   * covers every category except SECURITY (a "your password changed" notice is still sent to
   * someone who unsubscribed from reminders); a bounced address is undeliverable for ALL of them.
   */
  async blocking({ tenantUuid, channel, address, category }) {
    const normalized = normalize(address, channel);
    const rows = await NotificationSuppression.findAll({
      where: { tenant_uuid: tenantUuid, channel, address: normalized, status: 'ACTIVE' },
    });
    return (
      rows.find((s) => s.reason === 'BOUNCED') ||
      rows.find((s) => (s.category === null && category !== 'SECURITY') || s.category === category) ||
      null
    );
  }

  async add({ tenantUuid, userId, channel = 'EMAIL', address, category = null, reason = 'MANUAL', note = null }) {
    const normalized = normalize(address, channel);
    const existing = await NotificationSuppression.findOne({
      where: { tenant_uuid: tenantUuid, channel, address: normalized, category, reason, status: 'ACTIVE' },
    });
    if (existing) return shape(existing);
    const row = await NotificationSuppression.create({ tenantUuid, channel, address: normalized, category, reason, note, createdBy: userId || null });
    return shape(row);
  }

  async list({ tenantUuid, page, limit, status = 'ACTIVE' }) {
    const { limit: safeLimit, offset, page: safePage } = toSequelizePage({ page, limit });
    const where = { tenant_uuid: tenantUuid };
    if (status) where.status = status;
    const result = await NotificationSuppression.findAndCountAll({ where, limit: safeLimit, offset, order: [['createdOn', 'DESC']] });
    return buildEnvelope({ rows: result.rows.map(shape), count: result.count }, { page: safePage, limit: safeLimit });
  }

  async lift(suppressionId, { tenantUuid, userId }) {
    const row = await NotificationSuppression.findOne({ where: { suppression_id: suppressionId, tenant_uuid: tenantUuid } });
    if (!row) throw notFound('Suppression');
    if (row.status === 'LIFTED') throw httpError(409, 'ALREADY_LIFTED', 'This suppression was already lifted');
    await row.update({ status: 'LIFTED', liftedBy: userId || null, liftedOn: new Date() });
    return shape(row);
  }
}

module.exports = new SuppressionService();
module.exports.normalize = normalize;
