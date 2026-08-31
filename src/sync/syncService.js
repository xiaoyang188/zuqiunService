const espn = require('../espnClient');
const dongqiu = require('../dongqiuClient');
const dongqiuMapper = require('../dongqiuMapper');
const { APP_LEAGUES, getLeaguePrimarySource } = require('../leagueCodes');
const {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapTeam,
  mapScorerRow,
  mapAssistRow,
  mapAthleteDetail,
  sortMatches,
} = require('../mapper');
const { mergeMatchData } = require('../matchMerge');
const matchRepo = require('../repositories/matchRepo');
const standingRepo = require('../repositories/standingRepo');
const bracketRepo = require('../repositories/bracketRepo');
const teamRepo = require('../repositories/teamRepo');
const playerRankingRepo = require('../repositories/playerRankingRepo');
const playerRepo = require('../repositories/playerRepo');
const searchIndexRepo = require('../repositories/searchIndexRepo');
const { writeSyncLog } = require('../repositories/syncLogRepo');
const { isDbEnabled } = require('../db');
const { shanghaiDayStart, scheduleDayForRange } = require('../dateRange');

const DATE_RANGES = ['yesterday', 'today', 'tomorrow', 'week'];
const ALL_LEAGUE_KEYS = Object.keys(APP_LEAGUES);
const FINISHED_RETENTION_DAYS = Number(process.env.SYNC_MATCH_RETENTION_DAYS) || 90;

const syncing = {
  schedule: false,
  live: false,
  standings: false,
  playerStats: false,
  teams: false,
  details: false,
  searchIndex: false,
};

function prefersDongqiu(leagueKey) {
  return getLeaguePrimarySource(leagueKey) === 'dongqiu';
}

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

async function refreshEspnDayBucket(dateRange, leagueKeys = ALL_LEAGUE_KEYS) {
  const scheduleDay = scheduleDayForRange(dateRange);
  let updated = 0;
  for (const leagueKey of leagueKeys) {
    try {
      const raw = await espn.fetchSchedule(dateRange, leagueKey);
      for (const item of raw) {
        const mapped = mapScheduleItem(item);
        if (!mapped) continue;
        if (scheduleDay) mapped.scheduleDay = scheduleDay;
        await matchRepo.upsertMatch(mapped);
        updated += 1;
      }
    } catch {
      /* skip league */
    }
  }
  return updated;
}

async function refreshCurrentScoreboards(leagueKeys = ALL_LEAGUE_KEYS) {
  let updated = 0;
  for (const leagueKey of leagueKeys) {
    try {
      const current = await espn.fetchCurrentScoreboard(leagueKey);
      for (const item of current) {
        const mapped = mapScheduleItem(item);
        if (!mapped) continue;
        await matchRepo.upsertMatch(mapped);
        updated += 1;
      }
    } catch {
      /* skip league */
    }
  }
  return updated;
}

async function refreshDongqiuCslMatches() {
  const leagueKey = 'Chinese Super League';
  let updated = 0;
  const ids = [];
  try {
    const tab = await dongqiu.fetchLeagueTabMatches(leagueKey);
    for (const item of tab) {
      const mapped = dongqiuMapper.mapMatchFromTab(item, leagueKey);
      if (!mapped) continue;
      await matchRepo.upsertMatch(mapped);
      ids.push(matchRepo.parseExternalId(mapped._id));
      updated += 1;
    }
    const recent = await dongqiu.fetchRecentSchedule(leagueKey);
    for (const item of recent) {
      const mapped = dongqiuMapper.mapMatchFromSchedule(item, leagueKey);
      if (!mapped) continue;
      await matchRepo.upsertMatch(mapped);
      ids.push(matchRepo.parseExternalId(mapped._id));
      updated += 1;
    }
  } catch (e) {
    console.warn('[sync] dongqiu CSL schedule failed:', e.message);
  }
  return { updated, ids };
}

