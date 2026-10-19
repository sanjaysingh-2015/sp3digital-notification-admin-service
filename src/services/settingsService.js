const { TenantChannelSetting } = require('../models');
const { httpError } = require('../utils/errors');
const crypto = require('../utils/crypto.util');
const { platformSmtp } = require('../providers/emailProvider');

const DEFAULT_HOURLY_LIMIT = 500;

const shape = (s) => ({
  channel: 'EMAIL',
  isEnabled: s ? s.isEnabled : true,
  fromName: s?.fromName ?? null,
  fromAddress: s?.fromAddress ?? null,
  replyTo: s?.replyTo ?? null,
  usesOwnSmtp: !!s?.smtpHost,
  smtpHost: s?.smtpHost ?? null,
  smtpPort: s?.smtpPort ?? null,
  smtpSecure: s ? s.smtpSecure : false,
  smtpUser: s?.smtpUser ?? null,
  smtpPasswordSet: !!s?.smtpPasswordEnc, // the password itself is never returned
  hourlyLimit: s?.hourlyLimit ?? null,
  effectiveHourlyLimit: s?.hourlyLimit ?? DEFAULT_HOURLY_LIMIT,
  quietHoursStart: s?.quietHoursStart ?? null,
  quietHoursEnd: s?.quietHoursEnd ?? null,
});

class SettingsService {
  async getEmail(tenantUuid) {
    return shape(await TenantChannelSetting.findOne({ where: { tenant_uuid: tenantUuid, channel: 'EMAIL' } }));
  }

  async updateEmail(tenantUuid, patch, { userId }) {
    let row = await TenantChannelSetting.findOne({ where: { tenant_uuid: tenantUuid, channel: 'EMAIL' } });
    const values = { modifiedBy: userId || null, modifiedOn: new Date() };
    for (const key of ['isEnabled', 'fromName', 'fromAddress', 'replyTo', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'hourlyLimit', 'quietHoursStart', 'quietHoursEnd']) {
      if (patch[key] !== undefined) values[key] = patch[key] === '' ? null : patch[key];
    }
    // Password: undefined = leave it alone, null = remove it, text = store it encrypted.
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
    row = row ? await row.update(values) : await TenantChannelSetting.create({ tenantUuid, channel: 'EMAIL', ...values });
    return shape(row);
  }

  /**
   * How a tenant's email is actually sent.
   *  - With the tenant's OWN SMTP account: From is the tenant's address.
   *  - Otherwise the platform's account sends it, From stays the platform address (so SPF/DKIM
   *    still pass) and the tenant's name is shown with the tenant's address as Reply-To.
   */
  async effectiveEmail(tenantUuid) {
    const s = await TenantChannelSetting.findOne({ where: { tenant_uuid: tenantUuid, channel: 'EMAIL' } });
    const platformFrom = { name: process.env.MAIL_FROM_NAME || 'SP3 Digital', address: process.env.MAIL_FROM_ADDRESS || 'no-reply@localhost' };
    const own = !!(s?.smtpHost && s.fromAddress);

    let smtp = null;
    if (own) {
      smtp = {
        host: s.smtpHost, port: s.smtpPort || 587, secure: !!s.smtpSecure, user: s.smtpUser || undefined,
        password: s.smtpPasswordEnc ? crypto.decrypt(s.smtpPasswordEnc) : undefined,
      };
    }
    return {
      enabled: s ? s.isEnabled : true,
      from: own ? { name: s.fromName || platformFrom.name, address: s.fromAddress } : { name: s?.fromName || platformFrom.name, address: platformFrom.address },
      replyTo: s?.replyTo || (own ? null : s?.fromAddress) || null,
      smtp: smtp || (platformSmtp().host ? platformSmtp() : null),
      hourlyLimit: s?.hourlyLimit ?? DEFAULT_HOURLY_LIMIT,
      quietHoursStart: s?.quietHoursStart ?? null,
      quietHoursEnd: s?.quietHoursEnd ?? null,
    };
  }
}

module.exports = new SettingsService();
module.exports.DEFAULT_HOURLY_LIMIT = DEFAULT_HOURLY_LIMIT;
