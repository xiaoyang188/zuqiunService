const https = require('https');
const {
  APP_LEAGUES,
  HOT_LEAGUE_KEYS,
  getLeagueByKey,
} = require('./leagueCodes');

const SITE_HOST = 'site.api.espn.com';
const CORE_HOST = 'sports.core.api.espn.com';
const USER_AGENT = 'zuqiu-server/1.0';

/** eventId -> { leagueKey, leagueSlug, competitionId } */
const matchRegistry = new Map();

function request(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
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
  if (dateRange === 'tomorrow') {
    datesQuery = formatEspnDate(addDays(1));
  } else if (dateRange === 'week') {
    datesQuery = `${formatEspnDate(new Date())}-${formatEspnDate(addDays(7))}`;
  }

  const batches = await Promise.all(
    leagues.map(async ({ key, slug }) => {
      try {
        const events = await fetchScoreboardEvents(
          slug,
          dateRange === 'today' ? '' : datesQuery
        );
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

async function fetchMatchSummary(eventId, leagueKeyHint) {
  let leagueKey = leagueKeyHint;
  let leagueSlug = leagueKeyHint ? getLeagueByKey(leagueKeyHint)?.slug : null;

  const reg = resolveRegistry(eventId);
  if (reg) {
    leagueKey = reg.leagueKey;
    leagueSlug = reg.leagueSlug;
  }

  if (!leagueSlug) {
    for (const key of Object.keys(APP_LEAGUES)) {
      const slug = APP_LEAGUES[key].slug;
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

async function fetchScorersFromPlays(leagueKey, limit = 5) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];

  let events = [];
  try {
    events = await fetchScoreboardEvents(meta.slug, '');
  } catch {
    return [];
  }

  const finished = events.filter((e) => {
    const state = e.competitions?.[0]?.status?.type?.state;
    return state === 'post';
  }).slice(0, 3);

  const counts = new Map();

  for (const event of finished) {
    const compId = event.competitions?.[0]?.id || event.id;
    try {
      const plays = await coreGet(
        `/v2/sports/soccer/leagues/${meta.slug}/events/${event.id}/competitions/${compId}/plays?limit=300`
      );
      for (const item of plays?.items || []) {
        if (!item.scoringPlay) continue;
        let name = item.shortText || '';
        name = name.replace(/\s+(Penalty|Goal).*$/i, '').trim();
        if (!name) {
          const m = item.text?.match(/\.\s+([^(]+)\s+\(/);
          name = m?.[1]?.trim() || '';
        }
        if (!name) continue;
        const teamMatch = item.text?.match(/\(([^)]+)\)/);
        const teamName = teamMatch?.[1] || '';
        const prev = counts.get(name) || { name, team: teamName, goals: 0 };
        prev.goals += 1;
        if (teamName) prev.team = teamName;
        counts.set(name, prev);
      }
    } catch {
      /* skip event */
    }
  }

  return Array.from(counts.values())
    .sort((a, b) => b.goals - a.goals)
    .slice(0, limit);
}

module.exports = {
  registerEvent,
  resolveRegistry,
  fetchSchedule,
  fetchMatchSummary,
  fetchStandingsRaw,
  fetchCompetitionTeams,
  fetchScorersFromPlays,
};
