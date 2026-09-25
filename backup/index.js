const cron = require('node-cron');
const { runDbBackup } = require('./scripts/db-backup');
const { runAccountsExport } = require('./scripts/accounts-export');

const dbBackupCron = process.env.DB_BACKUP_CRON || '0 2 * * *';
const accountsExportCron = process.env.ACCOUNTS_EXPORT_CRON || '0 3 * * *';

console.log(`[backup] DB backup scheduled:       ${dbBackupCron}`);
console.log(`[backup] Accounts export scheduled: ${accountsExportCron}`);
console.log('[backup] Container time zone (crontab is evaluated in this TZ):', Intl.DateTimeFormat().resolvedOptions().timeZone);

cron.schedule(dbBackupCron, () => {
  runDbBackup().catch((err) => console.error('[backup] DB backup job failed:', err));
});

cron.schedule(accountsExportCron, () => {
  runAccountsExport().catch((err) => console.error('[backup] Accounts export job failed:', err));
});

// Keep the container alive; jobs run on schedule above.
console.log('[backup] Backup service running. Waiting for scheduled jobs...');
