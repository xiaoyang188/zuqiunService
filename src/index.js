require('dotenv').config();
const express = require('express');
let compression;
try {
  compression = require('compression');
} catch {
  compression = null;
  console.warn('[api] compression 未安装，响应不压缩（请在 server 目录执行 npm install）');
}
const cors = require('cors');
const https = require('https');
const http = require('http');
const { cached, cachedStale } = require('./cache');
const { isDbEnabled } = require('./db');
const { APP_LEAGUES, buildLeagues } = require('./leagueCodes');
const dataService = require('./dataService');
const { startScheduler } = require('./sync/scheduler');
const { startWarmup, TTL: WARMUP_TTL } = require('./warmup');
const userRoutes = require('./routes/userRoutes');
const { isWechatConfigured, getReminderTemplateId } = require('./wechat/wechatService');

const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(compression ? compression() : (_req, _res, next) => next());
app.use(cors());
app.use(express.json());

const IMAGE_PROXY_HOSTS = new Set(['stitcher.espn.com', 's.secure.espncdn.com', 'a.espncdn.com']);

app.get('/api/proxy-image', (req, res) => {
  const raw = String(req.query.url || '');
  if (!raw) {
    res.status(400).end();
    return;
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    res.status(400).end();
    return;
  }
  if (!IMAGE_PROXY_HOSTS.has(parsed.hostname)) {
    res.status(403).end();
    return;
  }
  const client = parsed.protocol === 'http:' ? http : https;
  client
    .get(raw, (upstream) => {
      if (upstream.statusCode && upstream.statusCode >= 400) {
        res.status(upstream.statusCode).end();
        upstream.resume();
        return;
      }
      res.set('Content-Type', upstream.headers['content-type'] || 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      upstream.pipe(res);
    })
    .on('error', () => res.status(502).end());
});

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(message, code = 1) {
  return { code, data: null, message };
}

function parseMatchId(raw) {
  return String(raw).replace(/^(espn_match_|fd_match_)/, '');
}

/** stale-while-revalidate：热数据 TTL 内直返；过期先返旧值并后台刷新，避免冷启动 3～20s */
const TTL = {
  today: WARMUP_TTL.today,
  todayStale: WARMUP_TTL.todayStale,
  tomorrow: 90_000,
  week: WARMUP_TTL.week,
  weekStale: WARMUP_TTL.weekStale,
  standings: WARMUP_TTL.standings,
  standingsStale: WARMUP_TTL.standingsStale,
  match: 45_000,
  matchStale: 5 * 60_000,
  bracket: 300_000,
  bracketStale: 30 * 60_000,
  scorers: 300_000,
  teams: 600_000,
  player: 600_000,
  health: 10_000,
};

function cacheSchedule(dateRange, league, fetcher) {
  const key = `schedule:${dateRange}:${league || ''}`;
  if (dateRange === 'week') {
    return cachedStale(key, TTL.week, TTL.weekStale, fetcher);
  }
  if (dateRange === 'today' && !league) {
    return cachedStale(key, TTL.today, TTL.todayStale, fetcher);
  }
  const ttl = dateRange === 'tomorrow' ? TTL.tomorrow : TTL.today;
  return cached(key, ttl, fetcher);
}

function cacheStandings(league, fetcher) {
  return cachedStale(`standings:${league}`, TTL.standings, TTL.standingsStale, fetcher);
}

app.get('/api/health', async (_req, res) => {
  try {
    const extra = await cached('health:extra', TTL.health, () => dataService.getHealthExtra());
    res.json(
      ok({
        status: 'up',
        ...extra,
        wechat: isWechatConfigured(),
        reminderTemplate: Boolean(getReminderTemplateId()),
      })
    );
  } catch (e) {
    res.status(500).json(fail(e.message || 'health check failed'));
  }
});

app.get('/api/leagues', (req, res) => {
  const scope = String(req.query.scope || 'hot');
  const allowed = new Set(['hot', 'filter', 'standings', 'all']);
  if (!allowed.has(scope)) {
    res.status(400).json(fail('scope 无效，可选 hot / filter / standings / all'));
    return;
  }
  res.json(ok(buildLeagues(scope)));
});

/** 与 schedule?dateRange=today 共用缓存 */
app.get('/api/matches/today', async (_req, res) => {
  try {
    const matches = await cacheSchedule('today', '', () => dataService.getSchedule('today'));
    res.json(ok(matches));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取今日比赛失败'));
  }
});

app.get('/api/schedule', async (req, res) => {
  const dateRange = req.query.dateRange || 'today';
  const league = req.query.league || '';
  if (!['today', 'tomorrow', 'week'].includes(dateRange)) {
    res.status(400).json(fail('dateRange 无效'));
    return;
  }
  try {
    const matches = await cacheSchedule(dateRange, league, () =>
      dataService.getSchedule(dateRange, league || undefined)
    );
    res.json(ok(matches));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取赛程失败'));
  }
});

app.get('/api/matches/:id', async (req, res) => {
  const eventId = parseMatchId(req.params.id);
  const leagueHint = req.query.league ? decodeURIComponent(String(req.query.league)) : '';
  if (!/^\d+$/.test(eventId)) {
    res.status(404).json(fail('比赛不存在'));
    return;
  }
  try {
    const key = `match:${eventId}:${leagueHint || 'auto'}`;
    const match = await cachedStale(key, TTL.match, TTL.matchStale, () =>
      dataService.getMatchDetail(eventId, leagueHint || undefined)
    );
    res.json(ok(match));
  } catch (e) {
    res.status(404).json(fail(e.message || '比赛不存在'));
  }
});

app.get('/api/standings/:league', async (req, res) => {
  const league = decodeURIComponent(req.params.league);
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const rows = await cacheStandings(league, () => dataService.getStandings(league));
    res.json(ok(rows));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取积分榜失败'));
  }
});

