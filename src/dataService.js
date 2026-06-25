const espn = require('./espnClient');
const { isDbEnabled, pingDb, getPool } = require('./db');
const matchRepo = require('./repositories/matchRepo');
const standingRepo = require('./repositories/standingRepo');
const bracketRepo = require('./repositories/bracketRepo');
const teamRepo = require('./repositories/teamRepo');
const playerRankingRepo = require('./repositories/playerRankingRepo');
const playerRepo = require('./repositories/playerRepo');
const {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapTeam,
  sortMatches,
} = require('./mapper');

/**
 * 读库模式：API 只查 MySQL，不请求 ESPN。
 * ESPN 仅由 syncService 定时任务拉取并写入库。
 */

async function getTodayMatches() {
  if (isDbEnabled()) {
    return sortMatches(await matchRepo.findToday());
  }
  const raw = await espn.fetchSchedule('today');
  return sortMatches(raw.map(mapScheduleItem).filter(Boolean));
}

async function getSchedule(dateRange, leagueKey) {
  if (isDbEnabled()) {
    return sortMatches(await matchRepo.findByDateRange(dateRange, leagueKey || undefined));
  }
  const raw = await espn.fetchSchedule(dateRange, leagueKey || undefined);
  return sortMatches(raw.map(mapScheduleItem).filter(Boolean));
}

async function getMatchDetail(eventId, _leagueHint) {
  if (isDbEnabled()) {
    const row = await matchRepo.findByExternalId(eventId);
    if (!row) throw new Error('比赛不存在');
    return matchRepo.rowToMatch(row);
  }

  const { summary, leagueKey } = await espn.fetchMatchSummary(eventId, _leagueHint || undefined);
  const mapped = mapSummaryToMatch(summary, leagueKey);
  if (!mapped) throw new Error('比赛不存在');
  return mapped;
}

async function getStandings(leagueKey) {
  if (isDbEnabled()) {
    return standingRepo.findByLeague(leagueKey);
  }
  const table = await espn.fetchStandingsRaw(leagueKey);
  const mapped = table.map((row) => mapStandingRow(row, leagueKey));
  // API 层不算近况（需额外拉 scoreboard，+2～4s）；近况由 syncStandings 写入库
  return mapped;
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
    return rows.slice(0, limit);
  }
  // 射手榜需逐场请求 ESPN summary，API 层禁止实时计算（由 syncPlayerStats 写入库）
  return [];
}

async function getAssists(leagueKey, limit) {
  if (isDbEnabled()) {
    const rows = await playerRankingRepo.findByLeague(leagueKey, 'assists');
    return rows.slice(0, limit);
  }
  return [];
}

async function getTeams(leagueKey, keyword) {
  if (isDbEnabled()) {
    return teamRepo.findByLeague(leagueKey, keyword);
  }
  let teams = (await espn.fetchCompetitionTeams(leagueKey)).map((t) => mapTeam(t, leagueKey));
  if (keyword) {
    const kw = keyword.toLowerCase();
    teams = teams.filter((t) => t.name.toLowerCase().includes(kw));
  }
  return teams;
}

async function getPlayerDetail(athleteId, leagueKey) {
  if (isDbEnabled()) {
    const player = await playerRepo.findByExternalId(athleteId, leagueKey);
    if (!player) throw new Error('球员不存在');
    return player;
  }
  const { mapAthleteDetail } = require('./mapper');
  const raw = await espn.fetchAthleteRaw(athleteId, leagueKey);
  const mapped = mapAthleteDetail(raw, leagueKey);
  if (!mapped) throw new Error('球员不存在');
  return mapped;
}

async function getHealthExtra() {
  const extra = { provider: 'espn', readMode: isDbEnabled() ? 'database-only' : 'espn-proxy' };
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
  getHealthExtra,
};
