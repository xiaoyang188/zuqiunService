/** 状态优先级：FT/AET 最高；进行中 ET/PEN 与 LIVE 同级；禁止旧 scoreboard 覆盖已结束 */
const STATUS_RANK = { FT: 5, AET: 5, LIVE: 4, ET: 4, PEN: 4, HT: 3, NS: 1, POSTPONED: 0 };

function statusRank(status) {
  return STATUS_RANK[status] ?? 0;
}

/** 详情 enrich 字段：赛程/直播同步不应用空值覆盖 */
const DETAIL_PRESERVE_KEYS = [
  'stats',
  'events',
  'lineups',
  'highlight',
  'referee',
  'broadcast',
  'venueDetail',
  'groupText',
  'stageText',
  'competitionNote',
  'scoreBreakdown',
  'penaltyShootout',
];

const FLAG_PRESERVE_KEYS = ['wentToExtraTime', 'decidedByPenalties'];

function isEmptyDetail(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 合并两条比赛记录，保留更高优先级状态与对应比分 */
function mergeMatchData(existing, incoming) {
  if (!existing) return { ...incoming };
  if (!incoming) return { ...existing };

  const out = { ...existing, ...incoming };
  const existingRank = statusRank(existing.status);
  const incomingRank = statusRank(incoming.status);

  if (incomingRank >= existingRank) {
    out.status = incoming.status;
    out.homeScore = incoming.homeScore;
    out.awayScore = incoming.awayScore;
    out.minute = incoming.minute;
    out.statusBadge = incoming.statusBadge ?? existing.statusBadge;
  } else {
    out.status = existing.status;
    out.homeScore = existing.homeScore;
    out.awayScore = existing.awayScore;
    out.minute = existing.minute;
    out.statusBadge = existing.statusBadge ?? incoming.statusBadge;
  }

  for (const key of DETAIL_PRESERVE_KEYS) {
    if (isEmptyDetail(incoming[key]) && !isEmptyDetail(existing[key])) {
      out[key] = existing[key];
    }
  }

  for (const key of FLAG_PRESERVE_KEYS) {
    if (!incoming[key] && existing[key]) {
      out[key] = existing[key];
    }
  }

  if (!incoming.periodLabel && existing.periodLabel) {
    out.periodLabel = existing.periodLabel;
  }

  out.scheduleDay = incoming.scheduleDay || existing.scheduleDay || out.scheduleDay;
  return out;
}

module.exports = { mergeMatchData, statusRank };
