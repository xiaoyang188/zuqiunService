const https = require('https');
const {
  APP_LEAGUES,
  HOT_LEAGUE_KEYS,
  getLeagueByKey,
  getLeagueKeyBySlug,
} = require('./leagueCodes');
const { shanghaiEspnDate } = require('./dateRange');

const SITE_HOST = 'site.api.espn.com';
const CORE_HOST = 'sports.core.api.espn.com';
const WEB_HOST = 'site.web.api.espn.com';
const USER_AGENT = 'zuqiu-server/1.0';

/** 复用 TLS 连接，减少并发 scoreboard 请求的握手耗时 */
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 24,
  maxFreeSockets: 12,
  timeout: 20_000,
});

/** eventId -> { leagueKey, leagueSlug, competitionId } */
const matchRegistry = new Map();

function request(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'GET',
        agent: keepAliveAgent,
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          Connection: 'keep-alive',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`ESPN HTTP ${res.statusCode}`));
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
    req.setTimeout(15000, () => req.destroy(new Error('ESPN 请求超时')));
    req.end();
  });
}

function siteGet(leagueSlug, resource, query = '') {
  const q = query ? `?${query}` : '';
  return request(SITE_HOST, `/apis/site/v2/sports/soccer/${leagueSlug}/${resource}${q}`);
}

function apisGet(leagueSlug, resource) {
  return request(SITE_HOST, `/apis/v2/sports/soccer/${leagueSlug}/${resource}`);
}

function coreGet(path) {
  return request(CORE_HOST, path);
}

function webGet(path) {
  return request(WEB_HOST, path);
}

function httpsToEspn(url) {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/^http:\/\//, 'https://').replace('sports.core.api.espn.pvt', 'sports.core.api.espn.com');
}

async function coreGetByRef(ref) {
  const url = httpsToEspn(ref);
  const m = url.match(/^https:\/\/([^/]+)(\/.*)$/);
  if (!m) throw new Error('invalid ref');
  return request(m[1], m[2]);
}

function formatEspnDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function leaguesToFetch(leagueKey) {
  if (leagueKey) {
    const meta = getLeagueByKey(leagueKey);
    return meta ? [{ key: leagueKey, slug: meta.slug }] : [];
  }
  return HOT_LEAGUE_KEYS.filter((key) => APP_LEAGUES[key]).map((key) => ({
    key,
    slug: APP_LEAGUES[key].slug,
  }));
}

function registerEvent(eventId, leagueKey, leagueSlug, competitionId) {
  matchRegistry.set(String(eventId), { leagueKey, leagueSlug, competitionId });
}

function resolveRegistry(eventId) {
  return matchRegistry.get(String(eventId)) || null;
}

async function fetchScoreboardEvents(slug, datesQuery) {
  const data = datesQuery
    ? await siteGet(slug, 'scoreboard', `dates=${datesQuery}`)
    : await siteGet(slug, 'scoreboard');
  return data?.events || [];
}

async function fetchSchedule(dateRange, leagueKey) {
  const leagues = leaguesToFetch(leagueKey);
  let datesQuery = '';
  if (dateRange === 'today') {
    datesQuery = shanghaiEspnDate(0);
  } else if (dateRange === 'yesterday') {
    datesQuery = shanghaiEspnDate(-1);
  } else if (dateRange === 'tomorrow') {
    datesQuery = shanghaiEspnDate(1);
  } else if (dateRange === 'week') {
    datesQuery = `${shanghaiEspnDate(0)}-${shanghaiEspnDate(7)}`;
  }

  const batches = await Promise.all(
    leagues.map(async ({ key, slug }) => {
      try {
        const events = await fetchScoreboardEvents(slug, datesQuery);
        return events.map((event) => ({
          event,
          leagueKey: key,
          leagueSlug: slug,
        }));
      } catch {
        return [];
      }
    })
  );

  const map = new Map();
  batches.flat().forEach((item) => {
    map.set(item.event.id, item);
  });
  return Array.from(map.values());
}

