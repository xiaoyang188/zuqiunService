const { getPool } = require('../db');
const { mergeMatchData } = require('../matchMerge');
const {
  getDateRangeBounds,
  toMysqlDatetime,
  scheduleDayForRange,
  scheduleDayBoundsForRange,
  scheduleDayFromInstant,
  getMatchTimeFallbackBounds,
} = require('../dateRange');

function parseExternalId(matchId) {
  return String(matchId).replace(/^(espn_match_|fd_match_)/, '');
}

function rowToMatch(row) {
  if (!row) return null;
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return payload;
}

async function upsertMatch(match) {
  const pool = getPool();
  const externalId = parseExternalId(match._id);
  const existingRow = await findByExternalId(externalId);
  const existing = existingRow ? rowToMatch(existingRow) : null;
  const merged = mergeMatchData(existing, match);
  if (!merged.scheduleDay && merged.matchTime) {
    merged.scheduleDay = scheduleDayFromInstant(merged.matchTime);
  }
  const matchTime = toMysqlDatetime(merged.matchTime);

  await pool.execute(
    `INSERT INTO matches
      (external_id, league_key, status, match_time, schedule_day, minute, home_score, away_score, payload, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
      league_key = VALUES(league_key),
      status = VALUES(status),
      match_time = VALUES(match_time),
      schedule_day = COALESCE(VALUES(schedule_day), schedule_day),
      minute = VALUES(minute),
      home_score = VALUES(home_score),
      away_score = VALUES(away_score),
      payload = VALUES(payload),
      synced_at = NOW()`,
    [
      externalId,
      merged.league,
      merged.status,
      matchTime,
      merged.scheduleDay || null,
      merged.minute ?? null,
      merged.homeScore ?? 0,
      merged.awayScore ?? 0,
      JSON.stringify(merged),
    ]
  );
}

async function upsertMatches(matches) {
  for (const m of matches) {
    if (m) await upsertMatch(m);
  }
}

async function queryByScheduleDay(pool, scheduleDay, leagueKey, includeYesterdayFinished = false) {
  let sql;
  const params = [];

  if (includeYesterdayFinished) {
    const yesterday = scheduleDayForRange('yesterday');
    // 「今天」含昨天整页赛程：避免开球日在昨天、状态仍为 NS 的场次被漏掉
    sql = `SELECT payload FROM matches
      WHERE (
        schedule_day = ?
        OR schedule_day = ?
        OR status IN ('LIVE', 'HT', 'ET', 'PEN')
      )`;
    params.push(scheduleDay, yesterday);
  } else {
    sql = `SELECT payload FROM matches WHERE schedule_day = ?`;
    params.push(scheduleDay);
  }

  if (leagueKey) {
    sql += ` AND league_key = ?`;
    params.push(leagueKey);
  }
  sql += ` ORDER BY match_time ASC`;
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (e) {
    if (/schedule_day|Unknown column/i.test(e.message)) return [];
    throw e;
  }
}

