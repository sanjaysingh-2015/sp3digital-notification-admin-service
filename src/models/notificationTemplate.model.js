module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'NotificationTemplate',
    {
      templateId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'template_id' },
      // NULL = the platform default; set = this tenant's override
      tenantUuid: { type: DataTypes.UUID, allowNull: true, field: 'tenant_uuid' },
      templateKey: { type: DataTypes.STRING(60), allowNull: false, field: 'template_key' },
      channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'EMAIL', field: 'channel' },
      locale: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'en', field: 'locale' },
      category: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'TRANSACTIONAL', field: 'category' },
      description: { type: DataTypes.STRING(255), allowNull: true, field: 'description' },
      subject: { type: DataTypes.STRING(255), allowNull: false, field: 'subject' },
      bodyText: { type: DataTypes.TEXT, allowNull: false, field: 'body_text' },
      bodyHtml: { type: DataTypes.TEXT, allowNull: true, field: 'body_html' },
      variables: { type: DataTypes.JSON, allowNull: false, defaultValue: [], field: 'variables' },
      defaultVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'default_version' },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ACTIVE', field: 'status' },
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      modifiedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'modified_by' },
      modifiedOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'modified_on' },
    },
    {
      tableName: 'notification_templates',
      freezeTableName: true,
      timestamps: false,
      // (MySQL also keeps a generated tenant_key column so the platform default, whose
      // tenant is NULL, takes part in this unique key. It is not mapped here.)
      indexes: [{ unique: true, fields: ['tenant_uuid', 'template_key', 'channel', 'locale'] }, { fields: ['template_key', 'channel'] }],
    },
  );
