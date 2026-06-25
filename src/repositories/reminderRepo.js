const { getPool } = require('../db');
const { parseTeamExternalId } = require('./followRepo');

async function listByUserId(userId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT team_external_id, advance_minutes, enabled
     FROM team_reminders WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    teamId: `espn_team_${r.team_external_id}`,
    advanceMinutes: r.advance_minutes,
    enabled: Boolean(r.enabled),
  }));
}

async function upsert(userId, teamId, advanceMinutes, enabled) {
  const pool = getPool();
  const externalId = parseTeamExternalId(teamId);
  await pool.execute(
    `INSERT INTO team_reminders (user_id, team_external_id, advance_minutes, enabled)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       advance_minutes = VALUES(advance_minutes),
       enabled = VALUES(enabled),
       updated_at = NOW()`,
    [userId, externalId, advanceMinutes, enabled ? 1 : 0]
  );
}

async function removeByTeam(userId, teamId) {
  const pool = getPool();
  const externalId = parseTeamExternalId(teamId);
  await pool.execute(`DELETE FROM team_reminders WHERE user_id = ? AND team_external_id = ?`, [
    userId,
    externalId,
  ]);
}

/** 所有已开启的提醒，联表 users 取 openid */
async function findAllEnabled() {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT tr.user_id, tr.team_external_id, tr.advance_minutes,
            u.openid
     FROM team_reminders tr
     INNER JOIN users u ON u.id = tr.user_id
     WHERE tr.enabled = 1 AND u.token_expires_at > DATE_SUB(NOW(), INTERVAL 90 DAY)`
  );
  return rows;
}

module.exports = { listByUserId, upsert, removeByTeam, findAllEnabled };
