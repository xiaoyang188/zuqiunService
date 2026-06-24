const { getPool } = require('../db');

function rowToStanding(row) {
  if (!row) return null;
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return payload;
}

async function insertStanding(conn, row, leagueKey) {
  const teamExternalId = String(row.teamId).replace(/^espn_team_/, '');
  await conn.execute(
    `INSERT INTO standings
      (league_key, team_external_id, rank, played, win, draw, lose, gf, ga, gd, points, payload, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      leagueKey,
      teamExternalId,
      row.rank ?? 0,
      row.played ?? 0,
      row.win ?? 0,
      row.draw ?? 0,
      row.lose ?? 0,
      row.gf ?? 0,
      row.ga ?? 0,
      row.gd ?? 0,
      row.points ?? 0,
      JSON.stringify(row),
    ]
  );
}

/** 全量替换：先清空该联赛旧积分榜，再写入新数据 */
async function replaceStandings(leagueKey, rows) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM standings WHERE league_key = ?', [leagueKey]);
    for (const row of rows) {
      if (row) await insertStanding(conn, row, leagueKey);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function findByLeague(leagueKey) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT payload FROM standings
     WHERE league_key = ?
     ORDER BY
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.groupName')), ''),
       CAST(JSON_EXTRACT(payload, '$.rank') AS UNSIGNED) ASC`,
    [leagueKey]
  );
  return rows.map(rowToStanding).filter(Boolean);
}

async function countByLeague(leagueKey) {
  const pool = getPool();
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM standings WHERE league_key = ?`,
    [leagueKey]
  );
  return row.cnt;
}

module.exports = {
  replaceStandings,
  findByLeague,
  countByLeague,
};
