require('dotenv').config();
const { getPool, isDbEnabled, closeDb, pingDb } = require('../db');
const { runSqlFile } = require('./init-db-helpers');

async function main() {
  if (!isDbEnabled()) {
    console.error('请在 .env 中配置 USE_DATABASE=true 及 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME');
    process.exit(1);
  }

  await pingDb();
  const count = await runSqlFile('migration-user-reminder.sql');
  console.log(`✅ 用户/提醒表迁移完成（${count} 条语句）`);
  await closeDb();
}

main().catch((e) => {
  console.error('❌ 迁移失败:', e.message);
  process.exit(1);
});
