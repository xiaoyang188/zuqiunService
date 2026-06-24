require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { cached } = require('./cache');
const { isDbEnabled } = require('./db');
const { APP_LEAGUES, buildLeagues } = require('./leagueCodes');
const dataService = require('./dataService');
const { startScheduler } = require('./sync/scheduler');

const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(cors());
app.use(express.json());

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(message, code = 1) {
  return { code, data: null, message };
}

function parseMatchId(raw) {
  return String(raw).replace(/^(espn_match_|fd_match_)/, '');
}

async function withCache(key, ttlMs, fetcher) {
  if (isDbEnabled()) return fetcher();
  return cached(key, ttlMs, fetcher);
}

app.get('/api/health', async (_req, res) => {
  try {
    const extra = await dataService.getHealthExtra();
    res.json(ok({ status: 'up', ...extra }));
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

app.get('/api/matches/today', async (_req, res) => {
  try {
    const matches = await withCache('matches:today', 45_000, () =>
      dataService.getTodayMatches()
    );
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
    const key = `schedule:${dateRange}:${league}`;
    const matches = await withCache(key, 45_000, () =>
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
    const match = await withCache(key, 30_000, () =>
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
    const key = `standings:${league}`;
    const rows = await withCache(key, 300_000, () => dataService.getStandings(league));
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
    const rounds = await withCache(key, 300_000, () => dataService.getBracket(league));
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
    const rows = await withCache(key, 300_000, () =>
      dataService.getScorers(league, limit)
    );
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
    const rows = await withCache(key, 300_000, () =>
      dataService.getAssists(league, limit)
    );
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
    let teams = await withCache(key, 600_000, () =>
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
    const player = await withCache(key, 600_000, () =>
      dataService.getPlayerDetail(athleteId, league)
    );
    res.json(ok(player));
  } catch (e) {
    res.status(404).json(fail(e.message || '球员不存在'));
  }
});

app.listen(PORT, () => {
  console.log(`足球赛况 API  http://127.0.0.1:${PORT}`);
  if (isDbEnabled()) {
    console.log('读库模式: API 仅查 MySQL，ESPN 由定时同步写入');
  } else {
    console.warn('⚠️  USE_DATABASE 未启用：API 将实时代理 ESPN（仅适合本地调试）');
    console.warn('    生产环境请在 .env 配置 USE_DATABASE=true 并执行 npm run db:init && npm run sync:once');
  }
  startScheduler();
});
