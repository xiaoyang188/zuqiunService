const https = require('https');
const {
  APP_LEAGUES,
  HOT_LEAGUE_KEYS,
  getLeagueByKey,
} = require('./leagueCodes');
const { shanghaiEspnDate } = require('./dateRange');

const SITE_HOST = 'site.api.espn.com';
const CORE_HOST = 'sports.core.api.espn.com';
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
  const data = await siteGet(meta.slug, 'teams');
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams || [];
  return teams.map((t) => t.team).filter(Boolean);
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

async function fetchFinishedEventsForForm(meta, limit = 60) {
  const now = new Date();
  const range90Start = addDays(-120);
  const dateRanges = [
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
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

function pushTeamForm(map, teamId, result, maxLen = 5) {
  if (!teamId) return;
  const list = map.get(teamId) || [];
  if (list.length >= maxLen) return;
  list.push(result);
  map.set(teamId, list);
}

/** 从近期已结束比赛推算球队近况 W/D/L（docs: site-v2-scoreboard） */
async function buildTeamFormMap(leagueKey) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return new Map();

  const finished = await fetchFinishedEventsForForm(meta);
  const formMap = new Map();

  for (const event of finished) {
    const comp = event.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === 'home');
    const away = competitors.find((c) => c.homeAway === 'away');
    if (!home?.team?.id || !away?.team?.id) continue;

    const homeId = `espn_team_${home.team.id}`;
    const awayId = `espn_team_${away.team.id}`;
    if ((formMap.get(homeId)?.length || 0) >= 5 && (formMap.get(awayId)?.length || 0) >= 5) {
      continue;
    }

    const hs = Number(home.score);
    const as = Number(away.score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;

    let homeResult = 'D';
    let awayResult = 'D';
    if (hs > as) {
      homeResult = 'W';
      awayResult = 'L';
    } else if (hs < as) {
      homeResult = 'L';
      awayResult = 'W';
    }

    pushTeamForm(formMap, homeId, homeResult);
    pushTeamForm(formMap, awayId, awayResult);
  }

  return formMap;
}

function formatFormStreak(form) {
  if (!form?.length) return '';
  const latest = form[0];
  let count = 1;
  for (let i = 1; i < form.length; i += 1) {
    if (form[i] !== latest) break;
    count += 1;
  }
  if (latest === 'W') return `${count}连胜`;
  if (latest === 'L') return `${count}连败`;
  if (count > 1) return `${count}连平`;
  return '1平';
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

async function enrichStandingsWithForm(leagueKey, rows) {
  try {
    const formMap = await buildTeamFormMap(leagueKey);
    return rows.map((row) => {
      const form = formMap.get(row.teamId) || [];
      return {
        ...row,
        form,
        formText: formatFormStreak(form),
      };
    });
  } catch {
    return rows.map((row) => ({ ...row, form: [], formText: '' }));
  }
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
  const meta = getLeagueByKey(leagueKey);
  if (!meta?.slug) throw new Error('球员不存在');

  const year = new Date().getFullYear();
  const years = [year, year - 1, year + 1, 2026, 2024, 2022];
  const tried = new Set();

  for (const y of years) {
    if (tried.has(y)) continue;
    tried.add(y);
    try {
      return await coreGet(
        `/v2/sports/soccer/leagues/${meta.slug}/seasons/${y}/athletes/${athleteId}?lang=en&region=us`
      );
    } catch {
      /* try next season year */
    }
  }
  throw new Error('球员不存在');
}

module.exports = {
  registerEvent,
  resolveRegistry,
  fetchSchedule,
  fetchMatchSummary,
  fetchStandingsRaw,
  fetchCompetitionTeams,
  fetchScorersFromPlays,
  fetchAssistsFromSummaries,
  fetchAthleteRaw,
  enrichStandingsWithForm,
  fetchKnockoutBracket,
};