/** 默认 scoreboard（含当前进行中/刚完赛），不指定 dates */
async function fetchCurrentScoreboard(leagueKey) {
  const leagues = leaguesToFetch(leagueKey);
  const batches = await Promise.all(
    leagues.map(async ({ key, slug }) => {
      try {
        const events = await fetchScoreboardEvents(slug, '');
        return events.map((event) => ({
          event,
          leagueKey: key,
          leagueSlug: slug,
        }));
      } catch {
        return [];
      }
    })
  );

  const map = new Map();
  batches.flat().forEach((item) => {
    map.set(item.event.id, item);
  });
  return Array.from(map.values());
}

/** ESPN summary 不校验联赛 slug，用 season.name 反查真实联赛，避免误判 */
const SEASON_KEYWORDS = [
  ['World Cup', /world cup/i],
  ['Champions League', /champions league/i],
  ['Euro', /european championship|uefa euro/i],
  ['Premier League', /premier league/i],
  ['La Liga', /laliga|la liga/i],
  ['Bundesliga', /bundesliga/i],
  ['Serie A', /serie a/i],
  ['Ligue 1', /ligue 1/i],
  ['Chinese Super League', /chinese super league|中超/i],
];

function correctLeagueBySeason(summary, fallbackKey) {
  const name = summary?.header?.season?.name || '';
  const hit = SEASON_KEYWORDS.find(([, re]) => re.test(name));
  return hit ? hit[0] : fallbackKey;
}

async function fetchMatchSummary(eventId, leagueKeyHint) {
  let leagueKey = leagueKeyHint;
  let leagueSlug = leagueKeyHint ? getLeagueByKey(leagueKeyHint)?.slug : null;

  const reg = resolveRegistry(eventId);
  if (reg) {
    leagueKey = reg.leagueKey;
    leagueSlug = reg.leagueSlug;
  }

  // 冷启动直接打开详情：World Cup 优先，再其余联赛
  if (!leagueSlug) {
    const orderedKeys = [
      ...HOT_LEAGUE_KEYS,
      ...Object.keys(APP_LEAGUES).filter((k) => !HOT_LEAGUE_KEYS.includes(k)),
    ];
    for (const key of orderedKeys) {
      const slug = APP_LEAGUES[key]?.slug;
      if (!slug) continue;
      try {
        await siteGet(slug, 'summary', `event=${eventId}`);
        leagueKey = key;
        leagueSlug = slug;
        break;
      } catch {
        /* try next league */
      }
    }
  }

  if (!leagueSlug) {
    throw new Error('比赛不存在');
  }

  const summary = await siteGet(leagueSlug, 'summary', `event=${eventId}`);
  if (!summary?.header) {
    throw new Error('比赛不存在');
  }

  // 用赛季名校正联赛归类（遍历命中错 slug 时纠正）
  leagueKey = correctLeagueBySeason(summary, leagueKey);
  leagueSlug = getLeagueByKey(leagueKey)?.slug || leagueSlug;

  const comp = summary.header.competitions?.[0];
  if (comp) {
    registerEvent(eventId, leagueKey, leagueSlug, comp.id);
  }

  return { summary, leagueKey, leagueSlug };
}

async function fetchStandingsRaw(leagueKey) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];
  const data = await apisGet(meta.slug, 'standings');
  const rows = [];

  for (const child of data?.children || []) {
    const entries = child?.standings?.entries || [];
    entries.forEach((entry, idx) => {
      rows.push({
        entry,
        rank:
          entry.stats?.find((s) => s.name === 'rank')?.value ??
          entry.note?.rank ??
          idx + 1,
        groupName: child.name || '',
      });
    });
  }

  return rows;
}

async function fetchCompetitionTeams(leagueKey) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];
  try {
    const data = await siteGet(meta.slug, 'teams');
    const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
    const mapped = teams.map((t) => t.team).filter(Boolean);
    if (mapped.length) return mapped;
  } catch {
    /* site 偶发 403，走 core */
  }
  return fetchCompetitionTeamsViaCore(meta.slug);
}

