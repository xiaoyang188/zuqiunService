const https = require('https');
const { FILTER_CODES, getLeagueByKey } = require('./leagueCodes');

function filterByLeagues(matches, leagueKey) {
  if (leagueKey) {
    const meta = getLeagueByKey(leagueKey);
    if (!meta) return [];
    return matches.filter((m) => m.competition?.code === meta.code);
  }
  const allowed = new Set(FILTER_CODES);
  return matches.filter((m) => allowed.has(m.competition?.code));
}

const API_HOST = 'api.football-data.org';

function request(path) {
  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) return Promise.reject(new Error('未配置 FOOTBALL_DATA_TOKEN'));

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: API_HOST,
        path: `/v4${path}`,
        method: 'GET',
        headers: { 'X-Auth-Token': token },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode === 429) {
            reject(new Error('football-data 请求频率超限，请稍后再试'));
            return;
          }
          if (res.statusCode >= 400) {
            reject(new Error(`football-data HTTP ${res.statusCode}`));
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
    req.setTimeout(15000, () => req.destroy(new Error('football-data 请求超时')));
    req.end();
  });
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

async function fetchMatchesByDate(dateStr) {
  const data = await request(`/matches?date=${dateStr}`);
  return data?.matches || [];
}

async function fetchMatchesRange(dateFrom, dateTo) {
  const data = await request(`/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`);
  return data?.matches || [];
}

async function fetchLiveMatches() {
  const data = await request('/matches?status=IN_PLAY,PAUSED,LIVE');
  return data?.matches || [];
}

async function fetchMatchById(id) {
  return request(`/matches/${id}`);
}

async function fetchStandings(leagueKey) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];
  const data = await request(`/competitions/${meta.code}/standings`);
  const total = (data?.standings || []).find((s) => s.type === 'TOTAL');
  return total?.table || [];
}

async function fetchScorers(leagueKey, limit = 5) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];
  const data = await request(`/competitions/${meta.code}/scorers?limit=${limit}`);
  return data?.scorers || [];
}

async function fetchCompetitionTeams(leagueKey) {
  const meta = getLeagueByKey(leagueKey);
  if (!meta) return [];
  const data = await request(`/competitions/${meta.code}/teams`);
  return data?.teams || [];
}

async function fetchSchedule(dateRange, leagueKey) {
  if (dateRange === 'today') {
    const today = formatDate(new Date());
    const [byDate, live] = await Promise.all([
      fetchMatchesByDate(today),
      fetchLiveMatches(),
    ]);
    const map = new Map();
    [...byDate, ...live].forEach((m) => map.set(m.id, m));
    return filterByLeagues(Array.from(map.values()), leagueKey);
  }
  if (dateRange === 'tomorrow') {
    return filterByLeagues(await fetchMatchesByDate(addDays(1)), leagueKey);
  }
  const from = formatDate(new Date());
  const to = addDays(7);
  return filterByLeagues(await fetchMatchesRange(from, to), leagueKey);
}

module.exports = {
  request,
  fetchSchedule,
  fetchMatchById,
  fetchStandings,
  fetchScorers,
  fetchCompetitionTeams,
  fetchMatchesByDate,
  fetchLiveMatches,
};
