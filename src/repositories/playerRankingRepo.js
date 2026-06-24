const { getPool } = require('../db');

function parsePayload(row) {
  if (!row) return [];
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return Array.isArray(payload) ? payload : [];
}

/** 全量替换：射手榜 / 助攻榜 */
async function replaceRankings(leagueKey, kind, rows) {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO player_rankings (league_key, kind, payload, synced_at)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), synced_at = NOW()`,
    [leagueKey, kind, JSON.stringify(rows)]
  );
}

async function findByLeague(leagueKey, kind) {
  try {
    const pool = getPool();
    if (!pool) return [];
    const [rows] = await pool.execute(
      `SELECT payload FROM player_rankings WHERE league_key = ? AND kind = ? LIMIT 1`,
      [leagueKey, kind]
    );
    return parsePayload(rows[0]);
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE') return [];
    throw e;
  }
}

module.exports = {
  replaceRankings,
  findByLeague,
};
