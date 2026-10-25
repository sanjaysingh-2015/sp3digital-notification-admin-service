const { TenantChannelSetting } = require('../models');
const { httpError } = require('../utils/errors');
const crypto = require('../utils/crypto.util');
const { platformSmtp } = require('../providers/emailProvider');
const { platformConfig: whatsappConfig } = require('../providers/whatsappProvider');
const { platformConfig: smsConfig } = require('../providers/smsProvider');

const DEFAULT_HOURLY_LIMIT = 500;

const shape = (s, channel) => ({
  settingId: s?.settingId ?? null,
  channel,
  isEnabled: s ? s.isEnabled : true,
  fromName: s?.fromName ?? null,
  fromAddress: s?.fromAddress ?? null,
  replyTo: s?.replyTo ?? null,
  usesOwnSmtp: !!s?.smtpHost,
  smtpHost: s?.smtpHost ?? null,
  smtpPort: s?.smtpPort ?? null,
  smtpSecure: s ? s.smtpSecure : false,
  smtpUser: s?.smtpUser ?? null,
  smtpPasswordSet: !!s?.smtpPasswordEnc,
  hourlyLimit: s?.hourlyLimit ?? null,
  effectiveHourlyLimit: s?.hourlyLimit ?? DEFAULT_HOURLY_LIMIT,
  quietHoursStart: s?.quietHoursStart ?? null,
  quietHoursEnd: s?.quietHoursEnd ?? null,
  createdOn: s?.createdOn ?? null,
  modifiedBy: s?.modifiedBy ?? null,
  modifiedOn: s?.modifiedOn ?? null,
});

const channelPlatformFrom = (channel) => {
  if (channel === 'EMAIL') {
    return { name: process.env.MAIL_FROM_NAME || 'SP3 Digital', address: process.env.MAIL_FROM_ADDRESS || 'no-reply@localhost' };
  }
  if (channel === 'WHATSAPP') {
    return { name: process.env.WHATSAPP_FROM_NAME || 'SP3 Digital', address: process.env.WHATSAPP_FROM_NUMBER || null };
  }
  if (channel === 'SMS') {
    return { name: process.env.SMS_FROM_NAME || 'SP3 Digital', address: process.env.SMS_FROM_NUMBER || null };
  }
  return { name: 'SP3 Digital', address: null };
};

class SettingsService {
  async get(tenantUuid, channel) {
    const row = await TenantChannelSetting.findOne({ where: { tenant_uuid: tenantUuid, channel } });
    return shape(row, channel);
  }

  async update(tenantUuid, channel, patch, { userId }) {
    let row = await TenantChannelSetting.findOne({ where: { tenant_uuid: tenantUuid, channel } });
    const values = { modifiedBy: userId || null, modifiedOn: new Date() };
    const allowedKeys = ['isEnabled', 'fromName', 'fromAddress', 'replyTo', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'hourlyLimit', 'quietHoursStart', 'quietHoursEnd'];
    for (const key of allowedKeys) {
      if (patch[key] !== undefined) values[key] = patch[key] === '' ? null : patch[key];
    }
    if (patch.smtpPassword !== undefined) {
      if (patch.smtpPassword === null || patch.smtpPassword === '') values.smtpPasswordEnc = null;
      else {
        if (!crypto.isConfigured()) {
          throw httpError(503, 'ENCRYPTION_NOT_CONFIGURED', 'The service has no NOTIFICATION_ENCRYPTION_KEY, so an SMTP password cannot be stored safely');
        }
        values.smtpPasswordEnc = crypto.encrypt(patch.smtpPassword);
      }
    }
    const next = { ...(row ? row.get({ plain: true }) : {}), ...values };
    if (next.smtpHost && !next.fromAddress) {
      throw httpError(400, 'INVALID_SETTINGS', 'With your own SMTP server you must also give the "from" address messages are sent from');
    }
    if ((next.quietHoursStart && !next.quietHoursEnd) || (!next.quietHoursStart && next.quietHoursEnd)) {
      throw httpError(400, 'INVALID_SETTINGS', 'Give both a quiet-hours start and an end, or neither');
    }
    row = row ? await row.update(values) : await TenantChannelSetting.create({ tenantUuid, channel, createdBy: userId || null, ...values });
    return shape(row, channel);
  }

