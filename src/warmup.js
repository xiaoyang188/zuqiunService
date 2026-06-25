const { isDbEnabled } = require('./db');
const dataService = require('./dataService');
const { HOT_LEAGUE_KEYS } = require('./leagueCodes');
const { cachedStale } = require('./cache');

const TTL = {
  today: 60_000,
  todayStale: 10 * 60_000,
  week: 120_000,
  weekStale: 15 * 60_000,
  standings: 300_000,
  standingsStale: 30 * 60_000,
};

let timer = null;

async function warmSchedule(dateRange) {
  const key = `schedule:${dateRange}:`;
  const ttl = dateRange === 'week' ? TTL.week : TTL.today;
  const stale = dateRange === 'week' ? TTL.weekStale : TTL.todayStale;
  await cachedStale(key, ttl, stale, () => dataService.getSchedule(dateRange));
}

async function warmStandings(league) {
  const key = `standings:${league}`;
  await cachedStale(key, TTL.standings, TTL.standingsStale, () =>
    dataService.getStandings(league)
  );
}

async function runWarmup() {
  const tasks = [warmSchedule('today'), warmSchedule('week')];
  for (const league of HOT_LEAGUE_KEYS) {
    tasks.push(warmStandings(league));
  }
  await Promise.allSettled(tasks);
}

function startWarmup() {
  if (isDbEnabled()) return;

  console.log('[warmup] ESPN 代理模式：后台预热缓存');
  runWarmup()
    .then(() => console.log('[warmup] 首次预热完成'))
    .catch((e) => console.warn('[warmup] 预热失败:', e.message));

  const intervalMs = Number(process.env.WARMUP_INTERVAL_MS) || 3 * 60_000;
  timer = setInterval(() => {
    runWarmup().catch((e) => console.warn('[warmup] 刷新失败:', e.message));
  }, intervalMs);
}

function stopWarmup() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startWarmup, stopWarmup, runWarmup, TTL };
