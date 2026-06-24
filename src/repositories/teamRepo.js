const { getPool } = require('../db');

async function insertTeam(conn, team) {
  const externalId = String(team._id).replace(/^espn_team_/, '');
  await conn.execute(
    `INSERT INTO teams (external_id, name, logo, country, league_key, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [externalId, team.name, team.logo || '', team.country || '', team.league || '']
  );
}

/** 全量替换：先清空该联赛旧球队，再写入新数据 */
async function replaceTeamsForLeague(leagueKey, teams) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM teams WHERE league_key = ?', [leagueKey]);
    for (const team of teams) {
      if (team) await insertTeam(conn, team);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function findByLeague(leagueKey, keyword) {
  const pool = getPool();
  let sql = `SELECT external_id, name, logo, country, league_key FROM teams WHERE league_key = ?`;
  const params = [leagueKey];
  if (keyword) {
    sql += ` AND LOWER(name) LIKE ?`;
    params.push(`%${keyword.toLowerCase()}%`);
  }
  sql += ` ORDER BY name ASC`;
  const [rows] = await pool.execute(sql, params);
  return rows.map((r) => ({
    _id: `espn_team_${r.external_id}`,
    name: r.name,
    logo: r.logo,
    country: r.country,
    league: r.league_key,
  }));
}

module.exports = { replaceTeamsForLeague, findByLeague };
