const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const NotificationTemplate = require('./notificationTemplate.model')(sequelize, DataTypes);
const Notification = require('./notification.model')(sequelize, DataTypes);
const NotificationAttempt = require('./notificationAttempt.model')(sequelize, DataTypes);
const NotificationSuppression = require('./notificationSuppression.model')(sequelize, DataTypes);
const TenantChannelSetting = require('./tenantChannelSetting.model')(sequelize, DataTypes);

Notification.hasMany(NotificationAttempt, { as: 'attemptLog', foreignKey: 'notificationId', onDelete: 'CASCADE' });
NotificationAttempt.belongsTo(Notification, { as: 'notification', foreignKey: 'notificationId' });

module.exports = { sequelize, NotificationTemplate, Notification, NotificationAttempt, NotificationSuppression, TenantChannelSetting };
