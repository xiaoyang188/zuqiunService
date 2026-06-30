const { getLeagueLabel } = require('./leagueCodes');
const { registerEvent } = require('./espnClient');
const { scheduleDayFromInstant } = require('./dateRange');
const { toZhName, toZhCountry, resolveTeamDisplayName, toZhPosition } = require('./zhNames');

const ESPN_STATUS_MAP = {
  pre: 'NS',
  post: 'FT',
};

function isPenaltyFinished(name, detail) {
  return (
    /STATUS_FINAL_PEN|STATUS_AFTER_SHOOTOUT/i.test(name) ||
    /FT-Pens|After Penalt|Pens$/i.test(detail)
  );
}

function isExtraTimeFinished(name, detail) {
  return (
    /STATUS_FINAL_AET|STATUS_AFTER_EXTRA_TIME/i.test(name) ||
    /AET|After Extra/i.test(detail)
  );
}

function isLiveExtraTime(name, detail) {
  return (
    /STATUS_EXTRA_TIME|EXTRA_TIME|1ST_EXTRA|2ND_HALF_EXTRA/i.test(name) ||
    /Extra Time|ET\b/i.test(detail)
  );
}

function isLiveShootout(name, detail) {
  return (
    /STATUS_PENALT|STATUS_SHOOTOUT|SHOOTOUT/i.test(name) ||
    /Shootout|Pens\b/i.test(detail)
  );
}

function mapEspnStatus(status) {
  const state = status?.type?.state;
  const name = status?.type?.name || '';
  const detail = status?.type?.detail || status?.type?.shortDetail || '';

  if (state === 'in') {
    if (/half/i.test(name) || name === 'STATUS_HALFTIME') return 'HT';
    if (isLiveShootout(name, detail)) return 'PEN';
    if (isLiveExtraTime(name, detail)) return 'ET';
    return 'LIVE';
  }

  if (isPenaltyFinished(name, detail)) return 'FT';
  if (isExtraTimeFinished(name, detail)) return 'AET';

  if (status?.type?.completed === true) return 'FT';
  if (state === 'post') return 'FT';
  if (/full.?time|STATUS_FULL_TIME|final/i.test(name) || /^FT$/i.test(String(detail).trim())) {
    return 'FT';
  }
  if (state === 'pre') return 'NS';
  return ESPN_STATUS_MAP[state] || 'NS';
}

function parseScoreBreakdown(homeComp, awayComp) {
  const hLines = (homeComp?.linescores || []).map((l) => Number(l.displayValue) || 0);
  const aLines = (awayComp?.linescores || []).map((l) => Number(l.displayValue) || 0);
  if (!hLines.length || hLines.length !== aLines.length) return null;

  const regulation = {
    home: (hLines[0] ?? 0) + (hLines[1] ?? 0),
    away: (aLines[0] ?? 0) + (aLines[1] ?? 0),
  };

  let extraTime;
  let penalty;
  if (hLines.length >= 4) {
    extraTime = {
      home: (hLines[2] ?? 0) + (hLines[3] ?? 0),
      away: (aLines[2] ?? 0) + (aLines[3] ?? 0),
    };
  }
  if (hLines.length >= 5) {
    penalty = { home: hLines[4] ?? 0, away: aLines[4] ?? 0 };
  }

  const aggregate = extraTime
    ? { home: regulation.home + extraTime.home, away: regulation.away + extraTime.away }
    : { ...regulation };

  const wentToExtraTime = Boolean(extraTime && hLines.length >= 4);
  const decidedByPenalties = Boolean(penalty && hLines.length >= 5);

  if (!wentToExtraTime && !decidedByPenalties) return null;

  return {
    regulation,
    extraTime: wentToExtraTime ? extraTime : undefined,
    penalty: decidedByPenalties ? penalty : undefined,
    aggregate,
    wentToExtraTime,
    decidedByPenalties,
  };
}

function buildStatusBadge(comp, status, statusDetail) {
  const displayClock = comp.status?.displayClock || '';
  const completed =
    comp.status?.type?.completed === true || comp.status?.type?.state === 'post';
  if (completed && displayClock && /'\s*$/.test(displayClock) && statusDetail) {
    return statusDetail;
  }
  if (status === 'HT') return 'HT';
  if (status === 'ET') return displayClock || '加时';
  if (status === 'PEN') return displayClock || '点球大战';
  return displayClock || statusDetail || (status === 'FT' ? 'FT' : '');
}

