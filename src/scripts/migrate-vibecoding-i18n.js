require('dotenv').config();
const { getPool, isDbEnabled, closeDb, pingDb } = require('../db');
const { runSqlFile } = require('./init-db-helpers');

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  if (!isDbEnabled()) {
    console.error('请在 .env 中配置 USE_DATABASE=true 及 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME');
    process.exit(1);
  }

  await pingDb();
  const pool = getPool();

  if (await columnExists(pool, 'vibecoding_items', 'title_zh')) {
    console.log('⏭ title_zh 列已存在，跳过迁移');
  } else {
    const count = await runSqlFile('migration-vibecoding-i18n.sql');
    console.log(`✅ VibeCoding i18n 迁移完成（${count} 条语句）`);
  }

  await closeDb();
}

main().catch((e) => {
  console.error('❌ 迁移失败:', e.message);
  process.exit(1);
});
