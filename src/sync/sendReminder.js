const { isDbEnabled } = require('../db');
const reminderRepo = require('../repositories/reminderRepo');
const reminderSentRepo = require('../repositories/reminderSentRepo');
const matchRepo = require('../repositories/matchRepo');
const { sendMatchReminder, isWechatConfigured, getReminderTemplateId } = require('../wechat/wechatService');
const { writeSyncLog } = require('../repositories/syncLogRepo');

let running = false;

/**
 * 扫描已开启的球队提醒，在「开球前 advanceMinutes」时间窗口内发送订阅消息。
 * 默认每 5 分钟跑一次（REMINDER_SEND_MS），窗口与扫描间隔一致，避免漏发/重复。
 */
async function sendReminderOnce() {
  if (!isDbEnabled()) return { skipped: true, reason: 'db disabled' };
  if (!isWechatConfigured()) return { skipped: true, reason: 'wechat not configured' };
  if (!getReminderTemplateId()) return { skipped: true, reason: 'template not configured' };
  if (running) return { skipped: true, reason: 'busy' };

  running = true;
  const startedAt = new Date();
  let sent = 0;
  let failed = 0;
  let scanned = 0;

  try {
    const scanMs = Number(process.env.REMINDER_SEND_MS) || 5 * 60 * 1000;
    const scanMinutes = Math.max(1, Math.ceil(scanMs / 60_000));
    const reminders = await reminderRepo.findAllEnabled();
    scanned = reminders.length;

    for (const row of reminders) {
      const teamFullId = `espn_team_${row.team_external_id}`;
      const matches = await matchRepo.findDueForReminder(
        teamFullId,
        row.advance_minutes,
        scanMinutes
      );

      for (const matchRow of matches) {
        const already = await reminderSentRepo.exists(
          row.user_id,
          matchRow.external_id,
          row.advance_minutes
        );
        if (already) continue;

        try {
          await sendMatchReminder(row.openid, matchRow, row.advance_minutes);
          await reminderSentRepo.markSent(row.user_id, matchRow.external_id, row.advance_minutes);
          sent += 1;
        } catch (e) {
          failed += 1;
          const code = e.errcode;
          // 43101 用户拒绝订阅；47003 模板参数不匹配等
          console.warn(
            `[sendReminder] user=${row.user_id} match=${matchRow.external_id} err=${code || ''} ${e.message}`
          );
        }
      }
    }

    if (Math.random() < 0.05) {
      await reminderSentRepo.pruneOld(Number(process.env.REMINDER_LOG_RETENTION_DAYS) || 30);
    }

    await writeSyncLog('sendReminder', 'ok', '', sent, startedAt);
    return { ok: true, scanned, sent, failed };
  } catch (e) {
    await writeSyncLog('sendReminder', 'error', e.message, sent, startedAt);
    console.error('[sendReminder] failed:', e.message);
    return { ok: false, error: e.message, sent, failed };
  } finally {
    running = false;
  }
}

module.exports = { sendReminderOnce };