async function fetchCompetitionTeamsViaCore(leagueSlug) {
  const year = new Date().getFullYear();
  const years = [year, year - 1, year + 1];
  let list = null;
  for (const y of years) {
    try {
      list = await coreGet(
        `/v2/sports/soccer/leagues/${leagueSlug}/seasons/${y}/teams?limit=50&lang=en&region=us`
      );
      if (list?.items?.length) break;
    } catch {
      /* next */
    }
  }
  if (!list?.items?.length) {
    try {
      list = await coreGet(
        `/v2/sports/soccer/leagues/${leagueSlug}/teams?limit=50&lang=en&region=us`
      );
    } catch {
      return [];
    }
  }
  const teams = [];
  await Promise.all(
    (list.items || []).map(async (item) => {
      try {
        const team = await coreGetByRef(item.$ref);
        if (team?.id) teams.push(team);
      } catch {
        /* skip */
      }
    })
  );
  return teams;
}

function extractIdFromUid(uid, prefix) {
  if (!uid) return '';
  const m = String(uid).match(new RegExp(`${prefix}:(\\d+)`, 'i'));
  return m ? m[1] : '';
}

function slugToLeagueKey(slug) {
  if (!slug) return null;
  const normalized = String(slug).toLowerCase();
  return getLeagueKeyBySlug(normalized) || getLeagueKeyBySlug(String(slug)) || null;
}

/** 搜索球员 / 球队（仅足球） */
async function searchSoccer(query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return { players: [], teams: [] };
  const pageLimit = Math.min(Math.max(Number(limit) || 20, 1), 30);

  let players = [];
  let teams = [];

  try {
    const data = await webGet(
      `/apis/search/v2?query=${encodeURIComponent(q)}&limit=${pageLimit}`
    );
    for (const group of data?.results || []) {
      if (group.type === 'player') {
        for (const item of group.contents || []) {
          if (item.sport && item.sport !== 'soccer') continue;
          const athleteId =
            extractIdFromUid(item.uid, 'a') ||
            String(item.link?.web || '').match(/\/id\/(\d+)/)?.[1] ||
            '';
          if (!athleteId) continue;
          const leagueSlug = (item.defaultLeagueSlug || '').toLowerCase();
          players.push({
            type: 'player',
            id: athleteId,
            name: item.displayName || '',
            subtitle: item.subtitle || item.description || '',
            logo: item.image?.default || '',
            leagueSlug,
            leagueKey: slugToLeagueKey(leagueSlug),
            leagueLabel: item.subtitle || '',
          });
        }
      }
      if (group.type === 'team') {
        for (const item of group.contents || []) {
          if (item.sport && item.sport !== 'soccer') continue;
          const teamId =
            extractIdFromUid(item.uid, 't') ||
            String(item.link?.web || '').match(/\/id\/(\d+)/)?.[1] ||
            '';
          if (!teamId) continue;
          const leagueSlug = (item.defaultLeagueSlug || '').toLowerCase();
          teams.push({
            type: 'team',
            id: teamId,
            name: item.displayName || '',
            subtitle: item.subtitle || '',
            logo: item.image?.default || '',
            leagueSlug,
            leagueKey: slugToLeagueKey(leagueSlug),
            leagueLabel: item.subtitle || '',
          });
        }
      }
    }
  } catch {
    /* fallback common v3 */
  }

  if (!players.length && !teams.length) {
    try {
      const data = await webGet(
        `/apis/common/v3/search?query=${encodeURIComponent(q)}&limit=${pageLimit}&type=player,team`
      );
      for (const item of data?.items || []) {
        if (item.sport && item.sport !== 'soccer') continue;
        const leagueSlug = (item.defaultLeagueSlug || item.league || '').toLowerCase();
        if (item.type === 'player') {
          players.push({
            type: 'player',
            id: String(item.id),
            name: item.displayName || '',
            subtitle: item.label || item.league || '',
            logo: item.imageUrl || '',
            leagueSlug,
            leagueKey: slugToLeagueKey(leagueSlug),
            leagueLabel: item.label || '',
          });
        } else if (item.type === 'team') {
          teams.push({
            type: 'team',
            id: String(item.id),
            name: item.displayName || '',
            subtitle: item.subtitle || item.label || '',
            logo: item.imageUrl || '',
            leagueSlug,
            leagueKey: slugToLeagueKey(leagueSlug),
            leagueLabel: item.subtitle || '',
          });
        }
      }
    } catch {
      /* empty */
    }
  }

  return {
    players: players.slice(0, pageLimit),
    teams: teams.slice(0, pageLimit),
  };
}