async function syncScheduleOnce() {
  if (syncing.schedule) return { skipped: true };
  syncing.schedule = true;
  try {
    return await runJob('syncSchedule', async () => {
      const map = new Map();

      for (const leagueKey of ALL_LEAGUE_KEYS) {
        if (prefersDongqiu(leagueKey)) continue; // 中超走懂球
        for (const dateRange of DATE_RANGES) {
          const scheduleDay = scheduleDayForRange(dateRange);
          const raw = await espn.fetchSchedule(dateRange, leagueKey);
          raw.forEach((item) => {
            const mapped = mapScheduleItem(item);
            if (!mapped) return;
            if (scheduleDay) mapped.scheduleDay = scheduleDay;
            const existing = map.get(mapped._id);
            if (existing) {
              map.set(mapped._id, mergeMatchData(existing, mapped));
              return;
            }
            map.set(mapped._id, mapped);
          });
        }
      }

      const list = sortMatches(Array.from(map.values()));
      await matchRepo.upsertMatches(list);

      await refreshCurrentScoreboards(
        ALL_LEAGUE_KEYS.filter((k) => !prefersDongqiu(k))
      );
      await refreshEspnDayBucket(
        'yesterday',
        ALL_LEAGUE_KEYS.filter((k) => !prefersDongqiu(k))
      );

      const { updated: dongqiuRows, ids: dqIds } = await refreshDongqiuCslMatches();

      const syncedIds = [
        ...list.map((m) => matchRepo.parseExternalId(m._id)),
        ...dqIds,
      ];
      const prunedWindow = await matchRepo.pruneMissingInRanges(DATE_RANGES, syncedIds);
      const cutoff = shanghaiDayStart(-FINISHED_RETENTION_DAYS);
      const prunedOld = await matchRepo.pruneFinishedBefore(cutoff);

      return list.length + dongqiuRows + prunedWindow + prunedOld;
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
      const espnLeagues = ALL_LEAGUE_KEYS.filter((k) => !prefersDongqiu(k));
      let updated = await refreshCurrentScoreboards([
        'World Cup',
        ...espnLeagues.filter((k) => k !== 'World Cup'),
      ]);
      updated += await refreshEspnDayBucket('yesterday', [
        'World Cup',
        ...espnLeagues.filter((k) => k !== 'World Cup'),
      ]);
      updated += await refreshDongqiuCslMatches();

      const liveRows = await matchRepo.findLiveMatches();
      const staleRows = await matchRepo.findKickoffStaleMatches(40);
      const seen = new Set();
      const rows = [];
      for (const row of [...liveRows, ...staleRows]) {
        const id = String(row.external_id);
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push(row);
      }

      for (const row of rows) {
        if (String(row.external_id).startsWith('dq_') || prefersDongqiu(row.league_key)) {
          continue; // 懂球帝场次靠 tab 刷新
        }
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
          if (prefersDongqiu(leagueKey)) {
            const table = await dongqiu.fetchStandings(leagueKey);
            const rows = table.map((row, i) =>
              dongqiuMapper.mapStandingRow(row, leagueKey, i)
            );
            await standingRepo.replaceStandings(leagueKey, rows);
            total += rows.length;
            await bracketRepo.replaceBracket(leagueKey, []);
            continue;
          }
          const table = await espn.fetchStandingsRaw(leagueKey);
          let rows = table.map((row) => mapStandingRow(row, leagueKey));
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

async function cacheAthleteProfiles(leagueKey, athleteIds) {
  const unique = [...new Set(athleteIds.filter((id) => /^\d+$/.test(String(id))))];
  let cached = 0;
  for (const id of unique.slice(0, 30)) {
    try {
      const raw = await espn.fetchAthleteRaw(id, leagueKey);
      const mapped = mapAthleteDetail(raw, leagueKey);
      if (mapped) {
        await playerRepo.upsertPlayer(id, leagueKey, mapped);
        cached += 1;
      }
    } catch {
      /* skip athlete */
    }
  }
  return cached;
}

async function syncLeaguePlayerStats(leagueKey) {
  if (prefersDongqiu(leagueKey)) {
    const scorersRaw = await dongqiu.fetchPersonRanking(leagueKey, 'goals');
    const scorers = scorersRaw.map((row, i) => dongqiuMapper.mapScorerRow(row, i));
    await playerRankingRepo.replaceRankings(leagueKey, 'scorers', scorers);

    let assists = [];
    try {
      const assistsRaw = await dongqiu.fetchPersonRanking(leagueKey, 'assists');
      assists = assistsRaw.map((row, i) => dongqiuMapper.mapAssistRow(row, i));
      await playerRankingRepo.replaceRankings(leagueKey, 'assists', assists);
    } catch {
      await playerRankingRepo.replaceRankings(leagueKey, 'assists', []);
    }

    const athleteIds = scorersRaw
      .map((r) => String(r.person_id || ''))
      .filter((id) => /^\d+$/.test(id))
      .slice(0, 20);
    for (const id of athleteIds) {
      try {
        const raw = await dongqiu.fetchPersonDetail(id);
        const mapped = dongqiuMapper.mapPersonDetail(raw, leagueKey);
        if (mapped) await playerRepo.upsertPlayer(id, leagueKey, mapped);
      } catch {
        /* skip */
      }
    }
    return scorers.length + assists.length;
  }

  const syncLimit = 20;
  const athleteIds = [];

  const scorerRaw = await espn.fetchScorersFromPlays(leagueKey, syncLimit);
  const scorers = scorerRaw.map((row, i) => mapScorerRow(row, i));
  await playerRankingRepo.replaceRankings(leagueKey, 'scorers', scorers);
  scorerRaw.forEach((row) => {
    if (/^\d+$/.test(String(row.key))) athleteIds.push(String(row.key));
  });

  const assistRaw = await espn.fetchAssistsFromSummaries(leagueKey, syncLimit);
  const assists = assistRaw.map((row, i) => mapAssistRow(row, i));
  await playerRankingRepo.replaceRankings(leagueKey, 'assists', assists);
  assistRaw.forEach((row) => {
    if (/^\d+$/.test(String(row.key))) athleteIds.push(String(row.key));
  });

  await cacheAthleteProfiles(leagueKey, athleteIds);
  return scorers.length + assists.length;
}

async function syncPlayerStatsOnce() {
  if (syncing.playerStats) return { skipped: true };
  syncing.playerStats = true;
  try {
    return await runJob('syncPlayerStats', async () => {
      let total = 0;
      for (const leagueKey of ALL_LEAGUE_KEYS) {
        try {
          total += await syncLeaguePlayerStats(leagueKey);
        } catch {
          /* league may be off-season */
        }
      }
      return total;
    });
  } finally {
    syncing.playerStats = false;
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
          if (prefersDongqiu(leagueKey)) {
            const table = await dongqiu.fetchStandings(leagueKey);
            const teams = table.map((r) => dongqiuMapper.mapTeamFromStanding(r, leagueKey));
            await teamRepo.replaceTeamsForLeague(leagueKey, teams);
            total += teams.length;
            continue;
          }
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

/** 中超球队阵容 + 射手入库搜索索引，加速 /api/search */
async function syncSearchIndexOnce() {
  if (syncing.searchIndex) return { skipped: true };
  syncing.searchIndex = true;
  try {
    return await runJob('syncSearchIndex', async () => {
      let total = 0;
      const leagueKey = 'Chinese Super League';
      const leagueLabel = '中超';

      const standings = await dongqiu.fetchStandings(leagueKey);
      const teamHits = standings.map((r) => {
        const mapped = dongqiuMapper.mapTeamFromStanding(r, leagueKey);
        return {
          type: 'team',
          id: String(mapped._id || '').replace(/^dq_team_/, ''),
          name: mapped.name,
          logo: mapped.logo || '',
          subtitle: leagueLabel,
          leagueKey,
          leagueLabel,
          source: 'dongqiu',
        };
      });
      await searchIndexRepo.upsertHits(teamHits);
      total += teamHits.length;

      const scorersRaw = await dongqiu.fetchPersonRanking(leagueKey, 'goals');
      const scorerHits = scorersRaw.map((row, i) => {
        const s = dongqiuMapper.mapScorerRow(row, i);
        return {
          type: 'player',
          id: s.personId,
          name: s.name,
          logo: s.logo || '',
          subtitle: [s.team, leagueLabel].filter(Boolean).join(' · '),
          leagueKey,
          leagueLabel,
          source: 'dongqiu',
          team: s.team,
        };
      });
      await searchIndexRepo.upsertHits(scorerHits.filter((h) => h.id && h.name));
      total += scorerHits.length;

      // 每队取一名射手作种子，拉取队友写入索引
      const seedByTeam = new Map();
      scorersRaw.forEach((row) => {
        const teamId = String(row.team_id || '');
        const personId = String(row.person_id || '');
        if (teamId && personId && !seedByTeam.has(teamId)) {
          seedByTeam.set(teamId, personId);
        }
      });

      for (const personId of seedByTeam.values()) {
        try {
          const mates = await dongqiu.fetchPersonTeammates(personId);
          const roster = dongqiuMapper.mapTeammatesToRoster(mates);
          const hits = roster.map((p) => ({
            type: 'player',
            id: p.athleteId || p.id,
            name: p.name,
            logo: p.avatar || '',
            subtitle: [leagueLabel, p.position].filter(Boolean).join(' · '),
            leagueKey,
            leagueLabel,
            source: 'dongqiu',
          }));
          await searchIndexRepo.upsertHits(hits.filter((h) => h.id && h.name));
          total += hits.length;

    // 顺带缓存种子球员完整详情
          try {
            const raw = await dongqiu.fetchPersonDetail(personId);
            const mapped = dongqiuMapper.mapPersonDetail(raw, leagueKey);
            if (mapped) {
              await playerRepo.upsertPlayer(personId, leagueKey, mapped);
              await searchIndexRepo.upsertHit({
                type: 'player',
                id: personId,
                name: mapped.name,
                enName: mapped.shortName || '',
                logo: mapped.avatar || '',
                subtitle: [mapped.teamName, leagueLabel].filter(Boolean).join(' · '),
                leagueKey,
                leagueLabel,
                source: 'dongqiu',
              });
            }
          } catch {
            /* skip detail */
          }
        } catch {
          /* skip roster */
        }
      }

      // 其它联赛：积分榜球队名入库（ESPN 侧）
      for (const key of ALL_LEAGUE_KEYS) {
        if (prefersDongqiu(key)) continue;
        try {
          const teams = await teamRepo.findByLeague(key);
          const label = APP_LEAGUES[key]?.label || key;
          const hits = (teams || []).map((t) => ({
            type: 'team',
            id: String(t._id || t.external_id || '').replace(/^(dq_team_|espn_team_)/, ''),
            name: t.name,
            logo: t.logo || '',
            subtitle: label,
            leagueKey: key,
            leagueLabel: label,
            source: 'espn',
          }));
          await searchIndexRepo.upsertHits(hits.filter((h) => h.id && h.name));
          total += hits.length;
        } catch {
          /* skip */
        }
      }

      return total;
    });
  } finally {
    syncing.searchIndex = false;
  }
}

async function syncMatchDetailsOnce() {
  if (syncing.details) return { skipped: true };
  syncing.details = true;
  try {
    return await runJob('syncMatchDetails', async () => {
      const rows = await matchRepo.findNeedingDetailEnrich(12);
      let enriched = 0;
      for (const row of rows) {
        if (String(row.external_id).startsWith('dq_') || prefersDongqiu(row.league_key)) {
          continue;
        }
        try {
          await syncMatchDetail(row.external_id, row.league_key);
          enriched += 1;
        } catch {
          /* skip single match */
        }
      }
      return enriched;
    });
  } finally {
    syncing.details = false;
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
  const details = await syncMatchDetailsOnce();
  const standings = await syncStandingsOnce();
  const playerStats = await syncPlayerStatsOnce();
  const teams = await syncTeamsOnce();
  const searchIndex = await syncSearchIndexOnce();
  return { schedule, live, details, standings, playerStats, teams, searchIndex };
}

module.exports = {
  syncScheduleOnce,
  syncLiveOnce,
  syncStandingsOnce,
  syncPlayerStatsOnce,
  syncMatchDetailsOnce,
  syncTeamsOnce,
  syncSearchIndexOnce,
  syncMatchDetail,
  syncAllOnce,
};
