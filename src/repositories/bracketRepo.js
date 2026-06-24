const { getPool } = require('../db');

async function replaceBracket(leagueKey, rounds) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM brackets WHERE league_key = ?', [leagueKey]);
    if (rounds.length) {
      await conn.execute(
        `INSERT INTO brackets (league_key, payload, synced_at) VALUES (?, ?, NOW())`,
        [leagueKey, JSON.stringify(rounds)]
      );
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
    `SELECT payload FROM brackets WHERE league_key = ? LIMIT 1`,
    [leagueKey]
  );
  if (!rows.length) return null;
  const payload = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
  return Array.isArray(payload) ? payload : [];
}

module.exports = {
  replaceBracket,
  findByLeague,
};
