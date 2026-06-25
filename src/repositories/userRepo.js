const { getPool } = require('../db');
const { generateToken, getTokenTtlMs } = require('../wechat/wechatService');

function tokenExpiresAt() {
  return new Date(Date.now() + getTokenTtlMs());
}

async function upsertByOpenid(openid) {
  const pool = getPool();
  const token = generateToken();
  const expiresAt = tokenExpiresAt();

  const [existing] = await pool.execute(`SELECT id FROM users WHERE openid = ? LIMIT 1`, [openid]);

  if (existing.length) {
    await pool.execute(
      `UPDATE users SET token = ?, token_expires_at = ?, updated_at = NOW() WHERE openid = ?`,
      [token, expiresAt, openid]
    );
    return { id: existing[0].id, openid, token, expiresAt };
  }

  const [result] = await pool.execute(
    `INSERT INTO users (openid, token, token_expires_at) VALUES (?, ?, ?)`,
    [openid, token, expiresAt]
  );
  return { id: result.insertId, openid, token, expiresAt };
}

async function findByToken(token) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, openid, token, token_expires_at FROM users
     WHERE token = ? AND token_expires_at > NOW() LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

async function findById(userId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT id, openid FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

module.exports = { upsertByOpenid, findByToken, findById };
