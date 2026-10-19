module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'TenantChannelSetting',
    {
      settingId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'setting_id' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'EMAIL', field: 'channel' },
      isEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_enabled' },
      fromName: { type: DataTypes.STRING(150), allowNull: true, field: 'from_name' },
      fromAddress: { type: DataTypes.STRING(255), allowNull: true, field: 'from_address' },
      replyTo: { type: DataTypes.STRING(255), allowNull: true, field: 'reply_to' },
      smtpHost: { type: DataTypes.STRING(255), allowNull: true, field: 'smtp_host' },
      smtpPort: { type: DataTypes.INTEGER, allowNull: true, field: 'smtp_port' },
      smtpSecure: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'smtp_secure' },
      smtpUser: { type: DataTypes.STRING(255), allowNull: true, field: 'smtp_user' },
      smtpPasswordEnc: { type: DataTypes.TEXT, allowNull: true, field: 'smtp_password_enc' }, // AES-256-GCM, never returned
      hourlyLimit: { type: DataTypes.INTEGER, allowNull: true, field: 'hourly_limit' },
      quietHoursStart: { type: DataTypes.STRING(5), allowNull: true, field: 'quiet_hours_start' },
      quietHoursEnd: { type: DataTypes.STRING(5), allowNull: true, field: 'quiet_hours_end' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'tenant_channel_settings',
      freezeTableName: true,
      timestamps: false,
      indexes: [{ unique: true, fields: ['tenant_uuid', 'channel'] }],
    },
  );
