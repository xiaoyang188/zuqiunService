require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool, isDbEnabled, closeDb, pingDb } = require('../db');

async function main() {
  if (!isDbEnabled()) {
    console.error('请在 .env 中配置 USE_DATABASE=true 及 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME');
    process.exit(1);
  }

  await pingDb();
  const sqlPath = path.join(__dirname, '../../sql/schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  const pool = getPool();
  for (const stmt of statements) {
    await pool.query(stmt);
  }

  console.log('✅ 数据库表结构初始化完成');
  await closeDb();
}

main().catch((e) => {
  console.error('❌ 初始化失败:', e.message);
  process.exit(1);
});
