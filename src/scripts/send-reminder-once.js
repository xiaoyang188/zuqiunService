require('dotenv').config();
const { sendReminderOnce } = require('../sync/sendReminder');
const { closeDb, isDbEnabled } = require('../db');

async function main() {
  if (!isDbEnabled()) {
    console.error('需要 USE_DATABASE=true');
    process.exit(1);
  }
  const result = await sendReminderOnce();
  console.log(JSON.stringify(result, null, 2));
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
