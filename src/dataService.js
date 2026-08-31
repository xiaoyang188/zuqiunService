const espn = require('./espnClient');
const dongqiu = require('./dongqiuClient');
const dongqiuMapper = require('./dongqiuMapper');
const { isDbEnabled, pingDb, getPool } = require('./db');
const matchRepo = require('./repositories/matchRepo');
const standingRepo = require('./repositories/standingRepo');
const bracketRepo = require('./repositories/bracketRepo');
const teamRepo = require('./repositories/teamRepo');
const playerRankingRepo = require('./repositories/playerRankingRepo');
const playerRepo = require('./repositories/playerRepo');
const { getLeaguePrimarySource, APP_LEAGUES, getLeagueKeyBySlug } = require('./leagueCodes');
const {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapTeam,
  mapAthleteDetail,
  mapTeamDetail: mapEspnTeamDetail,
  mapSearchResults: mapEspnSearchResults,
  sortMatches,
} = require('./mapper');

/**
 * 读库模式：API 优先查 MySQL。
 * 懂球帝与 ESPN 由 sync 写入；搜索 / 详情 miss 时按联赛路由实时拉取。
 */

function prefersDongqiu(leagueKey) {
  return getLeaguePrimarySource(leagueKey) === 'dongqiu';
}

function looksLikeDongqiuId(id) {
  const s = String(id || '').replace(/^(dq_player_|dq_team_|espn_player_|espn_team_)/, '');
  // 懂球帝 person/team id 多为 8 位且常以 50 开头
  return /^50\d{6,}$/.test(s) || /^5\d{7,}$/.test(s);
}

async function getTodayMatches() {
  if (isDbEnabled()) {
    return sortMatches(await matchRepo.findToday());
  }
  try {
    if (prefersDongqiu('Chinese Super League')) {
      const raw = await dongqiu.fetchLeagueTabMatches('Chinese Super League');
      const mapped = raw.map((m) => dongqiuMapper.mapMatchFromTab(m)).filter(Boolean);
      if (mapped.length) return sortMatches(mapped);
    }
  } catch {
    /* fallback espn */
  }
  const raw = await espn.fetchSchedule('today');
  return sortMatches(raw.map(mapScheduleItem).filter(Boolean));
}

async function getSchedule(dateRange, leagueKey, options = {}) {
  if (isDbEnabled()) {
    if (options.date) {
      return sortMatches(
        await matchRepo.findByCalendarDate(options.date, leagueKey || undefined)
      );
    }
    if (dateRange === 'history') {
      return matchRepo.findHistoryMatches(leagueKey || undefined);
    }
    return sortMatches(await matchRepo.findByDateRange(dateRange, leagueKey || undefined));
  }
  if (options.date || dateRange === 'history') {
    return [];
  }
  if (leagueKey && prefersDongqiu(leagueKey)) {
    try {
      const raw = await dongqiu.fetchLeagueTabMatches(leagueKey);
      const mapped = raw.map((m) => dongqiuMapper.mapMatchFromTab(m, leagueKey)).filter(Boolean);
      if (mapped.length) return sortMatches(mapped);
    } catch {
      /* espn fallback */
    }
  }
  const raw = await espn.fetchSchedule(dateRange, leagueKey || undefined);
  return sortMatches(raw.map(mapScheduleItem).filter(Boolean));
}

async function getMatchDetail(eventId, _leagueHint) {
  const id = String(eventId || '').replace(/^dq_/, '');
  if (isDbEnabled()) {
    const row =
      (await matchRepo.findByExternalId(eventId)) ||
      (await matchRepo.findByExternalId(id)) ||
      (await matchRepo.findByExternalId(`dq_${id}`));
    if (!row) throw new Error('比赛不存在');
    return matchRepo.rowToMatch(row);
  }

  if (String(eventId).startsWith('dq_') || looksLikeDongqiuId(eventId)) {
    const list = await dongqiu.fetchLeagueTabMatches('Chinese Super League');
    const hit = list.find((m) => String(m.match_id) === id);
    if (hit) {
      const mapped = dongqiuMapper.mapMatchFromTab(hit);
      if (mapped) return mapped;
    }
  }

  const { summary, leagueKey } = await espn.fetchMatchSummary(id, _leagueHint || undefined);
  const mapped = mapSummaryToMatch(summary, leagueKey);
  if (!mapped) throw new Error('比赛不存在');
  return mapped;
}

