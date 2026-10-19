// Runs ONLY the delivery worker (use with NOTIFICATION_WORKER=false on the API process).
require('dotenv').config();
const { sequelize } = require('../src/models');
const templateService = require('../src/services/templateService');
const { startWorker } = require('../src/worker/dispatcher');

(async () => {
  await sequelize.authenticate();
  await templateService.ensureDefaults();
  startWorker();
  console.log('Notification delivery worker running. Press Ctrl+C to stop.');
})().catch((error) => {
  console.error('Worker failed to start:', error.message);
  process.exit(1);
});
