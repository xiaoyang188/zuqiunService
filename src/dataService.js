const espn = require('./espnClient');
const { isDbEnabled, pingDb } = require('./db');
const matchRepo = require('./repositories/matchRepo');
const standingRepo = require('./repositories/standingRepo');
const bracketRepo = require('./repositories/bracketRepo');
const teamRepo = require('./repositories/teamRepo');
const { syncMatchDetail } = require('./sync/syncService');
const {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapTeam,
  mapScorerRow,
  mapAssistRow,
  sortMatches,
} = require('./mapper');

async function getTodayMatches() {
  if (isDbEnabled()) {
    const rows = await matchRepo.findToday();
    if (rows.length) return sortMatches(rows);
  }
  const raw = await espn.fetchSchedule('today');
  return sortMatches(raw.map(mapScheduleItem).filter(Boolean));
}

async function getSchedule(dateRange, leagueKey) {
  if (isDbEnabled()) {
    const rows = await matchRepo.findByDateRange(dateRange, leagueKey || undefined);
    if (rows.length) return sortMatches(rows);
  }
  const raw = await espn.fetchSchedule(dateRange, leagueKey || undefined);
  return sortMatches(raw.map(mapScheduleItem).filter(Boolean));
}

async function getMatchDetail(eventId, leagueHint) {
  if (isDbEnabled()) {
    const row = await matchRepo.findByExternalId(eventId);
    if (row) {
      const payload = matchRepo.rowToMatch(row);
      const syncedAt = new Date(row.synced_at).getTime();
      const isLive = row.status === 'LIVE' || row.status === 'HT';
      const fresh = Date.now() - syncedAt < (isLive ? 60_000 : 10 * 60_000);
      const hasDetail = Boolean(payload?.stats || payload?.events?.length);
      if (fresh && (hasDetail || !isLive)) return payload;
    }
    return syncMatchDetail(eventId, leagueHint || undefined);
  }

  const { summary, leagueKey } = await espn.fetchMatchSummary(
    eventId,
    leagueHint || undefined
  );
  const mapped = mapSummaryToMatch(summary, leagueKey);
  if (!mapped) throw new Error('比赛不存在');
  return mapped;
}

async function getStandings(leagueKey) {
  if (isDbEnabled()) {
    const rows = await standingRepo.findByLeague(leagueKey);
    if (rows.length) return rows;
  }
  const table = await espn.fetchStandingsRaw(leagueKey);
  const mapped = table.map((row) => mapStandingRow(row, leagueKey));
  return espn.enrichStandingsWithForm(leagueKey, mapped);
}

async function getBracket(leagueKey) {
  if (isDbEnabled()) {
    const cached = await bracketRepo.findByLeague(leagueKey);
    if (cached !== null) return cached;
  }
  return espn.fetchKnockoutBracket(leagueKey);
}

async function getScorers(leagueKey, limit) {
  const list = await espn.fetchScorersFromPlays(leagueKey, limit);
  return list.map((row, i) => mapScorerRow(row, i));
}

async function getAssists(leagueKey, limit) {
  const list = await espn.fetchAssistsFromSummaries(leagueKey, limit);
  return list.map((row, i) => mapAssistRow(row, i));
}

async function getTeams(leagueKey, keyword) {
  if (isDbEnabled()) {
    const rows = await teamRepo.findByLeague(leagueKey, keyword);
    if (rows.length) return rows;
  }
  let teams = (await espn.fetchCompetitionTeams(leagueKey)).map((t) =>
    mapTeam(t, leagueKey)
  );
  if (keyword) {
    const kw = keyword.toLowerCase();
    teams = teams.filter((t) => t.name.toLowerCase().includes(kw));
  }
  return teams;
}

async function getPlayerDetail(athleteId, leagueKey) {
  const { mapAthleteDetail } = require('./mapper');
  const raw = await espn.fetchAthleteRaw(athleteId, leagueKey);
  const mapped = mapAthleteDetail(raw, leagueKey);
  if (!mapped) throw new Error('球员不存在');
  return mapped;
}

async function getHealthExtra() {
  const extra = { provider: 'espn' };
  if (isDbEnabled()) {
    extra.storage = 'mysql';
    try {
      extra.db = await pingDb();
      extra.matches = await matchRepo.countMatches();
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
  getHealthExtra,
};