async function findByDateRange(dateRange, leagueKey) {
  const pool = getPool();

  if (dateRange === 'today' || dateRange === 'tomorrow') {
    const scheduleDay = scheduleDayForRange(dateRange);
    let rows = await queryByScheduleDay(
      pool,
      scheduleDay,
      leagueKey,
      dateRange === 'today'
    );

    if (!rows.length && dateRange === 'today') {
      const { start, end } = getMatchTimeFallbackBounds('today');
      let fallbackSql = `SELECT payload FROM matches WHERE match_time >= ? AND match_time < ?`;
      const fallbackParams = [toMysqlDatetime(start), toMysqlDatetime(end)];
      if (leagueKey) {
        fallbackSql += ` AND league_key = ?`;
        fallbackParams.push(leagueKey);
      }
      fallbackSql += ` ORDER BY match_time ASC`;
      [rows] = await pool.execute(fallbackSql, fallbackParams);
    }

    if (!rows.length && dateRange === 'tomorrow') {
      const { start, end } = getDateRangeBounds('tomorrow');
      let fallbackSql = `SELECT payload FROM matches WHERE match_time >= ? AND match_time < ?`;
      const fallbackParams = [toMysqlDatetime(start), toMysqlDatetime(end)];
      if (leagueKey) {
        fallbackSql += ` AND league_key = ?`;
        fallbackParams.push(leagueKey);
      }
      fallbackSql += ` ORDER BY match_time ASC`;
      [rows] = await pool.execute(fallbackSql, fallbackParams);
    }

    return rows.map(rowToMatch).filter(Boolean);
  }

  if (dateRange === 'week') {
    const { start, end } = getDateRangeBounds('week');
    let rows = [];
    try {
      const { start: dayStart, end: dayEnd } = scheduleDayBoundsForRange('week');
      let sql = `SELECT payload FROM matches
        WHERE (
          (schedule_day >= ? AND schedule_day <= ?)
          OR (schedule_day IS NULL AND match_time >= ? AND match_time < ?)
          OR (status IN ('FT', 'AET', 'LIVE', 'HT', 'ET', 'PEN') AND match_time >= ? AND match_time < ?)
        )`;
      const params = [
        dayStart,
        dayEnd,
        toMysqlDatetime(start),
        toMysqlDatetime(end),
        toMysqlDatetime(start),
        toMysqlDatetime(end),
      ];
      if (leagueKey) {
        sql += ` AND league_key = ?`;
        params.push(leagueKey);
      }
      sql += ` ORDER BY match_time ASC`;
      [rows] = await pool.execute(sql, params);
    } catch (e) {
      if (!/schedule_day|Unknown column/i.test(e.message)) throw e;
    }
    if (rows.length) return rows.map(rowToMatch).filter(Boolean);

    let sql = `SELECT payload FROM matches WHERE match_time >= ? AND match_time < ?`;
    const params = [toMysqlDatetime(start), toMysqlDatetime(end)];
    if (leagueKey) {
      sql += ` AND league_key = ?`;
      params.push(leagueKey);
    }
    sql += ` ORDER BY match_time ASC`;
    [rows] = await pool.execute(sql, params);
    return rows.map(rowToMatch).filter(Boolean);
  }

  const { start, end } = getDateRangeBounds(dateRange);
  let sql = `SELECT payload FROM matches WHERE match_time >= ? AND match_time < ?`;
  const params = [toMysqlDatetime(start), toMysqlDatetime(end)];
  if (leagueKey) {
    sql += ` AND league_key = ?`;
    params.push(leagueKey);
  }
  sql += ` ORDER BY match_time ASC`;
  const [rows] = await pool.execute(sql, params);
  return rows.map(rowToMatch).filter(Boolean);
}

async function findToday() {
  return findByDateRange('today');
}

async function findByExternalId(externalId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT payload, status, synced_at FROM matches WHERE external_id = ? LIMIT 1`,
    [String(externalId)]
  );
  return rows[0] || null;
}

async function findKickoffStaleMatches(limit = 40) {
  const pool = getPool();
  const now = new Date();
  const start = new Date(now.getTime() - 12 * 3600_000);
  const end = new Date(now.getTime() + 20 * 60_000);
  const [rows] = await pool.execute(
    `SELECT external_id, league_key, payload, status
     FROM matches
     WHERE status IN ('NS', 'LIVE', 'HT', 'ET', 'PEN')
       AND match_time >= ? AND match_time <= ?
     ORDER BY match_time DESC
     LIMIT ${Math.min(Math.max(limit, 1), 60)}`,
    [toMysqlDatetime(start), toMysqlDatetime(end)]
  );
  return rows;
}

async function findLiveMatches() {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT external_id, league_key, payload, synced_at FROM matches WHERE status IN ('LIVE', 'HT', 'ET', 'PEN')`
  );
  return rows;
}

