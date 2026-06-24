const { getPool } = require('../db');

async function writeSyncLog(jobName, status, message, rowsAffected, startedAt) {
  const pool = getPool();
  if (!pool) return;
  await pool.execute(
    `INSERT INTO sync_log (job_name, status, message, rows_affected, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [jobName, status, (message || '').slice(0, 512), rowsAffected || 0, startedAt]
  );
}

module.exports = { writeSyncLog };