function parseRecordStats(recordPayload) {
  const item =
    (recordPayload?.items || []).find((i) => i.type === 'total' || i.name === 'overall') ||
    recordPayload?.items?.[0];
  if (!item) return null;
  const stats = {};
  for (const s of item.stats || []) {
    if (s.name) stats[s.name] = s.displayValue ?? s.value;
  }
  return {
    summary: item.summary || item.displayValue || '',
    played: Number(stats.gamesPlayed) || 0,
    win: Number(stats.wins) || 0,
    draw: Number(stats.ties) || 0,
    lose: Number(stats.losses) || 0,
    gf: Number(stats.pointsFor) || 0,
    ga: Number(stats.pointsAgainst) || 0,
    gd: Number(stats.pointDifferential) || 0,
    points: Number(stats.points) || 0,
    rank: Number(stats.rank) || null,
  };
}

async function resolveSeasonYear(leagueSlug) {
  const year = new Date().getFullYear();
  for (const y of [year, year - 1, year + 1]) {
    try {
      await coreGet(
        `/v2/sports/soccer/leagues/${leagueSlug}/seasons/${y}/teams?limit=1&lang=en&region=us`
      );
      return y;
    } catch {
      /* next */
    }
  }
  return year;
}

async function fetchTeamRoster(leagueSlug, seasonYear, teamId, limit = 40) {
  let list;
  try {
    list = await coreGet(
      `/v2/sports/soccer/leagues/${leagueSlug}/seasons/${seasonYear}/teams/${teamId}/athletes?lang=en&region=us&limit=${limit}`
    );
  } catch {
    return [];
  }
  const refs = (list?.items || []).slice(0, limit);
  const athletes = [];
  const chunk = 8;
  for (let i = 0; i < refs.length; i += chunk) {
    const batch = refs.slice(i, i + chunk);
    const rows = await Promise.all(
      batch.map(async (item) => {
        try {
          const a = await coreGetByRef(item.$ref);
          if (!a?.id) return null;
          return {
            id: String(a.id),
            athleteId: String(a.id),
            name: a.displayName || a.fullName || '',
            shortName: a.shortName || '',
            number: a.jersey ? String(a.jersey) : '',
            position: a.position?.abbreviation || a.position?.displayName || '',
            avatar: a.headshot?.href || '',
          };
        } catch {
          return null;
        }
      })
    );
    athletes.push(...rows.filter(Boolean));
  }
  const order = { G: 0, GK: 0, D: 1, M: 2, F: 3 };
  athletes.sort((a, b) => {
    const pa = order[a.position] ?? 9;
    const pb = order[b.position] ?? 9;
    if (pa !== pb) return pa - pb;
    return Number(a.number || 99) - Number(b.number || 99);
  });
  return athletes;
}

async function fetchTeamSchedule(leagueSlug, teamId, limit = 12) {
  try {
    const data = await webGet(
      `/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/schedule`
    );
    const events = data?.events || [];
    return events.slice(-limit).reverse().map((event) => {
      const comp = event.competitions?.[0];
      const competitors = comp?.competitors || [];
      const home = competitors.find((c) => c.homeAway === 'home');
      const away = competitors.find((c) => c.homeAway === 'away');
      const state = comp?.status?.type?.state;
      let status = 'NS';
      if (state === 'in') status = 'LIVE';
      else if (state === 'post') status = 'FT';
      const scoreVal = (side) => {
        const s = side?.score;
        if (s == null) return null;
        if (typeof s === 'object') return Number(s.displayValue ?? s.value);
        return Number(s);
      };
      return {
        _id: String(event.id),
        matchTime: event.date || '',
        homeTeam: home?.team?.displayName || '',
        awayTeam: away?.team?.displayName || '',
        homeScore: scoreVal(home),
        awayScore: scoreVal(away),
        status,
        statusText: comp?.status?.type?.shortDetail || comp?.status?.type?.description || '',
        leagueSlug,
      };
    });
  } catch {
    return [];
  }
}

