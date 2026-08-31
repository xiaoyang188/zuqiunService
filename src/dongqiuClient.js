/**
 * 懂球帝 / dongqiu.org 数据源客户端
 * 与 ESPN 并列；中超等赛事优先走本源。
 *
 * 实测入口：
 * - 赛程列表：api.dongqiudi.com/data/tab/league/new/{competitionId}
 * - 积分榜/轮次赛程/射手榜：dongqiu.org/af-v2/soccer/biz/data/*
 * - 球员/球队详情：dongqiu.org/af-v2/soccer/biz/dqd/{person|team}/detail/{id}
 * - 搜索：api.dongqiudi.com/search
 */

const https = require('https');

const AF_HOST = 'dongqiu.org';
const AF_PREFIX = '/af-v2';
const DQD_API_HOST = 'api.dongqiudi.com';
const USER_AGENT = 'zuqiu-server/1.0 (dongqiu)';

/** 联赛元数据（dongqiu.org league page 实测） */
const DONGQIU_LEAGUES = {
  'Chinese Super League': {
    competitionId: '43',
    seasonId: '26322',
    roundId: '493294',
    slug: 'CSL',
    label: '中超',
  },
};

function request(hostname, path, { timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          Referer: 'https://dongqiu.org/',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`Dongqiu HTTP ${res.statusCode} ${path}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('Dongqiu 请求超时')));
    req.end();
  });
}

function afGet(resourcePath, query = {}) {
  const qs = new URLSearchParams({
    version: '0',
    platform: 'ios',
    language: 'zh-cn',
    ...query,
  });
  // 去掉空值
  for (const [k, v] of [...qs.entries()]) {
    if (v == null || v === '') qs.delete(k);
  }
  return request(AF_HOST, `${AF_PREFIX}${resourcePath}?${qs.toString()}`);
}

function dqdGet(resourcePath) {
  return request(DQD_API_HOST, resourcePath);
}

function getLeagueMeta(leagueKey) {
  return DONGQIU_LEAGUES[leagueKey] || null;
}

function isDongqiuLeague(leagueKey) {
  return Boolean(DONGQIU_LEAGUES[leagueKey]);
}

/** 积分榜 */
async function fetchStandings(leagueKey = 'Chinese Super League') {
  const meta = getLeagueMeta(leagueKey);
  if (!meta) return [];
  const data = await afGet('/soccer/biz/data/standing', { season_id: meta.seasonId });
  const round =
    (data?.content?.rounds || []).find((r) => r.template?.includes('regular')) ||
    data?.content?.rounds?.[0];
  return round?.content?.data || [];
}

/** 近期赛程（联赛 Tab，含比分状态，适合今日/本周同步） */
async function fetchLeagueTabMatches(leagueKey = 'Chinese Super League') {
  const meta = getLeagueMeta(leagueKey);
  if (!meta) return [];
  const data = await dqdGet(`/data/tab/league/new/${meta.competitionId}`);
  return data?.list || [];
}

/** 指定轮次赛程 */
async function fetchScheduleRound(leagueKey, gameweek) {
  const meta = getLeagueMeta(leagueKey);
  if (!meta) return [];
  const data = await afGet('/soccer/biz/data/schedule', {
    season_id: meta.seasonId,
    round_id: meta.roundId,
    gameweek: String(gameweek),
  });
  return data?.content?.matches || [];
}

/** 拉取多轮赛程（默认近几轮 + 未来几轮，避免一次打 30 次） */
async function fetchRecentSchedule(leagueKey = 'Chinese Super League', weeks = null) {
  const meta = getLeagueMeta(leagueKey);
  if (!meta) return [];
  const list = weeks || guessActiveGameweeks();
  const batches = await Promise.all(
    list.map(async (gw) => {
      try {
        return await fetchScheduleRound(leagueKey, gw);
      } catch {
        return [];
      }
    })
  );
  const map = new Map();
  batches.flat().forEach((m) => {
    if (m?.match_id) map.set(String(m.match_id), m);
  });
  return Array.from(map.values());
}

function guessActiveGameweeks() {
  // 中超约 30 轮；取 15–30 覆盖赛季中后段，再加 1–5 兜底
  const set = new Set();
  for (let i = 15; i <= 30; i += 1) set.add(i);
  for (let i = 1; i <= 5; i += 1) set.add(i);
  return Array.from(set);
}

/** 射手榜 / 助攻榜 type: goals | assists */
async function fetchPersonRanking(leagueKey = 'Chinese Super League', type = 'goals') {
  const meta = getLeagueMeta(leagueKey);
  if (!meta) return [];
  const data = await afGet('/soccer/biz/data/person_ranking', {
    season_id: meta.seasonId,
    type,
  });
  return data?.content?.data || [];
}

/** 球员详情 */
async function fetchPersonDetail(personId) {
  const id = String(personId).replace(/^dq_player_/, '');
  return afGet(`/soccer/biz/dqd/person/detail/${id}`, { lang: 'zh-cn' });
}

/** 球队详情 */
async function fetchTeamDetail(teamId) {
  const id = String(teamId).replace(/^dq_team_/, '');
  return afGet(`/soccer/biz/dqd/team/detail/${id}`, { lang: 'zh-cn' });
}

/** 队友/阵容（通过球员维度） */
async function fetchPersonTeammates(personId) {
  const id = String(personId).replace(/^dq_player_/, '');
  try {
    return await afGet(`/soccer/biz/dqd/person/teammate/${id}`, {});
  } catch {
    return null;
  }
}

function stripHtml(name) {
  return String(name || '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/** 搜索球员 / 球队 */
async function search(keyword, page = 1) {
  const q = String(keyword || '').trim();
  if (!q) return { players: [], teams: [] };
  const data = await dqdGet(
    `/search?keywords=${encodeURIComponent(q)}&type=all&page=${page}`
  );
  const players = (data?.players || []).map((p) => ({
    type: 'player',
    id: String(p.person_id || p._raw_id || ''),
    name: stripHtml(p.person_name) || p.person_en_name || '',
    subtitle: [p.team, p.position, p.nationality].filter(Boolean).join(' · '),
    logo: p.person_img || '',
    leagueSlug: 'chn.1',
    leagueKey: 'Chinese Super League',
    leagueLabel: '中超',
    source: 'dongqiu',
    enName: p.person_en_name || '',
    team: p.team || '',
    nationality: p.nationality || '',
    age: p.age || null,
  }));
  const teams = (data?.teams || []).map((t) => ({
    type: 'team',
    id: String(t.team_id || t._raw_id || ''),
    name: stripHtml(t.team_name) || t.team_en_name || '',
    subtitle: t.country || '',
    logo: t.team_img || '',
    leagueSlug: '',
    leagueKey: null,
    leagueLabel: t.country || '',
    source: 'dongqiu',
    enName: t.team_en_name || '',
    venue: t.venue_name || '',
  }));
  return { players, teams };
}

module.exports = {
  DONGQIU_LEAGUES,
  getLeagueMeta,
  isDongqiuLeague,
  fetchStandings,
  fetchLeagueTabMatches,
  fetchScheduleRound,
  fetchRecentSchedule,
  fetchPersonRanking,
  fetchPersonDetail,
  fetchTeamDetail,
  fetchPersonTeammates,
  search,
};
