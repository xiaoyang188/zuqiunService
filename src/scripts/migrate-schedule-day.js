require('dotenv').config();
const { getPool, isDbEnabled, closeDb, pingDb } = require('../db');

async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(pool, table, index) {
  const [rows] = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, index]
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

  if (await columnExists(pool, 'matches', 'schedule_day')) {
    console.log('⏭ schedule_day 列已存在，跳过迁移');
  } else {
    await pool.query(
      `ALTER TABLE matches
         ADD COLUMN schedule_day DATE NULL COMMENT 'ESPN 赛程日（上海 YYYY-MM-DD）' AFTER match_time`
    );
    console.log('✅ 已添加 schedule_day 列');
  }

  if (await indexExists(pool, 'matches', 'idx_schedule_day')) {
    console.log('⏭ idx_schedule_day 索引已存在，跳过');
  } else {
    await pool.query(`ALTER TABLE matches ADD KEY idx_schedule_day (schedule_day)`);
    console.log('✅ 已添加 idx_schedule_day 索引');
  }

  console.log('请执行 npm run sync:once 回填今日/明日 schedule_day');
  await closeDb();
}

main().catch((e) => {
  console.error('❌ 迁移失败:', e.message);
  process.exit(1);
});