function inferPeriodFlags(status, statusDetail, scoreBreakdown) {
  if (scoreBreakdown) {
    return {
      wentToExtraTime: scoreBreakdown.wentToExtraTime,
      decidedByPenalties: scoreBreakdown.decidedByPenalties,
      periodLabel: buildPeriodLabel(status, scoreBreakdown, statusDetail),
    };
  }
  const decidedByPenalties =
    isPenaltyFinished('', statusDetail) ||
    /STATUS_FINAL_PEN|FT-Pens/i.test(statusDetail || '');
  const wentToExtraTime =
    status === 'AET' ||
    isExtraTimeFinished('', statusDetail) ||
    (decidedByPenalties && /120|ET|Extra/i.test(statusDetail || ''));
  const periodLabel = buildPeriodLabel(status, null, statusDetail);
  return {
    wentToExtraTime: wentToExtraTime || decidedByPenalties,
    decidedByPenalties,
    periodLabel,
  };
}

function buildPeriodLabel(status, scoreBreakdown, statusDetail) {
  if (status === 'ET') return '加时';
  if (status === 'PEN') return '点球大战';
  if (status === 'AET') return '加时完场';
  if (scoreBreakdown?.decidedByPenalties || /FT-Pens|penalt/i.test(statusDetail || '')) {
    return '点球大战';
  }
  if (scoreBreakdown?.wentToExtraTime) return '加时完场';
  return '';
}

