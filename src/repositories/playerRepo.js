const { getPool } = require('../db');

function rowToPlayer(row) {
  if (!row) return null;
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return payload;
}

async function upsertPlayer(externalId, leagueKey, player) {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO players (external_id, league_key, payload, synced_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), synced_at = NOW()`,
    [String(externalId), leagueKey, JSON.stringify(player)]
  );
}

async function findByExternalId(externalId, leagueKey) {
  try {
    const pool = getPool();
    if (!pool) return null;
    const [rows] = await pool.execute(
      `SELECT payload FROM players WHERE external_id = ? AND league_key = ? LIMIT 1`,
      [String(externalId), leagueKey]
    );
    return rowToPlayer(rows[0]);
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return null;
    throw e;
  }
}

module.exports = {
  upsertPlayer,
  findByExternalId,
};