/** 球队详情：资料 + 战绩 + 阵容 + 近期赛程 */
async function fetchTeamDetail(teamId, leagueKeyHint) {
  const id = String(teamId);
  let leagueKey = leagueKeyHint && getLeagueByKey(leagueKeyHint) ? leagueKeyHint : null;
  let leagueSlug = leagueKey ? getLeagueByKey(leagueKey).slug : null;

  if (!leagueSlug) {
    // 优先中超，再扫其它联赛
    const ordered = [
      'Chinese Super League',
      ...Object.keys(APP_LEAGUES).filter((k) => k !== 'Chinese Super League'),
    ];
    for (const key of ordered) {
      const slug = APP_LEAGUES[key]?.slug;
      if (!slug) continue;
      const year = await resolveSeasonYear(slug);
      try {
        await coreGet(
          `/v2/sports/soccer/leagues/${slug}/seasons/${year}/teams/${id}?lang=en&region=us`
        );
        leagueKey = key;
        leagueSlug = slug;
        break;
      } catch {
        /* next */
      }
    }
  }

  if (!leagueSlug || !leagueKey) {
    throw new Error('球队不存在');
  }

  const seasonYear = await resolveSeasonYear(leagueSlug);
  const raw = await coreGet(
    `/v2/sports/soccer/leagues/${leagueSlug}/seasons/${seasonYear}/teams/${id}?lang=en&region=us`
  );

  let record = null;
  if (raw.record?.$ref) {
    try {
      record = parseRecordStats(await coreGetByRef(raw.record.$ref));
    } catch {
      /* optional */
    }
  }

  const [roster, recentMatches] = await Promise.all([
    fetchTeamRoster(leagueSlug, seasonYear, id),
    fetchTeamSchedule(leagueSlug, id),
  ]);

  return {
    raw,
    leagueKey,
    leagueSlug,
    seasonYear,
    record,
    roster,
    recentMatches,
  };
}

async function fetchFinishedEvents(meta) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const range90Start = addDays(-90);

  const dateRanges = [
    `${formatEspnDate(monthStart)}-${formatEspnDate(monthEnd)}`,
    `${formatEspnDate(range90Start)}-${formatEspnDate(now)}`,
    '',
  ];

  let events = [];
  for (const datesQuery of dateRanges) {
    try {
      const batch = await fetchScoreboardEvents(meta.slug, datesQuery);
      if (batch.length) {
        events = batch;
        break;
      }
    } catch {
      /* try next range */
    }
  }

  return events
    .filter((e) => e.competitions?.[0]?.status?.type?.state === 'post')
    .slice(0, 20);
}

async function fetchKnockoutBracket(leagueKey) {
  const { CUP_LEAGUES, pickKnockoutDateRange, getRoundSlug, buildBracketRounds } = require('./bracket');
  if (!CUP_LEAGUES.has(leagueKey)) return [];
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];

  const header = await siteGet(meta.slug, 'scoreboard');
  const datesQuery = pickKnockoutDateRange(header?.leagues);
  if (!datesQuery) return [];

  const events = await fetchScoreboardEvents(meta.slug, datesQuery);
  const knockout = events.filter((e) => getRoundSlug(e));
  return buildBracketRounds(knockout, leagueKey);
}

async function forEachGoalEvent(meta, finished, handler) {
  for (const event of finished) {
    try {
      const summary = await siteGet(meta.slug, 'summary', `event=${event.id}`);
      for (const item of summary?.keyEvents || []) {
        if (!item.scoringPlay) continue;
        handler(item);
      }
    } catch {
      /* skip event */
    }
  }
}

