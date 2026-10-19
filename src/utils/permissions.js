/**
 * Permission codes for the notification service (seeded by
 * database/seeds/identity-admin-notification-rbac.sql). Tenant admins hold all of
 * them; nothing is implied by another permission.
 *
 * Other SERVICES (appointments, identity, patients) do not use these: they send on a
 * tenant's behalf with the shared internal token and an X-Tenant-Uuid header, which
 * the authentication middleware treats as an internal caller.
 */
const NOTIFICATION_PERMISSIONS = {
  SEND: 'notification-admin:notification:send',           // send a notification by hand (e.g. a test or a one-off)
  READ: 'notification-admin:notification:read',           // see the delivery log
  UPDATE: 'notification-admin:notification:update',       // cancel a queued message, retry a failed one
  TEMPLATE_READ: 'notification-admin:template:read',
  TEMPLATE_MANAGE: 'notification-admin:template:manage',  // override or revert a template
  SETTINGS: 'notification-admin:settings:manage',         // sender identity, SMTP account, limits, quiet hours
  SUPPRESSION: 'notification-admin:suppression:manage',   // add / lift suppressions
};

module.exports = { NOTIFICATION_PERMISSIONS };
