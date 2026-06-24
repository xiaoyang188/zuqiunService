const mysql = require('mysql2/promise');

let pool = null;

function isDbEnabled() {
  return process.env.USE_DATABASE === 'true' && Boolean(process.env.DB_HOST);
}

function getPool() {
  if (!isDbEnabled()) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'zuqiu',
      waitForConnections: true,
      connectionLimit: 10,
      timezone: '+08:00',
      enableKeepAlive: true,
    });
  }
  return pool;
}

async function pingDb() {
  const p = getPool();
  if (!p) return false;
  await p.query('SELECT 1');
  return true;
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { isDbEnabled, getPool, pingDb, closeDb };