async function getStandingsLiveDongqiu(leagueKey) {
  const rows = await dongqiu.fetchStandings(leagueKey);
  return rows.map((row, i) => dongqiuMapper.mapStandingRow(row, leagueKey, i));
}

async function getStandings(leagueKey) {
  if (isDbEnabled()) {
    const cached = await standingRepo.findByLeague(leagueKey);
    if (cached?.length) return cached;
    if (prefersDongqiu(leagueKey)) {
      try {
        return await getStandingsLiveDongqiu(leagueKey);
      } catch {
        /* fall through */
      }
    }
    return cached || [];
  }
  if (prefersDongqiu(leagueKey)) {
    try {
      const rows = await getStandingsLiveDongqiu(leagueKey);
      if (rows.length) return rows;
    } catch {
      /* espn */
    }
  }
  const table = await espn.fetchStandingsRaw(leagueKey);
  return table.map((row) => mapStandingRow(row, leagueKey));
}

async function getBracket(leagueKey) {
  if (isDbEnabled()) {
    const cached = await bracketRepo.findByLeague(leagueKey);
    return cached !== null ? cached : [];
  }
  return espn.fetchKnockoutBracket(leagueKey);
}

async function getScorers(leagueKey, limit) {
  if (isDbEnabled()) {
    const rows = await playerRankingRepo.findByLeague(leagueKey, 'scorers');
    if (rows.length) return rows.slice(0, limit);
  }
  if (prefersDongqiu(leagueKey)) {
    try {
      const rows = await dongqiu.fetchPersonRanking(leagueKey, 'goals');
      return rows
        .map((row, i) => dongqiuMapper.mapScorerRow(row, i))
        .slice(0, limit);
    } catch {
      /* empty */
    }
  }
  return [];
}

async function getAssists(leagueKey, limit) {
  if (isDbEnabled()) {
    const rows = await playerRankingRepo.findByLeague(leagueKey, 'assists');
    if (rows.length) return rows.slice(0, limit);
  }
  if (prefersDongqiu(leagueKey)) {
    try {
      const rows = await dongqiu.fetchPersonRanking(leagueKey, 'assists');
      return rows
        .map((row, i) => dongqiuMapper.mapAssistRow(row, i))
        .slice(0, limit);
    } catch {
      /* empty */
    }
  }
  return [];
}

async function getTeamsFromDongqiu(leagueKey, keyword) {
  const rows = await dongqiu.fetchStandings(leagueKey);
  let teams = rows.map((r) => dongqiuMapper.mapTeamFromStanding(r, leagueKey));
  if (keyword) {
    const kw = keyword.toLowerCase();
    teams = teams.filter((t) => t.name.toLowerCase().includes(kw) || t.name.includes(keyword));
  }
  return teams;
}

async function getTeams(leagueKey, keyword) {
  if (isDbEnabled()) {
    const cached = await teamRepo.findByLeague(leagueKey, keyword);
    if (cached?.length) return cached;
    if (prefersDongqiu(leagueKey)) {
      try {
        return await getTeamsFromDongqiu(leagueKey, keyword);
      } catch {
        return cached || [];
      }
    }
    return cached || [];
  }
  if (prefersDongqiu(leagueKey)) {
    try {
      const teams = await getTeamsFromDongqiu(leagueKey, keyword);
      if (teams.length) return teams;
    } catch {
      /* espn */
    }
  }
  let teams = (await espn.fetchCompetitionTeams(leagueKey)).map((t) => mapTeam(t, leagueKey));
  if (keyword) {
    const kw = keyword.toLowerCase();
    teams = teams.filter((t) => t.name.toLowerCase().includes(kw));
  }
  return teams;
}

async function getPlayerDetailFromDongqiu(athleteId, leagueKey) {
  const raw = await dongqiu.fetchPersonDetail(athleteId);
  return dongqiuMapper.mapPersonDetail(raw, leagueKey || 'Chinese Super League');
}