async function countMatches() {
  const pool = getPool();
  const [[row]] = await pool.query(`SELECT COUNT(*) AS cnt FROM matches`);
  return row.cnt;
}

/** 近几日缺少 stats/事件/阵容 的比赛，供后台补全详情 */
async function findNeedingDetailEnrich(limit = 15) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT external_id, league_key, payload, status, match_time
     FROM matches
     WHERE match_time >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
       AND match_time < DATE_ADD(CURDATE(), INTERVAL 2 DAY)
     ORDER BY FIELD(status, 'LIVE', 'ET', 'PEN', 'HT', 'NS', 'FT', 'AET'), match_time DESC
     LIMIT 80`
  );
  const need = [];
  for (const row of rows) {
    if (need.length >= limit) break;
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const missingStats = !payload?.stats;
    const missingEvents = !(payload?.events?.length);
    const missingLineups = !(payload?.lineups?.length);
    const missingPenaltyDetail =
      (payload?.decidedByPenalties || payload?.periodLabel === '点球大战') &&
      !(payload?.penaltyShootout?.length);
    if (missingStats || missingEvents || missingLineups || missingPenaltyDetail) need.push(row);
  }
  return need;
}

/** 删除同步窗口内已不在 ESPN 返回列表中的比赛（避免残留旧赛程） */
async function pruneMissingInRanges(dateRanges, syncedExternalIds) {
  const pool = getPool();
  const keep = new Set(syncedExternalIds.map(String));
  let removed = 0;

  for (const dateRange of dateRanges) {
    const { start, end } = getDateRangeBounds(dateRange);
    const [rows] = await pool.execute(
      `SELECT external_id, status FROM matches WHERE match_time >= ? AND match_time < ?`,
      [toMysqlDatetime(start), toMysqlDatetime(end)]
    );
    for (const row of rows) {
      if (keep.has(String(row.external_id))) continue;
      // 已结束场次 ESPN 后续 scoreboard 常不再返回，不能因缺步就删库
      if (row.status === 'FT' || row.status === 'LIVE' || row.status === 'HT') continue;
      await pool.execute(`DELETE FROM matches WHERE external_id = ?`, [row.external_id]);
      removed += 1;
    }
  }
  return removed;
}

/** 清理过久的历史已结束比赛 */
async function pruneFinishedBefore(beforeDate) {
  const pool = getPool();
  const [result] = await pool.execute(
    `DELETE FROM matches WHERE status = 'FT' AND match_time < ?`,
    [toMysqlDatetime(beforeDate)]
  );
  return result.affectedRows || 0;
}

/**
 * 查找应在本轮扫描窗口内发送提醒的比赛。
 * remindAt = match_time - advanceMinutes，当 remindAt ∈ (now - scanWindow, now] 时触发。
 */
async function findDueForReminder(teamFullId, advanceMinutes, scanMinutes) {
  const pool = getPool();
  const upperOffset = advanceMinutes;
  const lowerOffset = Math.max(0, advanceMinutes - scanMinutes);
  const [rows] = await pool.execute(
    `SELECT external_id, match_time, payload, status
     FROM matches
     WHERE status = 'NS'
       AND match_time <= DATE_ADD(NOW(), INTERVAL ? MINUTE)
       AND match_time > DATE_ADD(NOW(), INTERVAL ? MINUTE)
       AND (
         JSON_UNQUOTE(JSON_EXTRACT(payload, '$.homeTeam')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(payload, '$.awayTeam')) = ?
       )
     ORDER BY match_time ASC`,
    [upperOffset, lowerOffset, teamFullId, teamFullId]
  );
  return rows;
}

module.exports = {
  upsertMatch,
  upsertMatches,
  findByDateRange,
  findToday,
  findByExternalId,
  findLiveMatches,
  findKickoffStaleMatches,
  countMatches,
  findNeedingDetailEnrich,
  pruneMissingInRanges,
  pruneFinishedBefore,
  findDueForReminder,
  parseExternalId,
  rowToMatch,
};