function parseMinute(displayClock) {
  if (!displayClock) return null;
  const m = displayClock.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function teamLogo(team) {
  return team?.logos?.[0]?.href || team?.logo || '';
}

function statValue(stats, name) {
  const item = stats?.find((s) => s.name === name);
  if (!item) return 0;
  const v = item.value ?? item.displayValue;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function mapEventToMatch(event, leagueKey, leagueSlug) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  if (!home?.team || !away?.team) return null;

  registerEvent(event.id, leagueKey, leagueSlug, comp.id);

  const displayClock = comp.status?.displayClock || '';
  const statusDetail = comp.status?.type?.shortDetail || comp.status?.type?.detail || '';
  const status = mapEspnStatus(comp.status);
  const scoreBreakdown = parseScoreBreakdown(home, away);
  const periodFlags = inferPeriodFlags(status, statusDetail, scoreBreakdown);
  const matchTime = comp.startDate || event.date;
  return {
    _id: `espn_match_${event.id}`,
    league: leagueKey,
    leagueName: getLeagueLabel(leagueKey),
    homeTeam: `espn_team_${home.team.id}`,
    awayTeam: `espn_team_${away.team.id}`,
    homeTeamName: resolveTeamDisplayName(home.team),
    awayTeamName: resolveTeamDisplayName(away.team),
    homeTeamLogo: teamLogo(home.team),
    awayTeamLogo: teamLogo(away.team),
    homeAbbr: home.team.abbreviation || '',
    awayAbbr: away.team.abbreviation || '',
    homeScore: Number(home.score) || 0,
    awayScore: Number(away.score) || 0,
    status,
    matchTime,
    scheduleDay: matchTime ? scheduleDayFromInstant(matchTime) : undefined,
    minute: status === 'LIVE' || status === 'HT' || status === 'ET' || status === 'PEN'
      ? parseMinute(displayClock)
      : null,
    statusBadge: buildStatusBadge(comp, status, statusDetail),
    periodLabel: periodFlags.periodLabel,
    scoreBreakdown: scoreBreakdown || undefined,
    wentToExtraTime: periodFlags.wentToExtraTime,
    decidedByPenalties: periodFlags.decidedByPenalties,
    venue: comp.venue?.fullName || '',
  };
}

function mapScheduleItem({ event, leagueKey, leagueSlug }) {
  return mapEventToMatch(event, leagueKey, leagueSlug);
}

function formatVenueDetail(venue) {
  if (!venue) return '';
  const country = venue.address?.country ? toZhCountry(venue.address.country) : '';
  const parts = [venue.fullName, venue.address?.city, country].filter(Boolean);
  return parts.join(' · ');
}

function formatBroadcasts(list) {
  const names = (list || [])
    .map((b) => b.media?.shortName || b.media?.callLetters)
    .filter(Boolean);
  return [...new Set(names)].join(' / ');
}

const EVENT_TYPE_LABELS = {
  'yellow-card': '黄牌',
  'red-card': '红牌',
  goal: '进球',
  'penalty---scored': '点球',
  substitution: '换人',
  foul: '犯规',
  offside: '越位',
  'throw-in': '界外球',
  'take-on': '带球',
  interception: '拦截',
  'shot-off-target': '射偏',
  out: '换下',
  'var---referee-decision-cancelled': 'VAR',
  'end-regular-time': '常规结束',
  'start-extra-time': '加时开始',
  'halftime-extra-time': '加时中场',
  'start-2nd-half-extra-time': '加时下半场',
  'end-extra-time': '加时结束',
  'start-shootout': '点球大战',
  'end-match': '比赛结束',
  'start-delay': '比赛中断',
  'end-delay': '比赛恢复',
  'start-2nd-half': '下半场开始',
  halftime: '中场休息',
};

function mapEventLabel(item) {
  const type = item.type?.type || '';
  if (EVENT_TYPE_LABELS[type]) return EVENT_TYPE_LABELS[type];
  if (item.scoringPlay) return item.penaltyKick ? '点球' : '进球';
  const text = item.type?.text || '';
  if (/yellow/i.test(text)) return '黄牌';
  if (/red/i.test(text)) return '红牌';
  if (/penalty/i.test(text)) return '点球';
  if (/goal/i.test(text)) return '进球';
  return text || '事件';
}

function playerFromEvent(item) {
  const fromParticipant = item.participants?.[0]?.athlete?.displayName;
  if (fromParticipant) return fromParticipant;
  const short = item.shortText || '';
  const cleaned = short.replace(/\s+(Yellow Card|Red Card|Penalty.*|Goal).*$/i, '').trim();
  return cleaned || '';
}

function mapKeyEvents(keyEvents, homeTeamId, homeLogo, awayLogo) {
  const SKIP_TYPES = new Set(['kickoff', 'start-period', 'end-period']);
  return (keyEvents || [])
    .filter((e) => !SKIP_TYPES.has(e.type?.type || ''))
    .filter((e) => e.clock?.displayValue || e.text || e.shortText)
    .map((e) => {
      const isHome = String(e.team?.id) === String(homeTeamId);
      const type = e.type?.type || '';
      const isPeriodMarker = [
        'end-regular-time',
        'start-extra-time',
        'halftime-extra-time',
        'start-2nd-half-extra-time',
        'end-extra-time',
        'start-shootout',
        'end-match',
        'halftime',
        'start-2nd-half',
      ].includes(type);
      return {
        id: String(e.id),
        minute: e.clock?.displayValue || '',
        playerName: playerFromEvent(e),
        eventLabel: mapEventLabel(e),
        description: e.text || e.shortText || '',
        teamLogo: isHome ? homeLogo : awayLogo,
        teamName: toZhName(e.team?.displayName || ''),
        isGoal: Boolean(e.scoringPlay || type.includes('scored') || type === 'goal'),
        isHome,
        isPeriodMarker,
        sortValue: e.clock?.value ?? 0,
      };
    })
    .filter((e) => e.isPeriodMarker || e.playerName || e.description || e.isGoal)
    .sort((a, b) => b.sortValue - a.sortValue)
    .map(({ sortValue, ...rest }) => rest);
}

function pickHighlight(events) {
  if (!events.length) return null;
  const pick =
    events.find((e) => e.isGoal) ||
    events.find((e) => e.eventLabel === '黄牌' || e.eventLabel === '红牌') ||
    events[0];
  return {
    prefix: `最新 · ${pick.eventLabel}`,
    text: [pick.teamName, pick.playerName, pick.minute].filter(Boolean).join(' ').trim(),
  };
}

function resolveAthleteAvatar(athlete) {
  const headshot = athlete.headshot?.href;
  if (headshot && /espncdn\.com/i.test(headshot)) return headshot;
  const jersey =
    athlete.jerseyImages?.find((j) => j.rel?.includes('default'))?.href ||
    athlete.jerseyImages?.[0]?.href ||
    '';
  if (jersey) return jersey;
  const id = athlete.id;
  if (id) return `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`;
  return '';
}

function mapRosterPlayer(row) {
  const athlete = row.athlete || {};
  const pos = row.position?.abbreviation || row.position?.displayName || '';
  const jersey = row.jersey ? String(row.jersey) : '';
  return {
    id: athlete.id ? `espn_player_${athlete.id}` : '',
    athleteId: athlete.id || '',
    name: athlete.displayName || athlete.fullName || '',
    shortName: athlete.shortName || '',
    avatar: resolveAthleteAvatar(athlete),
    position: toZhPosition(pos),
    number: jersey ? `${jersey}号` : '',
    jersey,
    starter: Boolean(row.starter),
    formationPlace: Number(row.formationPlace) || 0,
    subbedIn: Boolean(row.subbedIn),
    subbedOut: Boolean(row.subbedOut),
  };
}

function mapLineups(rosters) {
  return (rosters || []).map((side) => ({
    homeAway: side.homeAway,
    teamName: toZhName(side.team?.displayName || ''),
    teamAbbr: side.team?.abbreviation || '',
    teamLogo: teamLogo(side.team),
    formation: side.formation || '',
    starters: (side.roster || []).filter((r) => r.starter).map(mapRosterPlayer),
    subs: (side.roster || []).filter((r) => !r.starter).map(mapRosterPlayer),
  }));
}

function parseGroupMeta(comp, homeComp, awayComp) {
  const groupAbbr = homeComp?.groups?.abbreviation || awayComp?.groups?.abbreviation || '';
  const altNote = comp.altGameNote || '';
  let groupText = '';
  if (groupAbbr) {
    const letter = groupAbbr.replace(/^Group\s*/i, '').trim();
    groupText = letter ? `${letter} 组` : groupAbbr;
  }
  let stageText = /group/i.test(altNote) || groupAbbr ? '小组赛' : '';
  if (!stageText && altNote.includes(',')) {
    stageText = altNote.split(',').slice(-1)[0]?.trim() || '';
  }
  return { groupText, stageText, competitionNote: altNote };
}

function mapPenaltyShootout(shootout, homeTeamId, homeLogo, awayLogo, homeName, awayName) {
  if (!Array.isArray(shootout) || !shootout.length) return undefined;
  return shootout.map((side) => {
    const isHome = String(side.id) === String(homeTeamId);
    return {
      teamName: isHome ? homeName : awayName,
      teamLogo: isHome ? homeLogo : awayLogo,
      isHome,
      shots: (side.shots || []).map((s) => ({
        player: s.player || '',
        didScore: Boolean(s.didScore),
        shotNumber: Number(s.shotNumber) || 0,
      })),
    };
  });
}

function mapSummaryToMatch(summary, leagueKey) {
  const header = summary.header;
  const comp = header.competitions?.[0];
  if (!comp) return null;

  const eventLike = {
    id: header.id,
    date: comp.date || header.date,
    competitions: [comp],
  };
  const match = mapEventToMatch(eventLike, leagueKey, getLeagueSlug(leagueKey));
  if (!match) return null;

  const homeComp = comp.competitors?.find((c) => c.homeAway === 'home');
  const awayComp = comp.competitors?.find((c) => c.homeAway === 'away');
  const venue = summary.gameInfo?.venue || comp.venue;
  const broadcasts = formatBroadcasts(
    comp.broadcasts?.length ? comp.broadcasts : summary.broadcasts
  );
  const referee = summary.gameInfo?.officials?.[0]?.displayName || '';
  const { groupText, stageText, competitionNote } = parseGroupMeta(comp, homeComp, awayComp);

  match.homeAbbr = homeComp?.team?.abbreviation || match.homeAbbr;
  match.awayAbbr = awayComp?.team?.abbreviation || match.awayAbbr;
  match.venue = venue?.fullName || match.venue;
  match.venueDetail = formatVenueDetail(venue);
  match.referee = referee;
  match.broadcast = broadcasts;
  match.groupText = groupText;
  match.stageText = stageText;
  match.competitionNote = competitionNote;
  const statusDetail = comp.status?.type?.shortDetail || comp.status?.type?.detail || '';
  match.statusBadge = buildStatusBadge(comp, match.status, statusDetail) || match.statusBadge || '';
  const scoreBreakdown = parseScoreBreakdown(homeComp, awayComp);
  const periodFlags = inferPeriodFlags(match.status, statusDetail, scoreBreakdown);
  if (scoreBreakdown) match.scoreBreakdown = scoreBreakdown;
  match.wentToExtraTime = periodFlags.wentToExtraTime;
  match.decidedByPenalties = periodFlags.decidedByPenalties;
  match.periodLabel = periodFlags.periodLabel;

  const stats = extractStats(summary, comp);
  if (stats) match.stats = stats;

  const events = mapKeyEvents(
    summary.keyEvents,
    homeComp?.team?.id,
    match.homeTeamLogo,
    match.awayTeamLogo
  );
  match.events = events;
  match.highlight = pickHighlight(events);
  match.lineups = mapLineups(summary.rosters);
  match.penaltyShootout = mapPenaltyShootout(
    summary.shootout,
    homeComp?.team?.id,
    match.homeTeamLogo,
    match.awayTeamLogo,
    match.homeTeamName,
    match.awayTeamName
  );

  return match;
}

function getLeagueSlug(leagueKey) {
  const { getLeagueByKey } = require('./leagueCodes');
  return getLeagueByKey(leagueKey)?.slug || '';
}

function extractStats(summary, comp) {
  const boxTeams = summary.boxscore?.teams || [];
  if (boxTeams.length < 2) return null;

  const homeComp = comp.competitors?.find((c) => c.homeAway === 'home');
  const awayComp = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!homeComp || !awayComp) return null;

  const homeBox = boxTeams.find((t) => String(t.team?.id) === String(homeComp.team?.id));
  const awayBox = boxTeams.find((t) => String(t.team?.id) === String(awayComp.team?.id));
  if (!homeBox || !awayBox) return null;

  const hs = homeBox.statistics || [];
  const as = awayBox.statistics || [];

  return {
    possession: { home: statValue(hs, 'possessionPct'), away: statValue(as, 'possessionPct') },
    shots: { home: statValue(hs, 'totalShots'), away: statValue(as, 'totalShots') },
    shotsOnTarget: {
      home: statValue(hs, 'shotsOnTarget'),
      away: statValue(as, 'shotsOnTarget'),
    },
    corners: { home: statValue(hs, 'wonCorners'), away: statValue(as, 'wonCorners') },
    yellowCards: { home: statValue(hs, 'yellowCards'), away: statValue(as, 'yellowCards') },
    redCards: { home: statValue(hs, 'redCards'), away: statValue(as, 'redCards') },
  };
}