function extractScorer(item) {
  const athlete = item.participants?.[0]?.athlete;
  let name = athlete?.displayName || '';
  if (!name) {
    name = (item.shortText || '').replace(/\s+Goal.*$/i, '').trim();
  }
  if (!name) return null;
  const teamName = item.team?.displayName || '';
  const key = athlete?.id ? String(athlete.id) : name;
  return { key, name, teamName };
}

function extractAssister(item) {
  const athlete = item.participants?.[1]?.athlete;
  if (athlete?.displayName) {
    return {
      key: athlete.id ? String(athlete.id) : athlete.displayName,
      name: athlete.displayName,
      teamName: item.team?.displayName || '',
    };
  }
  const m = (item.text || '').match(/Assisted by\s+([^(.\n]+)/i);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  return { key: name, name, teamName: item.team?.displayName || '' };
}

async function fetchScorersFromPlays(leagueKey, limit = 5) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];

  const finished = await fetchFinishedEvents(meta);
  const counts = new Map();

  await forEachGoalEvent(meta, finished, (item) => {
    const scorer = extractScorer(item);
    if (!scorer) return;
    const prev = counts.get(scorer.key) || { name: scorer.name, team: scorer.teamName, goals: 0 };
    prev.goals += 1;
    if (scorer.teamName) prev.team = scorer.teamName;
    counts.set(scorer.key, prev);
  });

  return Array.from(counts.values())
    .sort((a, b) => b.goals - a.goals)
    .slice(0, limit);
}

async function fetchAssistsFromSummaries(leagueKey, limit = 5) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];

  const finished = await fetchFinishedEvents(meta);
  const counts = new Map();

  await forEachGoalEvent(meta, finished, (item) => {
    const assister = extractAssister(item);
    if (!assister) return;
    const prev = counts.get(assister.key) || {
      name: assister.name,
      team: assister.teamName,
      assists: 0,
    };
    prev.assists += 1;
    if (assister.teamName) prev.team = assister.teamName;
    counts.set(assister.key, prev);
  });

  return Array.from(counts.values())
    .sort((a, b) => b.assists - a.assists)
    .slice(0, limit);
}

async function fetchAthleteRaw(athleteId, leagueKey) {
  const id = String(athleteId);

  // Web athlete：含球队、国籍，不依赖联赛 season 路径
  try {
    const data = await webGet(`/apis/common/v3/sports/soccer/athletes/${id}`);
    if (data?.athlete?.id) {
      return { ...data.athlete, _source: 'web' };
    }
  } catch {
    /* fall through */
  }

  const tryCore = async (slug) => {
    const year = new Date().getFullYear();
    const years = [year, year - 1, year + 1, 2026, 2024, 2022];
    const tried = new Set();
    for (const y of years) {
      if (tried.has(y)) continue;
      tried.add(y);
      try {
        return await coreGet(
          `/v2/sports/soccer/leagues/${slug}/seasons/${y}/athletes/${id}?lang=en&region=us`
        );
      } catch {
        /* next */
      }
    }
    return null;
  };

  if (leagueKey) {
    const meta = getLeagueByKey(leagueKey);
    if (meta?.slug) {
      const hit = await tryCore(meta.slug);
      if (hit) return hit;
    }
  }

  const ordered = [
    'Chinese Super League',
    ...HOT_LEAGUE_KEYS,
    ...Object.keys(APP_LEAGUES),
  ];
  const seen = new Set();
  for (const key of ordered) {
    if (seen.has(key)) continue;
    seen.add(key);
    const slug = APP_LEAGUES[key]?.slug;
    if (!slug) continue;
    const hit = await tryCore(slug);
    if (hit) return hit;
  }

  try {
    return await coreGet(`/v2/sports/soccer/athletes/${id}?lang=en&region=us`);
  } catch {
    throw new Error('球员不存在');
  }
}

module.exports = {
  registerEvent,
  resolveRegistry,
  fetchSchedule,
  fetchCurrentScoreboard,
  fetchMatchSummary,
  fetchStandingsRaw,
  fetchCompetitionTeams,
  fetchScorersFromPlays,
  fetchAssistsFromSummaries,
  fetchAthleteRaw,
  fetchKnockoutBracket,
  searchSoccer,
  fetchTeamDetail,
};
