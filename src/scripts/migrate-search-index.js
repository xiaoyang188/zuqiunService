require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool, isDbEnabled, closeDb, pingDb } = require('../db');

async function main() {
  if (!isDbEnabled()) {
    console.error('请配置 USE_DATABASE=true');
    process.exit(1);
  }
  await pingDb();
  const sqlPath = path.join(__dirname, '../../sql/migrate-search-index.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const pool = getPool();
  await pool.query(sql);
  console.log('✅ search_index 表已就绪');
  await closeDb();
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
