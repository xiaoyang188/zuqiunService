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
const searchIndexRepo = require('./repositories/searchIndexRepo');
const { getLeaguePrimarySource, APP_LEAGUES, getLeagueKeyBySlug } = require('./leagueCodes');
const { getDateRangeBounds, getDayBounds } = require('./dateRange');
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

/** 内存短缓存，避免首页 week+history 连打懂球 */
const dongqiuMatchCache = { at: 0, leagueKey: '', full: false, list: [] };

async function fetchDongqiuLeagueMatches(leagueKey, { full = false } = {}) {
  if (
    dongqiuMatchCache.leagueKey === leagueKey &&
    dongqiuMatchCache.full === full &&
    Date.now() - dongqiuMatchCache.at < 90_000 &&
    dongqiuMatchCache.list.length
  ) {
    return dongqiuMatchCache.list;
  }

  const map = new Map();
  try {
    const tab = await dongqiu.fetchLeagueTabMatches(leagueKey);
    for (const item of tab) {
      const mapped = dongqiuMapper.mapMatchFromTab(item, leagueKey);
      if (mapped) map.set(mapped._id, mapped);
    }
  } catch {
    /* tab optional */
  }
  // 全量轮次仅历史场景；今日/本周只用 Tab，避免十余秒延迟
  if (full) {
    try {
      const recent = await dongqiu.fetchRecentSchedule(leagueKey);
      for (const item of recent) {
        const mapped = dongqiuMapper.mapMatchFromSchedule(item, leagueKey);
        if (mapped) map.set(mapped._id, mapped);
      }
    } catch {
      /* schedule optional */
    }
  }

  const list = Array.from(map.values());
  dongqiuMatchCache.at = Date.now();
  dongqiuMatchCache.leagueKey = leagueKey;
  dongqiuMatchCache.full = full;
  dongqiuMatchCache.list = list;

  if (isDbEnabled() && list.length) {
    matchRepo.upsertMatches(list).catch((e) => {
      console.warn('[dataService] dongqiu match upsert failed:', e.message);
    });
  }
  return list;
}

function filterMatchesByRange(matches, dateRange, options = {}) {
  if (options.date) {
    const { start, end } = getDayBounds(options.date);
    const a = start.getTime();
    const b = end.getTime();
    return matches.filter((m) => {
      const t = new Date(m.matchTime).getTime();
      return Number.isFinite(t) && t >= a && t < b;
    });
  }
  if (!dateRange) return matches;
  const { start, end } = getDateRangeBounds(dateRange);
  const a = start.getTime();
  const b = end.getTime();
  return matches.filter((m) => {
    const t = new Date(m.matchTime).getTime();
    if (!Number.isFinite(t) || t < a || t >= b) return false;
    if (dateRange === 'history') {
      return m.status === 'FT' || m.status === 'AET' || m.status === 'PEN';
    }
    return true;
  });
}

async function getScheduleFromDongqiu(leagueKey, dateRange, options = {}) {
  // API 读路径只用 Tab（快）；全量轮次由 sync 写入 MySQL
  const all = await fetchDongqiuLeagueMatches(leagueKey, { full: false });
  return sortMatches(filterMatchesByRange(all, dateRange, options));
}

function mergeMatchLists(...lists) {
  const map = new Map();
  lists.flat().forEach((m) => {
    if (m?._id) map.set(m._id, m);
  });
  return sortMatches(Array.from(map.values()));
}