async function getPlayerDetail(athleteId, leagueKey) {
  const id = String(athleteId).replace(/^(dq_player_|espn_player_)/, '');

  if (isDbEnabled()) {
    let player = null;
    if (leagueKey) {
      player = await playerRepo.findByExternalId(id, leagueKey);
      if (!player) player = await playerRepo.findByExternalId(`dq_player_${id}`, leagueKey);
    }
    if (!player) player = await playerRepo.findByExternalIdAny(id);
    if (!player) player = await playerRepo.findByExternalIdAny(`dq_player_${id}`);
    if (player) return player;
  }

  const tryDongqiu =
    prefersDongqiu(leagueKey) || looksLikeDongqiuId(id) || !leagueKey || leagueKey === 'Chinese Super League';

  if (tryDongqiu) {
    try {
      const mapped = await getPlayerDetailFromDongqiu(id, leagueKey || 'Chinese Super League');
      if (mapped) return mapped;
    } catch {
      /* espn fallback */
    }
  }

  const raw = await espn.fetchAthleteRaw(id, leagueKey || 'Chinese Super League');
  let resolvedLeague = leagueKey;
  if (!resolvedLeague || !APP_LEAGUES[resolvedLeague]) {
    const slug = (raw.defaultLeagueSlug || raw.league || '').toLowerCase();
    resolvedLeague = getLeagueKeyBySlug(slug) || leagueKey || 'Chinese Super League';
  }
  const mapped = mapAthleteDetail(raw, resolvedLeague);
  if (!mapped) throw new Error('球员不存在');
  return mapped;
}

async function search(query, limit = 20) {
  const { expandSearchQueries } = require('./zhNames');
  const queries = expandSearchQueries(query);
  const merged = { players: [], teams: [] };
  const seenP = new Set();
  const seenT = new Set();

  // 1) 懂球帝搜索（中文友好）
  for (const q of queries) {
    try {
      const raw = dongqiuMapper.mapSearchResults(await dongqiu.search(q));
      for (const p of raw.players || []) {
        if (!p.id || seenP.has(p.id)) continue;
        seenP.add(p.id);
        merged.players.push({ ...p, source: 'dongqiu' });
      }
      for (const t of raw.teams || []) {
        if (!t.id || seenT.has(t.id)) continue;
        // 过滤明显非足球噪点时可保留，交给前端
        seenT.add(t.id);
        merged.teams.push({ ...t, source: 'dongqiu' });
      }
    } catch {
      /* next */
    }
  }

  // 2) ESPN 补充
  for (const q of queries) {
    try {
      const raw = await espn.searchSoccer(q, limit);
      for (const p of raw.players || []) {
        if (seenP.has(p.id)) continue;
        seenP.add(p.id);
        merged.players.push({ ...p, source: 'espn' });
      }
      for (const t of raw.teams || []) {
        if (seenT.has(t.id)) continue;
        seenT.add(t.id);
        merged.teams.push({ ...t, source: 'espn' });
      }
    } catch {
      /* next */
    }
  }

  // 3) 中超积分榜球队中文兜底
  try {
    const csl = await getTeams('Chinese Super League');
    const kw = String(query || '').trim().toLowerCase();
    const zhKw = String(query || '').trim();
    for (const t of csl) {
      const id = String(t._id || '').replace(/^(dq_team_|espn_team_)/, '');
      if (!id || seenT.has(id)) continue;
      const name = t.name || '';
      const hit = name.toLowerCase().includes(kw) || name.includes(zhKw);
      if (!hit) continue;
      seenT.add(id);
      merged.teams.unshift({
        type: 'team',
        id,
        name,
        subtitle: '中超',
        logo: t.logo || '',
        leagueSlug: 'chn.1',
        leagueKey: 'Chinese Super League',
        leagueLabel: '中超',
        source: t.source || 'dongqiu',
      });
    }
  } catch {
    /* optional */
  }

  return {
    players: merged.players.slice(0, limit),
    teams: merged.teams.slice(0, limit),
  };
}

