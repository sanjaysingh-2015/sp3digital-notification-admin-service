-- =====================================================================
-- sp3digital_notifications — Unified notification service
--
-- Bounded context: delivering messages to people. Other services decide WHAT
-- to say and WHEN (an appointment is booked, a reminder is due) and hand the
-- notification service a template key plus values; this service renders it,
-- queues it, delivers it with retries, and keeps a delivery log.
--
--   notification_templates         message text per template / channel / locale; platform
--                                  defaults (tenant_uuid NULL) with optional per-tenant overrides
--   notifications                  the outbox AND the delivery log (one row per message)
--   notification_attempts          every delivery attempt of a notification
--   notification_suppressions      addresses that must not be written to (unsubscribed, bounced ...)
--   tenant_channel_settings        per-tenant sender identity, optional own SMTP account, limits, quiet hours
--
-- Email is the only channel today; `channel` is a column everywhere so SMS or
-- WhatsApp can be added without changing the schema. Tenant ids and user ids
-- are plain columns (no cross-database foreign keys), as in every service.
--
-- Privacy: a rendered message may name a patient and an appointment. The body is
-- wiped as soon as the message is delivered; only metadata stays, and everything
-- is purged after NOTIFICATION_RETENTION_DAYS (npm run purge).
-- MySQL 8.0 required.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `sp3digital_notifications`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `sp3digital_notifications`;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `notification_attempts`;
DROP TABLE IF EXISTS `notifications`;
DROP TABLE IF EXISTS `notification_suppressions`;
DROP TABLE IF EXISTS `tenant_channel_settings`;
DROP TABLE IF EXISTS `notification_templates`;
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================================
-- 1. notification_templates
-- tenant_uuid NULL = the platform default every tenant gets; a row with a
-- tenant_uuid overrides it for that tenant. The default rows are created by the
-- service itself at start-up (src/defaults/templates.js), so nothing needs seeding here.
-- =============================================================
CREATE TABLE `notification_templates` (
  `template_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) DEFAULT NULL,
  `template_key` varchar(60) NOT NULL,                    -- APPOINTMENT_CONFIRMATION, APPOINTMENT_REMINDER, ...
  `channel` varchar(20) NOT NULL DEFAULT 'EMAIL',
  `locale` varchar(10) NOT NULL DEFAULT 'en',
  `category` varchar(20) NOT NULL DEFAULT 'TRANSACTIONAL',-- TRANSACTIONAL / REMINDER / SECURITY / MARKETING
  `description` varchar(255) DEFAULT NULL,
  `subject` varchar(255) NOT NULL,                        -- {{placeholders}} allowed
  `body_text` mediumtext NOT NULL,
  `body_html` mediumtext DEFAULT NULL,
  `variables` json NOT NULL,                              -- [{ "name": "patientName", "required": true, "description": "..." }]
  `default_version` int unsigned NOT NULL DEFAULT 1,      -- platform defaults: bumped when the shipped text changes
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  -- MySQL unique keys ignore NULLs, so "no tenant" needs a stand-in value to take part in the key.
  `tenant_key` char(36) GENERATED ALWAYS AS (IFNULL(`tenant_uuid`, '')) STORED,
  PRIMARY KEY (`template_id`),
  UNIQUE KEY `uk_templates_scope` (`tenant_key`,`template_key`,`channel`,`locale`),
  KEY `idx_templates_key` (`template_key`,`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 2. notifications — the outbox and the delivery log
-- =============================================================
CREATE TABLE `notifications` (
  `notification_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `notification_uuid` char(36) NOT NULL,
  `tenant_uuid` char(36) NOT NULL,
  `channel` varchar(20) NOT NULL DEFAULT 'EMAIL',
  `template_key` varchar(60) NOT NULL,
  `category` varchar(20) NOT NULL,
  `recipient_address` varchar(255) NOT NULL,              -- the email address; masked in every API response
  `recipient_name` varchar(150) DEFAULT NULL,
  `subject` varchar(255) NOT NULL,
  `body_text` mediumtext DEFAULT NULL,                    -- wiped once delivered
  `body_html` mediumtext DEFAULT NULL,                    -- wiped once delivered
  `status` varchar(20) NOT NULL DEFAULT 'PENDING',        -- PENDING / SENDING / SENT / FAILED / CANCELLED / SUPPRESSED
  `priority` tinyint unsigned NOT NULL DEFAULT 5,         -- 1 = most urgent
  `scheduled_at` datetime(6) NOT NULL,                    -- not before this moment (a reminder for tomorrow 9am)
  `next_attempt_at` datetime(6) NOT NULL,                 -- the dispatcher picks rows whose time has come
  `locked_until` datetime(6) DEFAULT NULL,                -- claimed by a worker until then; a crashed worker's rows are released
  `attempts` smallint unsigned NOT NULL DEFAULT 0,
  `max_attempts` smallint unsigned NOT NULL DEFAULT 5,
  `last_error` varchar(500) DEFAULT NULL,
  `provider` varchar(30) DEFAULT NULL,                    -- smtp / log
  `provider_message_id` varchar(255) DEFAULT NULL,
  `sent_at` datetime(6) DEFAULT NULL,
  `idempotency_key` varchar(100) DEFAULT NULL,            -- the same key twice returns the first notification
  `source_service` varchar(50) DEFAULT NULL,              -- appointment-admin-service, identity-admin-service ...
  `source_ref` varchar(100) DEFAULT NULL,                 -- e.g. appointment:123
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`notification_id`),
  UNIQUE KEY `uk_notifications_uuid` (`notification_uuid`),
  UNIQUE KEY `uk_notifications_idempotency` (`tenant_uuid`,`idempotency_key`),
  KEY `idx_notifications_dispatch` (`status`,`next_attempt_at`,`priority`),
  KEY `idx_notifications_tenant_created` (`tenant_uuid`,`created_on`),
  KEY `idx_notifications_source` (`tenant_uuid`,`source_service`,`source_ref`),
  KEY `idx_notifications_retention` (`status`,`created_on`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 3. notification_attempts — what happened each time delivery was tried
-- =============================================================
CREATE TABLE `notification_attempts` (
  `attempt_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `notification_id` bigint unsigned NOT NULL,
  `attempt_no` smallint unsigned NOT NULL,
  `outcome` varchar(20) NOT NULL,                         -- SENT / RETRY / FAILED
  `error` varchar(500) DEFAULT NULL,
  `provider_response` varchar(500) DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`attempt_id`),
  KEY `idx_attempts_notification` (`notification_id`),
  CONSTRAINT `fk_attempts_notification` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`notification_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 4. notification_suppressions — do not write to these addresses
-- A hard bounce adds one automatically. Consent withdrawal (when consent capture
-- exists) will add rows with reason CONSENT_WITHDRAWN. category NULL = every
-- category except SECURITY (a "your password was reset" notice always goes out
-- unless the address is undeliverable, i.e. BOUNCED).
-- =============================================================
CREATE TABLE `notification_suppressions` (
  `suppression_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) NOT NULL,
  `channel` varchar(20) NOT NULL DEFAULT 'EMAIL',
  `address` varchar(255) NOT NULL,                        -- stored lower-case
  `category` varchar(20) DEFAULT NULL,
  `reason` varchar(30) NOT NULL,                          -- UNSUBSCRIBED / BOUNCED / COMPLAINT / CONSENT_WITHDRAWN / MANUAL
  `note` varchar(255) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',         -- ACTIVE / LIFTED
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `lifted_by` bigint unsigned DEFAULT NULL,
  `lifted_on` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`suppression_id`),
  KEY `idx_suppressions_lookup` (`tenant_uuid`,`channel`,`address`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =============================================================
-- 5. tenant_channel_settings
-- Without a row a tenant uses the platform's mail account and defaults.
-- The SMTP password is stored ENCRYPTED (AES-256-GCM, NOTIFICATION_ENCRYPTION_KEY)
-- and is never returned by the API.
-- =============================================================
CREATE TABLE `tenant_channel_settings` (
  `setting_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) NOT NULL,
  `channel` varchar(20) NOT NULL DEFAULT 'EMAIL',
  `is_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `from_name` varchar(150) DEFAULT NULL,
  `from_address` varchar(255) DEFAULT NULL,               -- used as From only with the tenant's OWN SMTP; otherwise it becomes Reply-To
  `reply_to` varchar(255) DEFAULT NULL,
  `smtp_host` varchar(255) DEFAULT NULL,
  `smtp_port` smallint unsigned DEFAULT NULL,
  `smtp_secure` tinyint(1) NOT NULL DEFAULT 0,
  `smtp_user` varchar(255) DEFAULT NULL,
  `smtp_password_enc` text DEFAULT NULL,
  `hourly_limit` int unsigned DEFAULT NULL,               -- messages per hour for the tenant; NULL = the default (500)
  `quiet_hours_start` char(5) DEFAULT NULL,               -- "21:00": reminders wait until quiet_hours_end
  `quiet_hours_end` char(5) DEFAULT NULL,                 -- "07:00"
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`setting_id`),
  UNIQUE KEY `uk_channel_settings_tenant_channel` (`tenant_uuid`,`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
