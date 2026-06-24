const { getLeagueLabel } = require('./leagueCodes');
const { registerEvent } = require('./espnClient');
const { toZhName, toZhCountry, resolveTeamDisplayName, toZhPosition } = require('./zhNames');

const ESPN_STATUS_MAP = {
  pre: 'NS',
  post: 'FT',
};

function mapEspnStatus(status) {
  const state = status?.type?.state;
  const name = status?.type?.name || '';
  if (state === 'pre') return 'NS';
  if (state === 'post') return 'FT';
  if (state === 'in') {
    if (/half/i.test(name) || name === 'STATUS_HALFTIME') return 'HT';
    return 'LIVE';
  }
  return ESPN_STATUS_MAP[state] || 'NS';
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
  const status = mapEspnStatus(comp.status);
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
    matchTime: comp.startDate || event.date,
    minute: status === 'LIVE' || status === 'HT' ? parseMinute(displayClock) : null,
    statusBadge: displayClock || (status === 'HT' ? 'HT' : status === 'FT' ? 'FT' : ''),
    venue: comp.venue?.fullName || '',
    stats: null,
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
  'penalty---scored': '进球',
  substitution: '换人',
  foul: '犯规',
  offside: '越位',
  'throw-in': '界外球',
  'take-on': '带球',
  interception: '拦截',
  'shot-off-target': '射偏',
  out: '换下',
  'var---referee-decision-cancelled': 'VAR',
};

function mapEventLabel(item) {
  const type = item.type?.type || '';
  if (EVENT_TYPE_LABELS[type]) return EVENT_TYPE_LABELS[type];
  if (item.scoringPlay) return '进球';
  const text = item.type?.text || '';
  if (/yellow/i.test(text)) return '黄牌';
  if (/red/i.test(text)) return '红牌';
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
  const SKIP_TYPES = new Set(['kickoff', 'end-regular-time', 'start-period', 'end-period']);
  return (keyEvents || [])
    .filter((e) => !SKIP_TYPES.has(e.type?.type || ''))
    .filter((e) => e.clock?.displayValue || e.text || e.shortText)
    .map((e) => {
      const isHome = String(e.team?.id) === String(homeTeamId);
      const type = e.type?.type || '';
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
        sortValue: e.clock?.value ?? 0,
      };
    })
    .filter((e) => e.playerName || e.description || e.isGoal)
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

function mapRosterPlayer(row) {
  const athlete = row.athlete || {};
  const pos = row.position?.abbreviation || row.position?.displayName || '';
  return {
    id: athlete.id ? `espn_player_${athlete.id}` : '',
    athleteId: athlete.id || '',
    name: athlete.displayName || athlete.fullName || '',
    shortName: athlete.shortName || '',
    avatar: athlete.jerseyImages?.[0]?.href || athlete.headshot?.href || '',
    position: toZhPosition(pos),
    number: row.jersey ? `${row.jersey}号` : '',
    starter: Boolean(row.starter),
  };
}

function mapLineups(rosters) {
  return (rosters || []).map((side) => ({
    homeAway: side.homeAway,
    teamName: toZhName(side.team?.displayName || ''),
    teamAbbr: side.team?.abbreviation || '',
    teamLogo: teamLogo(side.team),
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
  match.statusBadge =
    comp.status?.displayClock ||
    comp.status?.type?.shortDetail ||
    comp.status?.type?.detail ||
    match.statusBadge ||
    '';

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

const QUAL_NOTE_ZH = {
  'Champions League': '欧冠区',
  'Champions League Qualification': '欧冠资格',
  'Europa League': '欧联区',
  'Conference League': '欧协联区',
  'Relegation': '降级区',
  'Advance to Round of 32': '晋级32强',
  'Advance to Round of 16': '晋级16强',
  'Advance to Knockout Stage': '晋级淘汰赛',
};

function translateQualNote(desc) {
  if (!desc) return '';
  return QUAL_NOTE_ZH[desc] || desc;
}

function mapStandingRow(row, leagueKey) {
  const { entry, rank } = row;
  const team = entry.team;
  const stats = entry.stats || [];
  const note = entry.note || {};

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
    qualNote: translateQualNote(note.description || ''),
    qualColor: note.color || '',
    rankChange: statValue(stats, 'rankChange'),
    overallRecord: statSummary(stats, 'overall'),
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
  const order = { LIVE: 0, HT: 1, NS: 2, FT: 3, POSTPONED: 4 };
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