async function getTodayMatches() {
  if (isDbEnabled()) {
    let list = sortMatches(await matchRepo.findToday());
    const hasCsl = list.some((m) => m.league === 'Chinese Super League');
    if (!hasCsl && prefersDongqiu('Chinese Super League')) {
      try {
        const live = await getScheduleFromDongqiu('Chinese Super League', 'today');
        if (live.length) list = mergeMatchLists(list, live);
      } catch {
        /* keep db */
      }
    }
    return list;
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
    let list;
    if (options.date) {
      list = sortMatches(
        await matchRepo.findByCalendarDate(options.date, leagueKey || undefined)
      );
    } else if (dateRange === 'history') {
      list = await matchRepo.findHistoryMatches(leagueKey || undefined);
    } else {
      list = sortMatches(await matchRepo.findByDateRange(dateRange, leagueKey || undefined));
    }

    const cslKey = 'Chinese Super League';
    // 历史列表只读库，禁止实时拉懂球 1–30 轮（可达十余秒）
    if (dateRange === 'history' && !options.date) {
      return list;
    }

    const needDongqiu =
      (leagueKey && prefersDongqiu(leagueKey)) ||
      (!leagueKey && prefersDongqiu(cslKey));

    if (needDongqiu) {
      const targetLeague = leagueKey || cslKey;
      const hasTarget = list.some((m) => m.league === targetLeague);
      if (!hasTarget || (leagueKey && prefersDongqiu(leagueKey) && !list.length)) {
        try {
          const live = await getScheduleFromDongqiu(
            targetLeague,
            options.date ? null : dateRange,
            options
          );
          if (leagueKey) {
            if (live.length) return live;
          } else if (live.length) {
            list = mergeMatchLists(list, live);
          }
        } catch {
          /* keep db */
        }
      }
    }
    return list;
  }
  if (options.date || dateRange === 'history') {
    if (leagueKey && prefersDongqiu(leagueKey)) {
      try {
        return await getScheduleFromDongqiu(leagueKey, dateRange, options);
      } catch {
        return [];
      }
    }
    if (!leagueKey && prefersDongqiu('Chinese Super League')) {
      try {
        return await getScheduleFromDongqiu('Chinese Super League', dateRange, options);
      } catch {
        return [];
      }
    }
    return [];
  }
  if (leagueKey && prefersDongqiu(leagueKey)) {
    try {
      const live = await getScheduleFromDongqiu(leagueKey, dateRange, options);
      if (live.length) return live;
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

function indexPlayerHit(player, leagueKey) {
  if (!player?.athleteId && !player?._id) return;
  const id = String(player.athleteId || player._id || '').replace(
    /^(dq_player_|espn_player_)/,
    ''
  );
  if (!id) return;
  searchIndexRepo
    .upsertHit({
      type: 'player',
      id,
      name: player.name,
      enName: player.shortName || '',
      logo: player.avatar || '',
      subtitle: [player.teamName, player.position].filter(Boolean).join(' · '),
      leagueKey: leagueKey || player.league || '',
      leagueLabel: player.leagueLabel || (leagueKey === 'Chinese Super League' ? '中超' : ''),
      source: player.source || 'dongqiu',
      team: player.teamName || '',
      nationality: player.nationality || '',
    })
    .catch(() => {});
}

async function persistPlayer(player, leagueKey) {
  if (!isDbEnabled() || !player) return;
  const id = String(player.athleteId || '').replace(/^(dq_player_|espn_player_)/, '');
  if (!id) return;
  const key = leagueKey || player.league || 'Chinese Super League';
  try {
    await playerRepo.upsertPlayer(id, key, player);
  } catch {
    /* ignore */
  }
  indexPlayerHit(player, key);
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
    // 旧缓存缺雷达/生涯数据时强制刷新
    if (player?.ability?.radar?.length && player?.career?.length) {
      indexPlayerHit(player, leagueKey || player.league);
      return player;
    }
  }

  const tryDongqiu =
    prefersDongqiu(leagueKey) || looksLikeDongqiuId(id) || !leagueKey || leagueKey === 'Chinese Super League';

  if (tryDongqiu) {
    try {
      const mapped = await getPlayerDetailFromDongqiu(id, leagueKey || 'Chinese Super League');
      if (mapped) {
        await persistPlayer(mapped, leagueKey || 'Chinese Super League');
        return mapped;
      }
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
  await persistPlayer(mapped, resolvedLeague);
  return mapped;
}

async function searchLive(query, limit = 20) {
  const { expandSearchQueries } = require('./zhNames');
  const queries = expandSearchQueries(query);
  const merged = { players: [], teams: [] };
  const seenP = new Set();
  const seenT = new Set();

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
        seenT.add(t.id);
        merged.teams.push({ ...t, source: 'dongqiu' });
      }
    } catch {
      /* next */
    }
  }

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

  try {
    const csl = await getTeams('Chinese Super League');
    const kw = String(query || '').trim().toLowerCase();
    const zhKw = String(query || '').trim();
    for (const t of csl) {
      const tid = String(t._id || '').replace(/^(dq_team_|espn_team_)/, '');
      if (!tid || seenT.has(tid)) continue;
      const name = t.name || '';
      const hit = name.toLowerCase().includes(kw) || name.includes(zhKw);
      if (!hit) continue;
      seenT.add(tid);
      merged.teams.unshift({
        type: 'team',
        id: tid,
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

async function search(query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return { players: [], teams: [] };

  // 1) 优先读本地索引（快）
  if (isDbEnabled()) {
    try {
      const local = await searchIndexRepo.searchLocal(q, limit);
      if (local.players.length + local.teams.length >= 1) {
        // 结果够用则直接返回；过少时再补上游
        if (local.players.length + local.teams.length >= 3 || local.players.some((p) => p.name === q)) {
          return {
            players: local.players.slice(0, limit),
            teams: local.teams.slice(0, limit),
          };
        }
        const live = await searchLive(q, limit);
        const seenP = new Set(local.players.map((p) => p.id));
        const seenT = new Set(local.teams.map((t) => t.id));
        for (const p of live.players) {
          if (!seenP.has(p.id)) {
            seenP.add(p.id);
            local.players.push(p);
          }
        }
        for (const t of live.teams) {
          if (!seenT.has(t.id)) {
            seenT.add(t.id);
            local.teams.push(t);
          }
        }
        searchIndexRepo.upsertHits([...live.players, ...live.teams]).catch(() => {});
        return {
          players: local.players.slice(0, limit),
          teams: local.teams.slice(0, limit),
        };
      }
    } catch {
      /* fall through */
    }
  }

  // 2) 索引未命中：上游搜索并回写
  const live = await searchLive(q, limit);
  if (isDbEnabled()) {
    searchIndexRepo.upsertHits([...live.players, ...live.teams]).catch(() => {});
  }
  return live;
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
