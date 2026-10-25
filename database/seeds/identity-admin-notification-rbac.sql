-- Notification RBAC — run against the sp3digital_identity database
-- (copy into identity-admin-service's database/seeds/).
--
-- TENANT_ADMIN gets every notification permission; nobody else gets any by default
-- (the other services send with the internal token, not with a user's permissions).
-- Codes must match src/utils/permissions.js in sp3digital-notification-service.

INSERT INTO permissions (permission_uuid, permission_code, permission_name, resource, action, description, status, created_on, modified_on)
SELECT UUID(), v.code, v.name, 'notification-admin', v.action, v.descr, 'ACTIVE', NOW(), NOW()
FROM (
  SELECT 'notification-admin:notification:send'    AS code, 'Send notification'          AS name, 'send'   AS action, 'Send a notification by hand'                  AS descr
  UNION ALL SELECT 'notification-admin:notification:read',    'View notification log',      'read',   'See what was sent and whether it was delivered'
  UNION ALL SELECT 'notification-admin:notification:update',  'Cancel / retry notification','update', 'Cancel a queued message or retry a failed one'
  UNION ALL SELECT 'notification-admin:template:read',        'View templates',             'read',   'See message templates'
  UNION ALL SELECT 'notification-admin:template:manage',      'Manage templates',           'manage', 'Override or revert a message template'
  UNION ALL SELECT 'notification-admin:settings:manage',      'Notification settings',      'manage', 'Sender identity, SMTP account, limits, quiet hours'
  UNION ALL SELECT 'notification-admin:suppression:manage',   'Manage suppressions',        'manage', 'Block or unblock an address'
  UNION ALL SELECT 'notification-admin:channel-config:read',   'View channel settings',      'read',   'See the organization''s channel settings'
  UNION ALL SELECT 'notification-admin:channel-config:create', 'Create channel settings',    'create', 'Configure a notification channel'
  UNION ALL SELECT 'notification-admin:channel-config:update', 'Update channel settings',    'update', 'Change a channel setting'
  UNION ALL SELECT 'notification-admin:channel-config:delete', 'Delete channel settings',    'delete', 'Remove a channel setting'
  UNION ALL SELECT 'notification-admin:template:create',       'Create templates',           'create', 'Create a message template'
  UNION ALL SELECT 'notification-admin:template:update',       'Update templates',           'update', 'Edit a message template'
  UNION ALL SELECT 'notification-admin:template:delete',       'Delete templates',           'delete', 'Delete a message template'
  UNION ALL SELECT 'notification-admin:event-definition:read',   'View event definitions',   'read',   'See notification events'
  UNION ALL SELECT 'notification-admin:event-definition:create', 'Create event definitions', 'create', 'Define a notification event'
  UNION ALL SELECT 'notification-admin:event-definition:update', 'Update event definitions', 'update', 'Edit a notification event'
  UNION ALL SELECT 'notification-admin:event-definition:delete', 'Delete event definitions', 'delete', 'Delete a notification event'
) v
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.permission_code = v.code);

INSERT INTO role_permissions (role_id, permission_id, status, created_on, modified_on)
SELECT roles.role_id, permissions.permission_id, 'ACTIVE', NOW(), NOW()
FROM roles
JOIN permissions ON permissions.permission_code LIKE 'notification-admin:%'
LEFT JOIN role_permissions
  ON role_permissions.role_id = roles.role_id AND role_permissions.permission_id = permissions.permission_id AND role_permissions.status = 'ACTIVE'
WHERE roles.role_code = 'TENANT_ADMIN' AND role_permissions.role_permission_id IS NULL;
