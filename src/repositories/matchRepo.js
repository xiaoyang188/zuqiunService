const { getPool } = require('../db');
const { getDateRangeBounds, toMysqlDatetime } = require('../dateRange');

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
  const matchTime = toMysqlDatetime(match.matchTime);

  await pool.execute(
    `INSERT INTO matches
      (external_id, league_key, status, match_time, minute, home_score, away_score, payload, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
      league_key = VALUES(league_key),
      status = VALUES(status),
      match_time = VALUES(match_time),
      minute = VALUES(minute),
      home_score = VALUES(home_score),
      away_score = VALUES(away_score),
      payload = VALUES(payload),
      synced_at = NOW()`,
    [
      externalId,
      match.league,
      match.status,
      matchTime,
      match.minute ?? null,
      match.homeScore ?? 0,
      match.awayScore ?? 0,
      JSON.stringify(match),
    ]
  );
}

async function upsertMatches(matches) {
  for (const m of matches) {
    if (m) await upsertMatch(m);
  }
}

async function findByDateRange(dateRange, leagueKey) {
  const pool = getPool();
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

async function findLiveMatches() {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT external_id, league_key, payload, synced_at FROM matches WHERE status IN ('LIVE', 'HT')`
  );
  return rows;
}

async function countMatches() {
  const pool = getPool();
  const [[row]] = await pool.query(`SELECT COUNT(*) AS cnt FROM matches`);
  return row.cnt;
}

/** 今日/明日且缺少 stats/事件/阵容 的比赛，供后台补全详情 */
async function findNeedingDetailEnrich(limit = 15) {
  const pool = getPool();
  const [rows] = await pool.execute(
    `SELECT external_id, league_key, payload, status, match_time
     FROM matches
     WHERE match_time >= CURDATE()
       AND match_time < DATE_ADD(CURDATE(), INTERVAL 2 DAY)
     ORDER BY FIELD(status, 'LIVE', 'HT', 'NS', 'FT'), match_time ASC
     LIMIT 60`
  );
  const need = [];
  for (const row of rows) {
    if (need.length >= limit) break;
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const hasDetail =
      Boolean(payload?.stats) ||
      (payload?.events?.length ?? 0) > 0 ||
      (payload?.lineups?.length ?? 0) > 0;
    if (!hasDetail) need.push(row);
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
      if (row.status === 'FT') continue;
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

module.exports = {
  upsertMatch,
  upsertMatches,
  findByDateRange,
  findToday,
  findByExternalId,
  findLiveMatches,
  countMatches,
  findNeedingDetailEnrich,
  pruneMissingInRanges,
  pruneFinishedBefore,
  parseExternalId,
  rowToMatch,
};
