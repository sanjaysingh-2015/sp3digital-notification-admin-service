const { Op } = require('sequelize');
const { NotificationTemplate } = require('../models');
const defaults = require('../defaults/templates');
const { httpError, notFound } = require('../utils/errors');
const { render, placeholdersIn, unsafeReason } = require('../utils/template.util');

const shape = (t, tenantUuid) => ({
  templateId: t.templateId,
  tenantUuid: t.tenantUuid,
  status: t.status,
  createdBy: t.createdBy,
  createdOn: t.createdOn,
  modifiedBy: t.modifiedBy,
  templateKey: t.templateKey,
  channel: t.channel,
  locale: t.locale,
  category: t.category,
  description: t.description,
  subject: t.subject,
  bodyText: t.bodyText,
  bodyHtml: t.bodyHtml,
  variables: t.variables,
  isOverridden: !!t.tenantUuid && t.tenantUuid === tenantUuid,
  defaultVersion: t.defaultVersion,
  modifiedOn: t.modifiedOn,
  isPlatformDefault: !t.tenantUuid,
});

class TemplateService {
  /** Writes the platform's shipped templates into the database; re-run at every start. */
  async ensureDefaults() {
    for (const d of defaults) {
      const where = { tenant_uuid: null, template_key: d.key, channel: d.channel || 'EMAIL', locale: 'en' };
      const existing = await NotificationTemplate.findOne({ where });
      const values = {
        category: d.category, description: d.description, subject: d.subject, bodyText: d.bodyText,
        bodyHtml: d.bodyHtml, variables: d.variables, defaultVersion: d.version, status: 'ACTIVE',
      };
      if (!existing) await NotificationTemplate.create({ tenantUuid: null, templateKey: d.key, channel: d.channel || 'EMAIL', locale: 'en', ...values });
      else if (existing.defaultVersion < d.version) await existing.update({ ...values, modifiedOn: new Date() });
    }
  }

  /** The tenant's override if it has one, otherwise the platform default; falls back to English. */
  async resolve({ tenantUuid, templateKey, channel = 'EMAIL', locale = 'en' }) {
    for (const wanted of [...new Set([locale, 'en'])]) {
      const rows = await NotificationTemplate.findAll({
        where: { template_key: templateKey, channel, locale: wanted, status: 'ACTIVE', tenant_uuid: { [Op.or]: [tenantUuid, null] } },
      });
      const found = rows.find((r) => r.tenantUuid === tenantUuid) || rows.find((r) => !r.tenantUuid);
      if (found) return found;
    }
    throw httpError(404, 'TEMPLATE_NOT_FOUND', `There is no ${channel} template called ${templateKey}`);
  }

