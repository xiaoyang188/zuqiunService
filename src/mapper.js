const { getLeagueLabel } = require('./leagueCodes');
const { registerEvent } = require('./espnClient');

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

  const status = mapEspnStatus(comp.status);
  return {
    _id: `espn_match_${event.id}`,
    league: leagueKey,
    leagueName: getLeagueLabel(leagueKey),
    homeTeam: `espn_team_${home.team.id}`,
    awayTeam: `espn_team_${away.team.id}`,
    homeTeamName: home.team.shortDisplayName || home.team.displayName || home.team.name,
    awayTeamName: away.team.shortDisplayName || away.team.displayName || away.team.name,
    homeTeamLogo: teamLogo(home.team),
    awayTeamLogo: teamLogo(away.team),
    homeScore: Number(home.score) || 0,
    awayScore: Number(away.score) || 0,
    status,
    matchTime: comp.startDate || event.date,
    minute: status === 'LIVE' || status === 'HT' ? parseMinute(comp.status?.displayClock) : null,
    venue: comp.venue?.fullName || '',
    stats: null,
  };
}

function mapScheduleItem({ event, leagueKey, leagueSlug }) {
  return mapEventToMatch(event, leagueKey, leagueSlug);
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

  const stats = extractStats(summary, comp);
  if (stats) match.stats = stats;
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

function mapStandingRow(row, leagueKey) {
  const { entry, rank } = row;
  const team = entry.team;
  const stats = entry.stats || [];

  return {
    _id: `standing_${leagueKey}_${team.id}`,
    league: leagueKey,
    teamId: `espn_team_${team.id}`,
    teamName: team.shortDisplayName || team.displayName || team.name,
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
  };
}

function mapScorerRow(row, index) {
  return {
    rank: index + 1,
    name: row.name || '',
    team: row.team || '',
    goals: row.goals ?? 0,
  };
}

function mapTeam(raw, leagueKey) {
  return {
    _id: `espn_team_${raw.id}`,
    name: raw.shortDisplayName || raw.displayName || raw.name,
    logo: teamLogo(raw),
    country: raw.location || '',
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

module.exports = {
  mapScheduleItem,
  mapSummaryToMatch,
  mapStandingRow,
  mapScorerRow,
  mapTeam,
  sortMatches,
};