  // ---- admin screen (Notification > Channel): one row per channel the tenant has configured ----

  async listAll(tenantUuid) {
    const rows = await TenantChannelSetting.findAll({ where: { tenant_uuid: tenantUuid }, order: [['channel', 'ASC']] });
    return { data: rows.map((r) => shape(r, r.channel)) };
  }

  async getById(tenantUuid, settingId) {
    const row = await TenantChannelSetting.findOne({ where: { setting_id: settingId, tenant_uuid: tenantUuid } });
    if (!row) throw httpError(404, 'NOT_FOUND', 'Channel setting not found');
    return shape(row, row.channel);
  }

  async create(tenantUuid, { channel, ...patch }, { userId }) {
    const exists = await TenantChannelSetting.findOne({ where: { tenant_uuid: tenantUuid, channel } });
    if (exists) throw httpError(409, 'ALREADY_EXISTS', `A ${channel} setting already exists for your organization. Edit it instead.`);
    return this.update(tenantUuid, channel, patch, { userId });
  }

  async updateById(tenantUuid, settingId, patch, { userId }) {
    const row = await TenantChannelSetting.findOne({ where: { setting_id: settingId, tenant_uuid: tenantUuid } });
    if (!row) throw httpError(404, 'NOT_FOUND', 'Channel setting not found');
    const { channel, ...rest } = patch; // the channel of an existing setting cannot change
    return this.update(tenantUuid, row.channel, rest, { userId });
  }

  async removeById(tenantUuid, settingId) {
    const removed = await TenantChannelSetting.destroy({ where: { setting_id: settingId, tenant_uuid: tenantUuid } });
    if (!removed) throw httpError(404, 'NOT_FOUND', 'Channel setting not found');
    return { deleted: true };
  }

  async effective(channel, tenantUuid) {
    const s = await TenantChannelSetting.findOne({ where: { tenant_uuid: tenantUuid, channel } });
    const platformFrom = channelPlatformFrom(channel);

    let providerConfig = null;
    let enabled = true;

    if (channel === 'EMAIL') {
      enabled = s ? s.isEnabled : true;
      const own = !!(s?.smtpHost && s.fromAddress);
      if (own) {
        providerConfig = {
          host: s.smtpHost, port: s.smtpPort || 587, secure: !!s.smtpSecure, user: s.smtpUser || undefined,
          password: s.smtpPasswordEnc ? crypto.decrypt(s.smtpPasswordEnc) : undefined,
        };
      } else {
        providerConfig = platformSmtp().host ? platformSmtp() : null;
      }
    } else if (channel === 'WHATSAPP') {
      enabled = s ? s.isEnabled : true;
      const wConfig = whatsappConfig();
      if (wConfig.accountSid && wConfig.authToken && wConfig.fromNumber) {
        providerConfig = wConfig;
      }
    } else if (channel === 'SMS') {
      enabled = s ? s.isEnabled : true;
      const sConfig = smsConfig();
      if (sConfig.accountSid && sConfig.authToken && sConfig.fromNumber) {
        providerConfig = sConfig;
      }
    }

    return {
      enabled,
      from: { name: s?.fromName || platformFrom.name, address: s?.fromAddress || platformFrom.address },
      replyTo: s?.replyTo || null,
      providerConfig,
      hourlyLimit: s?.hourlyLimit ?? DEFAULT_HOURLY_LIMIT,
      quietHoursStart: s?.quietHoursStart ?? null,
      quietHoursEnd: s?.quietHoursEnd ?? null,
    };
  }

  async getEmail(tenantUuid) {
    return this.get(tenantUuid, 'EMAIL');
  }

  async updateEmail(tenantUuid, patch, ctx) {
    return this.update(tenantUuid, 'EMAIL', patch, ctx);
  }

  async effectiveEmail(tenantUuid) {
    return this.effective('EMAIL', tenantUuid);
  }
}

module.exports = new SettingsService();
module.exports.DEFAULT_HOURLY_LIMIT = DEFAULT_HOURLY_LIMIT;