/** 状态优先级：禁止 sync 把 FT/LIVE 覆盖回 NS */
const STATUS_RANK = { LIVE: 4, HT: 3, FT: 2, NS: 1, POSTPONED: 0 };

function statusRank(status) {
  return STATUS_RANK[status] ?? 0;
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

  out.scheduleDay = incoming.scheduleDay || existing.scheduleDay || out.scheduleDay;
  return out;
}

module.exports = { mergeMatchData, statusRank };
