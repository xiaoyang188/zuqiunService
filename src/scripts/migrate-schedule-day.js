require('dotenv').config();
const { runSqlFile } = require('./init-db-helpers');

async function main() {
  const count = await runSqlFile('migration-schedule-day.sql');
  console.log(`✅ schedule_day 迁移完成（${count} 条语句）`);
  console.log('请执行 npm run sync:once 回填今日/明日 schedule_day');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
