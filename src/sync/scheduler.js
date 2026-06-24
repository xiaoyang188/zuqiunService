const { isDbEnabled } = require('../db');
const {
  syncScheduleOnce,
  syncLiveOnce,
  syncStandingsOnce,
  syncTeamsOnce,
  syncAllOnce,
} = require('./syncService');

const timers = [];

function startScheduler() {
  if (!isDbEnabled() || process.env.SYNC_ENABLED === 'false') {
    console.log('[sync] 定时同步未启用（USE_DATABASE 或 SYNC_ENABLED）');
    return;
  }

  const scheduleMs = Number(process.env.SYNC_SCHEDULE_MS) || 5 * 60 * 1000;
  const liveMs = Number(process.env.SYNC_LIVE_MS) || 45 * 1000;
  const standingsMs = Number(process.env.SYNC_STANDINGS_MS) || 6 * 60 * 60 * 1000;
  const teamsMs = Number(process.env.SYNC_TEAMS_MS) || 24 * 60 * 60 * 1000;

  console.log('[sync] 启动定时同步');

  syncAllOnce().then((r) => {
    console.log('[sync] 首次全量同步完成', JSON.stringify(r));
  });

  timers.push(setInterval(() => syncScheduleOnce(), scheduleMs));
  timers.push(setInterval(() => syncLiveOnce(), liveMs));
  timers.push(setInterval(() => syncStandingsOnce(), standingsMs));
  timers.push(setInterval(() => syncTeamsOnce(), teamsMs));
}

function stopScheduler() {
  timers.forEach(clearInterval);
  timers.length = 0;
}

module.exports = { startScheduler, stopScheduler };