app.get('/api/bracket/:league', async (req, res) => {
  const league = decodeURIComponent(req.params.league);
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const key = `bracket:${league}`;
    const rounds = await cachedStale(key, TTL.bracket, TTL.bracketStale, () =>
      dataService.getBracket(league)
    );
    res.json(ok(rounds));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取淘汰赛对阵失败'));
  }
});

app.get('/api/scorers/:league', async (req, res) => {
  const league = decodeURIComponent(req.params.league);
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const key = `scorers:${league}:${limit}`;
    const rows = await cached(key, TTL.scorers, () => dataService.getScorers(league, limit));
    res.json(ok(rows));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取射手榜失败'));
  }
});

app.get('/api/assists/:league', async (req, res) => {
  const league = decodeURIComponent(req.params.league);
  const limit = Math.min(Number(req.query.limit) || 5, 20);
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const key = `assists:${league}:${limit}`;
    const rows = await cached(key, TTL.scorers, () => dataService.getAssists(league, limit));
    res.json(ok(rows));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取助攻榜失败'));
  }
});

app.get('/api/teams', async (req, res) => {
  const league = req.query.league || 'World Cup';
  const keyword = (req.query.keyword || '').trim();
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const key = `teams:${league}:${keyword}`;
    const teams = await cached(key, TTL.teams, () =>
      dataService.getTeams(league, keyword || undefined)
    );
    res.json(ok(teams));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取球队失败'));
  }
});

function parsePlayerId(raw) {
  return String(raw).replace(/^espn_player_/, '');
}

app.get('/api/players/:id', async (req, res) => {
  const athleteId = parsePlayerId(req.params.id);
  const league = decodeURIComponent(req.query.league || 'World Cup');
  if (!/^\d+$/.test(athleteId)) {
    res.status(400).json(fail('球员 ID 无效'));
    return;
  }
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const key = `player:${athleteId}:${league}`;
    const player = await cached(key, TTL.player, () =>
      dataService.getPlayerDetail(athleteId, league)
    );
    res.json(ok(player));
  } catch (e) {
    res.status(404).json(fail(e.message || '球员不存在'));
  }
});

app.use('/api', userRoutes);

app.listen(PORT, () => {
  console.log(`足球赛况 API  http://127.0.0.1:${PORT}`);
  if (isDbEnabled()) {
    console.log('读库模式: API 仅查 MySQL，ESPN 由定时同步写入');
  } else {
    console.warn('⚠️  USE_DATABASE 未启用：API 将实时代理 ESPN（仅适合本地调试）');
    console.warn('    生产环境请在 .env 配置 USE_DATABASE=true 并执行 npm run db:init && npm run sync:once');
    startWarmup();
  }
  startScheduler();
});
