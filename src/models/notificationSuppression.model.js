module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'NotificationSuppression',
    {
      suppressionId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'suppression_id' },
      tenantUuid: { type: DataTypes.UUID, allowNull: false, field: 'tenant_uuid' },
      channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'EMAIL', field: 'channel' },
      address: { type: DataTypes.STRING(255), allowNull: false, field: 'address' },
      category: { type: DataTypes.STRING(20), allowNull: true, field: 'category' },
      reason: { type: DataTypes.STRING(30), allowNull: false, field: 'reason' },
      note: { type: DataTypes.STRING(255), allowNull: true, field: 'note' },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'ACTIVE', field: 'status' },
      createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
      liftedBy: { type: DataTypes.BIGINT, allowNull: true, field: 'lifted_by' },
      liftedOn: { type: DataTypes.DATE, allowNull: true, field: 'lifted_on' },
    },
    {
      tableName: 'notification_suppressions',
      freezeTableName: true,
      timestamps: false,
      indexes: [{ fields: ['tenant_uuid', 'channel', 'address', 'status'] }],
    },
  );