async function getTeamDetailFromDongqiu(teamId, leagueKey = 'Chinese Super League') {
  const id = String(teamId).replace(/^(dq_team_|espn_team_)/, '');
  const raw = await dongqiu.fetchTeamDetail(id);

  let record = null;
  try {
    const standings = await dongqiu.fetchStandings(leagueKey);
    const row = standings.find((r) => String(r.team_id) === id);
    if (row) {
      const mapped = dongqiuMapper.mapStandingRow(row, leagueKey);
      record = {
        summary: `${mapped.win}-${mapped.draw}-${mapped.lose}`,
        played: mapped.played,
        win: mapped.win,
        draw: mapped.draw,
        lose: mapped.lose,
        gf: mapped.gf,
        ga: mapped.ga,
        gd: mapped.gd,
        points: mapped.points,
        rank: mapped.rank,
      };
    }
  } catch {
    /* optional */
  }

  let roster = [];
  const seedPerson =
    raw?.team_record?.[0]?.data?.[0]?.person_id ||
    raw?.team_record?.[0]?.data?.find((p) => p.person_id)?.person_id;
  // team_record 里可能只有名字，尝试用射手榜同队球员拉队友
  let personId = seedPerson ? String(seedPerson) : '';
  if (!personId) {
    try {
      const scorers = await dongqiu.fetchPersonRanking(leagueKey, 'goals');
      const hit = scorers.find((p) => String(p.team_id) === id);
      if (hit?.person_id) personId = String(hit.person_id);
    } catch {
      /* optional */
    }
  }
  if (personId) {
    try {
      const mates = await dongqiu.fetchPersonTeammates(personId);
      roster = dongqiuMapper.mapTeammatesToRoster(mates);
    } catch {
      /* optional */
    }
  }

  let recentMatches = [];
  try {
    const tab = await dongqiu.fetchLeagueTabMatches(leagueKey);
    recentMatches = tab
      .filter((m) => String(m.team_A_id) === id || String(m.team_B_id) === id)
      .map((m) => dongqiuMapper.mapMatchFromTab(m, leagueKey))
      .filter(Boolean)
      .slice(0, 12)
      .map((m) => ({
        _id: m._id,
        matchTime: m.matchTime,
        homeTeam: m.homeTeamName,
        awayTeam: m.awayTeamName,
        homeScore: m.status === 'NS' ? null : m.homeScore,
        awayScore: m.status === 'NS' ? null : m.awayScore,
        status: m.status,
        statusText: m.periodLabel || m.status,
        league: leagueKey,
      }));
  } catch {
    /* optional */
  }

  return dongqiuMapper.mapTeamDetail(raw, { leagueKey, record, roster, recentMatches });
}

async function getTeamDetail(teamId, leagueKey) {
  const id = String(teamId).replace(/^(dq_team_|espn_team_)/, '');
  const tryDongqiu =
    prefersDongqiu(leagueKey) || looksLikeDongqiuId(id) || !leagueKey || leagueKey === 'Chinese Super League';

  if (tryDongqiu) {
    try {
      const mapped = await getTeamDetailFromDongqiu(id, leagueKey || 'Chinese Super League');
      if (mapped) return mapped;
    } catch {
      /* espn */
    }
  }

  const bundle = await espn.fetchTeamDetail(id, leagueKey || undefined);
  return mapEspnTeamDetail(bundle);
}

async function getHealthExtra() {
  const extra = {
    provider: 'espn+dongqiu',
    readMode: isDbEnabled() ? 'database-only' : 'proxy',
    sources: { espn: true, dongqiu: true },
  };
  if (isDbEnabled()) {
    extra.storage = 'mysql';
    try {
      extra.db = await pingDb();
      extra.matches = await matchRepo.countMatches();
      const pool = getPool();
      if (pool) {
        const [[lastSync]] = await pool.query(
          `SELECT job_name, status, finished_at FROM sync_log ORDER BY finished_at DESC LIMIT 1`
        );
        if (lastSync) extra.lastSync = lastSync;
      }
    } catch (e) {
      extra.db = false;
      extra.dbError = e.message;
    }
  } else {
    extra.storage = 'memory-cache';
  }
  return extra;
}

module.exports = {
  getTodayMatches,
  getSchedule,
  getMatchDetail,
  getStandings,
  getBracket,
  getScorers,
  getAssists,
  getTeams,
  getPlayerDetail,
  search,
  getTeamDetail,
  getHealthExtra,
};
