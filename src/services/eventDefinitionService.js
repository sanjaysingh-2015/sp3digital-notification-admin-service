const { Op } = require('sequelize');
const { NotificationEventDefinition } = require('../models');
const defaults = require('../defaults/events');
const { httpError, notFound } = require('../utils/errors');

const shape = (e) => ({
  eventId: e.eventId,
  tenantUuid: e.tenantUuid,
  eventKey: e.eventKey,
  displayName: e.displayName,
  description: e.description,
  defaultChannel: e.defaultChannel,
  defaultTemplateKey: e.defaultTemplateKey,
  defaultLocale: e.defaultLocale,
  defaultCategory: e.defaultCategory,
  isActive: e.isActive,
  isPlatformDefault: !e.tenantUuid,
  createdBy: e.createdBy,
  createdOn: e.createdOn,
  modifiedBy: e.modifiedBy,
  modifiedOn: e.modifiedOn,
});

class EventDefinitionService {
  /** Writes the platform's shipped events; re-run at every start, never overwrites edits to existing rows. */
  async ensureDefaults() {
    for (const d of defaults) {
      const existing = await NotificationEventDefinition.findOne({ where: { tenant_uuid: null, event_key: d.key } });
      if (!existing) {
        await NotificationEventDefinition.create({
          tenantUuid: null, eventKey: d.key, displayName: d.name, description: d.description,
          defaultChannel: 'EMAIL', defaultTemplateKey: d.template, defaultLocale: 'en', defaultCategory: d.category, isActive: true,
        });
      }
    }
  }

  async list({ tenantUuid, page = 1, limit = 20, search, defaultChannel, defaultCategory, isActive }) {
    const where = { tenant_uuid: { [Op.or]: [tenantUuid, null] } };
    if (defaultChannel) where.default_channel = defaultChannel;
    if (defaultCategory) where.default_category = defaultCategory;
    if (isActive !== undefined) where.is_active = isActive;
    const rows = await NotificationEventDefinition.findAll({ where, order: [['eventKey', 'ASC']] });
    const effective = new Map();
    for (const row of rows) if (!effective.has(row.eventKey) || row.tenantUuid) effective.set(row.eventKey, row); // tenant row wins
    let items = [...effective.values()];
    if (search) {
      const needle = String(search).toLowerCase();
      items = items.filter((e) => [e.eventKey, e.displayName, e.description].some((v) => v && v.toLowerCase().includes(needle)));
    }
    const totalItems = items.length;
    const start = (page - 1) * limit;
    return { data: items.slice(start, start + limit).map(shape), pagination: { page, limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)) } };
  }

  async getById({ tenantUuid, eventId }) {
    const row = await NotificationEventDefinition.findOne({ where: { event_id: eventId, tenant_uuid: { [Op.or]: [tenantUuid, null] } } });
    if (!row) throw notFound('Event definition');
    return shape(row);
  }

  async create({ tenantUuid, userId, ...values }) {
    const exists = await NotificationEventDefinition.findOne({ where: { tenant_uuid: tenantUuid, event_key: values.eventKey } });
    if (exists) throw httpError(409, 'ALREADY_EXISTS', `Your organization already has an event ${values.eventKey}`);
    const row = await NotificationEventDefinition.create({ ...values, tenantUuid, createdBy: userId || null, modifiedBy: userId || null });
    return shape(row);
  }

  async _ownRow(tenantUuid, eventId) {
    const row = await NotificationEventDefinition.findOne({ where: { event_id: eventId, tenant_uuid: { [Op.or]: [tenantUuid, null] } } });
    if (!row) throw notFound('Event definition');
    if (!row.tenantUuid) throw httpError(403, 'PLATFORM_EVENT_READ_ONLY', 'Platform events cannot be changed. Create your own version of it instead.');
    return row;
  }

  async update({ tenantUuid, userId, eventId, ...patch }) {
    const row = await this._ownRow(tenantUuid, eventId);
    const { eventKey, ...rest } = patch; // the key of an existing event cannot change
    return shape(await row.update({ ...rest, modifiedBy: userId || null, modifiedOn: new Date() }));
  }

  async remove({ tenantUuid, eventId }) {
    const row = await this._ownRow(tenantUuid, eventId);
    await row.destroy();
    return { deleted: true };
  }
}

module.exports = new EventDefinitionService();