function statSummary(stats, name) {
  const item = stats?.find((s) => s.name === name);
  return item?.summary || item?.displayValue || '';
}

function mapStandingRow(row, leagueKey) {
  const { entry, rank } = row;
  const team = entry.team;
  const stats = entry.stats || [];

  return {
    _id: `standing_${leagueKey}_${team.id}`,
    league: leagueKey,
    teamId: `espn_team_${team.id}`,
    teamName: toZhName(team.shortDisplayName || team.displayName || team.name),
    teamLogo: teamLogo(team),
    rank,
    played: statValue(stats, 'gamesPlayed'),
    win: statValue(stats, 'wins'),
    draw: statValue(stats, 'ties'),
    lose: statValue(stats, 'losses'),
    gf: statValue(stats, 'pointsFor'),
    ga: statValue(stats, 'pointsAgainst'),
    gd: statValue(stats, 'pointDifferential'),
    points: statValue(stats, 'points'),
    groupName: row.groupName || '',
  };
}

function mapScorerRow(row, index) {
  return {
    rank: index + 1,
    name: row.name || '',
    team: toZhName(row.team || ''),
    goals: row.goals ?? 0,
  };
}

function mapAssistRow(row, index) {
  return {
    rank: index + 1,
    name: row.name || '',
    team: toZhName(row.team || ''),
    assists: row.assists ?? 0,
  };
}

