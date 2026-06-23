require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { cached } = require('./cache');
const espn = require('./espnClient');
const {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapScorerRow,
  mapTeam,
  sortMatches,
} = require('./mapper');
const { APP_LEAGUES, buildHotLeagues } = require('./leagueCodes');

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

app.get('/api/health', (_req, res) => {
  res.json(
    ok({
      status: 'up',
      provider: 'espn',
    })
  );
});

app.get('/api/leagues', (_req, res) => {
  res.json(ok(buildHotLeagues()));
});

app.get('/api/matches/today', async (_req, res) => {
  try {
    const key = 'matches:today';
    const matches = await cached(key, 45_000, async () => {
      const raw = await espn.fetchSchedule('today');
      return sortMatches(
        raw.map(mapScheduleItem).filter(Boolean)
      );
    });
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
    const matches = await cached(key, 45_000, async () => {
      const raw = await espn.fetchSchedule(dateRange, league || undefined);
      return sortMatches(raw.map(mapScheduleItem).filter(Boolean));
    });
    res.json(ok(matches));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取赛程失败'));
  }
});

app.get('/api/matches/:id', async (req, res) => {
  const eventId = parseMatchId(req.params.id);
  if (!/^\d+$/.test(eventId)) {
    res.status(404).json(fail('比赛不存在'));
    return;
  }
  try {
    const key = `match:${eventId}`;
    const match = await cached(key, 30_000, async () => {
      const { summary, leagueKey } = await espn.fetchMatchSummary(eventId);
      const mapped = mapSummaryToMatch(summary, leagueKey);
      if (!mapped) throw new Error('比赛不存在');
      return mapped;
    });
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
    const rows = await cached(key, 300_000, async () => {
      const table = await espn.fetchStandingsRaw(league);
      return table.map((row) => mapStandingRow(row, league));
    });
    res.json(ok(rows));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取积分榜失败'));
  }
});

app.get('/api/scorers/:league', async (req, res) => {
  const league = decodeURIComponent(req.params.league);
  const limit = Math.min(Number(req.query.limit) || 5, 10);
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const key = `scorers:${league}:${limit}`;
    const rows = await cached(key, 300_000, async () => {
      const list = await espn.fetchScorersFromPlays(league, limit);
      return list.map((row, i) => mapScorerRow(row, i));
    });
    res.json(ok(rows));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取射手榜失败'));
  }
});

app.get('/api/teams', async (req, res) => {
  const league = req.query.league || 'World Cup';
  const keyword = (req.query.keyword || '').trim().toLowerCase();
  if (!APP_LEAGUES[league]) {
    res.status(400).json(fail('不支持的联赛'));
    return;
  }
  try {
    const key = `teams:${league}`;
    let teams = await cached(key, 600_000, async () => {
      const raw = await espn.fetchCompetitionTeams(league);
      return raw.map((t) => mapTeam(t, league));
    });
    if (keyword) {
      teams = teams.filter((t) => t.name.toLowerCase().includes(keyword));
    }
    res.json(ok(teams));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取球队失败'));
  }
});

app.listen(PORT, () => {
  console.log(`足球赛况 API  http://127.0.0.1:${PORT}`);
  console.log('数据源: ESPN 公开 API');
});
