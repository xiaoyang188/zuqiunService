const espn = require('../espnClient');
const { APP_LEAGUES } = require('../leagueCodes');
const {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapTeam,
  sortMatches,
} = require('../mapper');
const matchRepo = require('../repositories/matchRepo');
const standingRepo = require('../repositories/standingRepo');
const bracketRepo = require('../repositories/bracketRepo');
const teamRepo = require('../repositories/teamRepo');
const { writeSyncLog } = require('../repositories/syncLogRepo');
const { isDbEnabled } = require('../db');
const { shanghaiDayStart } = require('../dateRange');

const DATE_RANGES = ['today', 'tomorrow', 'week'];
const ALL_LEAGUE_KEYS = Object.keys(APP_LEAGUES);
const FINISHED_RETENTION_DAYS = Number(process.env.SYNC_MATCH_RETENTION_DAYS) || 90;

let syncing = {
  schedule: false,
  live: false,
  standings: false,
  teams: false,
};

async function runJob(name, fn) {
  if (!isDbEnabled()) return { skipped: true };
  const startedAt = new Date();
  try {
    const rows = await fn();
    await writeSyncLog(name, 'ok', '', rows, startedAt);
    return { ok: true, rows };
  } catch (e) {
    await writeSyncLog(name, 'error', e.message, 0, startedAt);
    console.error(`[sync] ${name} failed:`, e.message);
    return { ok: false, error: e.message };
  }
}

async function syncScheduleOnce() {
  if (syncing.schedule) return { skipped: true };
  syncing.schedule = true;
  try {
    return await runJob('syncSchedule', async () => {
      const map = new Map();

      for (const leagueKey of ALL_LEAGUE_KEYS) {
        for (const dateRange of DATE_RANGES) {
          const raw = await espn.fetchSchedule(dateRange, leagueKey);
          raw.forEach((item) => {
            const mapped = mapScheduleItem(item);
            if (mapped) map.set(mapped._id, mapped);
          });
        }
      }

      const list = sortMatches(Array.from(map.values()));
      await matchRepo.upsertMatches(list);

      const syncedIds = list.map((m) => matchRepo.parseExternalId(m._id));
      const prunedWindow = await matchRepo.pruneMissingInRanges(DATE_RANGES, syncedIds);
      const cutoff = shanghaiDayStart(-FINISHED_RETENTION_DAYS);
      const prunedOld = await matchRepo.pruneFinishedBefore(cutoff);

      return list.length + prunedWindow + prunedOld;
    });
  } finally {
    syncing.schedule = false;
  }
}

async function syncLiveOnce() {
  if (syncing.live) return { skipped: true };
  syncing.live = true;
  try {
    return await runJob('syncLive', async () => {
      const liveRows = await matchRepo.findLiveMatches();
      let updated = 0;

      for (const row of liveRows) {
        try {
          const { summary, leagueKey } = await espn.fetchMatchSummary(
            row.external_id,
            row.league_key
          );
          const mapped = mapSummaryToMatch(summary, leagueKey);
          if (mapped) {
            await matchRepo.upsertMatch(mapped);
            updated += 1;
          }
        } catch {
          /* skip single match */
        }
      }

      return updated;
    });
  } finally {
    syncing.live = false;
  }
}

async function syncStandingsOnce() {
  if (syncing.standings) return { skipped: true };
  syncing.standings = true;
  try {
    return await runJob('syncStandings', async () => {
      let total = 0;
      for (const leagueKey of ALL_LEAGUE_KEYS) {
        try {
          const table = await espn.fetchStandingsRaw(leagueKey);
          let rows = table.map((row) => mapStandingRow(row, leagueKey));
          rows = await espn.enrichStandingsWithForm(leagueKey, rows);
          await standingRepo.replaceStandings(leagueKey, rows);
          total += rows.length;

          const rounds = await espn.fetchKnockoutBracket(leagueKey);
          await bracketRepo.replaceBracket(leagueKey, rounds);
        } catch {
          /* league may be off-season */
        }
      }
      return total;
    });
  } finally {
    syncing.standings = false;
  }
}

async function syncTeamsOnce() {
  if (syncing.teams) return { skipped: true };
  syncing.teams = true;
  try {
    return await runJob('syncTeams', async () => {
      let total = 0;
      for (const leagueKey of ALL_LEAGUE_KEYS) {
        try {
          const raw = await espn.fetchCompetitionTeams(leagueKey);
          const teams = raw.map((t) => mapTeam(t, leagueKey));
          await teamRepo.replaceTeamsForLeague(leagueKey, teams);
          total += teams.length;
        } catch {
          /* skip */
        }
      }
      return total;
    });
  } finally {
    syncing.teams = false;
  }
}

async function syncMatchDetail(eventId, leagueHint) {
  const { summary, leagueKey } = await espn.fetchMatchSummary(eventId, leagueHint);
  const mapped = mapSummaryToMatch(summary, leagueKey);
  if (!mapped) throw new Error('比赛不存在');
  if (isDbEnabled()) await matchRepo.upsertMatch(mapped);
  return mapped;
}

async function syncAllOnce() {
  const schedule = await syncScheduleOnce();
  const live = await syncLiveOnce();
  const standings = await syncStandingsOnce();
  const teams = await syncTeamsOnce();
  return { schedule, live, standings, teams };
}

module.exports = {
  syncScheduleOnce,
  syncLiveOnce,
  syncStandingsOnce,
  syncTeamsOnce,
  syncMatchDetail,
  syncAllOnce,
};