function mapTeam(raw, leagueKey) {
  return {
    _id: `espn_team_${raw.id}`,
    name: resolveTeamDisplayName(raw),
    logo: teamLogo(raw),
    country: toZhCountry(raw.location || ''),
    league: leagueKey,
  };
}

function sortMatches(list) {
  const order = { LIVE: 0, ET: 0, PEN: 0, HT: 1, NS: 2, FT: 3, AET: 3, POSTPONED: 4 };
  return [...list].sort((a, b) => {
    const sa = order[a.status] ?? 9;
    const sb = order[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return new Date(a.matchTime).getTime() - new Date(b.matchTime).getTime();
  });
}

function inchesToCm(inches) {
  const n = Number(inches);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n * 2.54)} cm` : '';
}

function lbsToKg(lbs) {
  const n = Number(lbs);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n * 0.453592)} kg` : '';
}

function mapAthleteDetail(raw, leagueKey) {
  if (!raw?.id) return null;
  const pos = raw.position?.abbreviation || raw.position?.displayName || raw.position?.name || '';
  return {
    _id: `espn_player_${raw.id}`,
    athleteId: String(raw.id),
    name: raw.displayName || raw.fullName || '',
    shortName: raw.shortName || '',
    avatar: raw.headshot?.href || raw.flag?.href || '',
    jerseyImage: raw.jerseyImages?.[0]?.href || '',
    teamName: '',
    teamLogo: raw.flag?.href || '',
    position: toZhPosition(pos),
    number: raw.jersey ? `${raw.jersey}号` : '',
    age: raw.age ?? null,
    height: raw.height ? inchesToCm(raw.height) : raw.displayHeight || '',
    weight: raw.weight ? lbsToKg(raw.weight) : raw.displayWeight || '',
    nationality: toZhCountry(raw.citizenship || ''),
    birthDate: raw.dateOfBirth ? raw.dateOfBirth.slice(0, 10) : '',
    league: leagueKey,
  };
}

module.exports = {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapScorerRow,
  mapAssistRow,
  mapTeam,
  mapAthleteDetail,
  sortMatches,
};
