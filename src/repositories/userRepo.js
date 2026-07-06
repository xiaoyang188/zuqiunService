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
    `SELECT id, openid, nickname, avatar_url FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function toProfile(row) {
  return {
    nickname: row?.nickname || '',
    avatarUrl: row?.avatar_url || '',
  };
}

async function getProfile(userId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT nickname, avatar_url FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return toProfile(rows[0]);
}

async function updateProfile(userId, { nickname, avatarUrl }) {
  const pool = getPool();
  const safeNickname = String(nickname ?? '').trim().slice(0, 32);
  const safeAvatar = String(avatarUrl ?? '').trim().slice(0, 512);
  await pool.execute(
    `UPDATE users SET nickname = ?, avatar_url = ?, updated_at = NOW() WHERE id = ?`,
    [safeNickname, safeAvatar, userId]
  );
  return getProfile(userId);
}

module.exports = { upsertByOpenid, findByToken, findById, getProfile, updateProfile };
