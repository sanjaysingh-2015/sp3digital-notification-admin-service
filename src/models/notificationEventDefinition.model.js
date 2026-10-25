module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'NotificationEventDefinition',
    {
      eventId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'event_id' },
      // NULL = the platform default; set = this tenant's own definition
      tenantUuid: { type: DataTypes.UUID, allowNull: true, field: 'tenant_uuid' },
      eventKey: { type: DataTypes.STRING(60), allowNull: false, field: 'event_key' },
      displayName: { type: DataTypes.STRING(150), allowNull: false, field: 'display_name' },
      description: { type: DataTypes.STRING(255), allowNull: true, field: 'description' },
      defaultChannel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'EMAIL', field: 'default_channel' },
      defaultTemplateKey: { type: DataTypes.STRING(60), allowNull: true, field: 'default_template_key' },
      defaultLocale: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'en', field: 'default_locale' },
      defaultCategory: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'TRANSACTIONAL', field: 'default_category' },
      isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'notification_event_definitions',
      freezeTableName: true,
      timestamps: false,
      // (MySQL also keeps a generated tenant_key column so platform rows take part in the unique key.)
      indexes: [{ unique: true, fields: ['tenant_uuid', 'event_key'] }],
    },
  );