  /** Templates in effect for the tenant (an override wins over the platform wording), filtered and paged. */
  async list({ tenantUuid, page = 1, limit = 100, search, channel, category, locale, status }) {
    const where = { tenant_uuid: { [Op.or]: [tenantUuid, null] } };
    if (channel) where.channel = channel;
    if (category) where.category = category;
    if (locale) where.locale = locale;
    if (status) where.status = status;
    const rows = await NotificationTemplate.findAll({ where, order: [['templateKey', 'ASC'], ['channel', 'ASC'], ['locale', 'ASC']] });
    const effective = new Map();
    for (const row of rows) {
      const key = `${row.templateKey}|${row.channel}|${row.locale}`;
      if (!effective.has(key) || row.tenantUuid) effective.set(key, row); // an override wins
    }
    let items = [...effective.values()];
    if (search) {
      const needle = String(search).toLowerCase();
      items = items.filter((t) => [t.templateKey, t.subject, t.description].some((v) => v && v.toLowerCase().includes(needle)));
    }
    const totalItems = items.length;
    const start = (page - 1) * limit;
    return {
      data: items.slice(start, start + limit).map((t) => shape(t, tenantUuid)),
      pagination: { page, limit, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / limit)) },
    };
  }

  // ---- admin screen (Notification > Template): a tenant's own templates by id ----

  async getById({ tenantUuid, templateId }) {
    const row = await NotificationTemplate.findOne({ where: { template_id: templateId, tenant_uuid: { [Op.or]: [tenantUuid, null] } } });
    if (!row) throw notFound('Template');
    return shape(row, tenantUuid);
  }

  _validateContent({ subject, bodyText, bodyHtml, variables }) {
    if (/[\r\n]/.test(subject)) throw httpError(400, 'INVALID_TEMPLATE', 'The subject must be a single line');
    const declared = new Set((variables || []).map((v) => v.name));
    for (const [part, text] of [['subject', subject], ['text body', bodyText], ['HTML body', bodyHtml]]) {
      const unknown = [...placeholdersIn(text)].filter((n) => !declared.has(n));
      if (unknown.length) {
        throw httpError(400, 'INVALID_TEMPLATE', `The ${part} uses {{${unknown.join('}}, {{')}}}, which ${unknown.length > 1 ? 'are' : 'is'} not in the variable list. Declared: ${[...declared].join(', ') || 'none'}`);
      }
    }
    const unsafe = unsafeReason(bodyHtml);
    if (unsafe) throw httpError(400, 'UNSAFE_TEMPLATE', unsafe);
  }

  async create({ tenantUuid, userId, templateKey, channel = 'EMAIL', locale = 'en', category = 'TRANSACTIONAL', description, subject, bodyText, bodyHtml, variables = [], status = 'ACTIVE' }) {
    this._validateContent({ subject, bodyText, bodyHtml, variables });
    const exists = await NotificationTemplate.findOne({ where: { tenant_uuid: tenantUuid, template_key: templateKey, channel, locale } });
    if (exists) throw httpError(409, 'ALREADY_EXISTS', `Your organization already has a ${channel} template ${templateKey} (${locale})`);
    const row = await NotificationTemplate.create({
      tenantUuid, templateKey, channel, locale, category, description: description || null, subject, bodyText,
      bodyHtml: bodyHtml || null, variables, status, createdBy: userId || null, modifiedBy: userId || null,
    });
    return shape(row, tenantUuid);
  }

  async _ownRow(tenantUuid, templateId) {
    const row = await NotificationTemplate.findOne({ where: { template_id: templateId, tenant_uuid: { [Op.or]: [tenantUuid, null] } } });
    if (!row) throw notFound('Template');
    if (!row.tenantUuid) throw httpError(403, 'PLATFORM_TEMPLATE_READ_ONLY', 'Platform templates cannot be changed. Create your own version of it instead.');
    return row;
  }

  async updateById({ tenantUuid, userId, templateId, ...patch }) {
    const row = await this._ownRow(tenantUuid, templateId);
    const next = { subject: patch.subject ?? row.subject, bodyText: patch.bodyText ?? row.bodyText, bodyHtml: patch.bodyHtml === undefined ? row.bodyHtml : patch.bodyHtml, variables: patch.variables ?? row.variables };
    this._validateContent(next);
    const values = { modifiedBy: userId || null, modifiedOn: new Date() };
    for (const key of ['category', 'description', 'status', 'subject', 'bodyText', 'bodyHtml', 'variables']) {
      if (patch[key] !== undefined) values[key] = patch[key] === '' ? null : patch[key];
    }
    return shape(await row.update(values), tenantUuid);
  }

  async removeById({ tenantUuid, templateId }) {
    const row = await this._ownRow(tenantUuid, templateId);
    await row.destroy();
    return { deleted: true };
  }

  async get({ tenantUuid, templateKey, channel, locale }) {
    return shape(await this.resolve({ tenantUuid, templateKey, channel, locale }), tenantUuid);
  }

  /**
   * A tenant rewrites the wording. The variables cannot change (the sending services
   * only know the declared ones), so the override may use any of the platform
   * template's variables, but no others.
   */
  async saveOverride({ tenantUuid, userId, templateKey, channel = 'EMAIL', locale = 'en', subject, bodyText, bodyHtml }) {
    const base = await NotificationTemplate.findOne({ where: { tenant_uuid: null, template_key: templateKey, channel, locale: 'en' } });
    if (!base) throw notFound(`Template ${templateKey}`);

    if (/[\r\n]/.test(subject)) throw httpError(400, 'INVALID_TEMPLATE', 'The subject must be a single line');
    const declared = new Set(base.variables.map((v) => v.name));
    for (const [part, text] of [['subject', subject], ['text body', bodyText], ['HTML body', bodyHtml]]) {
      const unknown = [...placeholdersIn(text)].filter((n) => !declared.has(n));
      if (unknown.length) {
        throw httpError(400, 'INVALID_TEMPLATE', `The ${part} uses {{${unknown.join('}}, {{')}}}, which ${unknown.length > 1 ? 'are' : 'is'} not available. Available: ${[...declared].join(', ')}`);
      }
    }
    const unsafe = unsafeReason(bodyHtml);
    if (unsafe) throw httpError(400, 'UNSAFE_TEMPLATE', unsafe);

    const where = { tenant_uuid: tenantUuid, template_key: templateKey, channel, locale };
    const existing = await NotificationTemplate.findOne({ where });
    const values = { subject, bodyText, bodyHtml: bodyHtml || null, category: base.category, description: base.description, variables: base.variables, status: 'ACTIVE', modifiedBy: userId || null, modifiedOn: new Date() };
    const row = existing
      ? await existing.update(values)
      : await NotificationTemplate.create({ tenantUuid, templateKey, channel, locale, createdBy: userId || null, ...values });
    return shape(row, tenantUuid);
  }

  /** Back to the platform wording. */
  async removeOverride({ tenantUuid, templateKey, channel = 'EMAIL', locale = 'en' }) {
    const removed = await NotificationTemplate.destroy({ where: { tenant_uuid: tenantUuid, template_key: templateKey, channel, locale } });
    if (!removed) throw httpError(404, 'NOT_OVERRIDDEN', 'This template is not overridden for your organization');
    return this.get({ tenantUuid, templateKey, channel, locale });
  }

  /** What a message would look like, without sending anything. */
  async preview({ tenantUuid, templateKey, channel = 'EMAIL', locale = 'en', variables = {} }) {
    const template = await this.resolve({ tenantUuid, templateKey, channel, locale });
    return render(template, variables);
  }
}

module.exports = new TemplateService();
