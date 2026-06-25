const { getPool } = require('../db');

async function exists(userId, matchExternalId, advanceMinutes) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT 1 FROM reminder_sent_log
     WHERE user_id = ? AND match_external_id = ? AND advance_minutes = ? LIMIT 1`,
    [userId, String(matchExternalId), advanceMinutes]
  );
  return rows.length > 0;
}

async function markSent(userId, matchExternalId, advanceMinutes) {
  const pool = getPool();
  await pool.execute(
    `INSERT IGNORE INTO reminder_sent_log (user_id, match_external_id, advance_minutes)
     VALUES (?, ?, ?)`,
    [userId, String(matchExternalId), advanceMinutes]
  );
}

/** 清理 30 天前的发送记录 */
async function pruneOld(days = 30) {
  const pool = getPool();
  const [result] = await pool.execute(
    `DELETE FROM reminder_sent_log WHERE sent_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );
  return result.affectedRows || 0;
}

module.exports = { exists, markSent, pruneOld };
