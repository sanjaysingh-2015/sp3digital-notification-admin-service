-- Run against sp3digital_notifications (MySQL 8). Safe to re-run.
-- Supports the Notification menu of sp3digital-organization-admin-ui-.
USE `sp3digital_notifications`;

-- 1. Event definitions: which template/channel an event (APPOINTMENT_CONFIRMATION ...) uses by default.
--    tenant_uuid NULL = platform default; a tenant row overrides it for that tenant.
CREATE TABLE IF NOT EXISTS `notification_event_definitions` (
  `event_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_uuid` char(36) DEFAULT NULL,
  `event_key` varchar(60) NOT NULL,
  `display_name` varchar(150) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `default_channel` varchar(20) NOT NULL DEFAULT 'EMAIL',
  `default_template_key` varchar(60) DEFAULT NULL,
  `default_locale` varchar(10) NOT NULL DEFAULT 'en',
  `default_category` varchar(20) NOT NULL DEFAULT 'TRANSACTIONAL',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` bigint unsigned DEFAULT NULL,
  `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `modified_by` bigint unsigned DEFAULT NULL,
  `modified_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `tenant_key` char(36) GENERATED ALWAYS AS (IFNULL(`tenant_uuid`, '')) STORED,
  PRIMARY KEY (`event_id`),
  UNIQUE KEY `uk_event_definitions_scope` (`tenant_key`,`event_key`),
  KEY `idx_event_definitions_channel` (`default_channel`,`default_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. Channel settings gain created_by / created_on like every other table.
SET @c1 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_channel_settings' AND COLUMN_NAME = 'created_by');
SET @s1 := IF(@c1 = 0, 'ALTER TABLE `tenant_channel_settings` ADD COLUMN `created_by` bigint unsigned DEFAULT NULL AFTER `quiet_hours_end`', 'SELECT 1');
PREPARE p1 FROM @s1; EXECUTE p1; DEALLOCATE PREPARE p1;
SET @c2 := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenant_channel_settings' AND COLUMN_NAME = 'created_on');
SET @s2 := IF(@c2 = 0, 'ALTER TABLE `tenant_channel_settings` ADD COLUMN `created_on` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) AFTER `created_by`', 'SELECT 1');
PREPARE p2 FROM @s2; EXECUTE p2; DEALLOCATE PREPARE p2;
