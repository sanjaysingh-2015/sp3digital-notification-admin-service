// Usage:  npm run purge               (dry run: reports what would be deleted)
//         npm run purge -- --apply    (deletes finished notifications older than NOTIFICATION_RETENTION_DAYS)
// Schedule the --apply form (e.g. nightly).
require('dotenv').config();
const { sequelize } = require('../src/models');
const { purgeOld } = require('../src/worker/purge');

(async () => {
  const apply = process.argv.includes('--apply');
  try {
    console.log(JSON.stringify(await purgeOld({ apply })));
    if (!apply) console.log('Dry run — nothing deleted. Re-run with --apply.');
  } catch (error) {
    console.error('Purge failed:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
