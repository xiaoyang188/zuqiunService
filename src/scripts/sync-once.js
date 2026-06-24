require('dotenv').config();
const { isDbEnabled, closeDb } = require('../db');
const { syncAllOnce } = require('../sync/syncService');

async function main() {
  if (!isDbEnabled()) {
    console.error('请在 .env 中配置 USE_DATABASE=true 及数据库连接');
    process.exit(1);
  }

  console.log('开始手动全量同步...');
  const result = await syncAllOnce();
  console.log(JSON.stringify(result, null, 2));
  await closeDb();
}

main().catch((e) => {
  console.error('同步失败:', e.message);
  process.exit(1);
});
