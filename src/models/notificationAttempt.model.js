module.exports = (sequelize, DataTypes) =>
  sequelize.define(
    'NotificationAttempt',
    {
      attemptId: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, field: 'attempt_id' },
      notificationId: { type: DataTypes.BIGINT, allowNull: false, field: 'notification_id' },
      attemptNo: { type: DataTypes.SMALLINT, allowNull: false, field: 'attempt_no' },
      outcome: { type: DataTypes.STRING(20), allowNull: false, field: 'outcome' },
      error: { type: DataTypes.STRING(500), allowNull: true, field: 'error' },
      providerResponse: { type: DataTypes.STRING(500), allowNull: true, field: 'provider_response' },
      createdOn: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_on' },
    },
    { tableName: 'notification_attempts', freezeTableName: true, timestamps: false },
  );
