require('dotenv').config();
const { isDbEnabled, closeDb, pingDb } = require('../db');
const { syncSearchIndexOnce } = require('../sync/syncService');

async function main() {
  if (!isDbEnabled()) {
    console.error('请配置 USE_DATABASE=true');
    process.exit(1);
  }
  await pingDb();
  console.log('→ 同步搜索索引（中超球队/阵容）...');
  const result = await syncSearchIndexOnce();
  console.log(result);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
