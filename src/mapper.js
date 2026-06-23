const { getLeagueKeyByCode, getLeagueLabel } = require('./leagueCodes');

const STATUS_MAP = {
  SCHEDULED: 'NS',
  TIMED: 'NS',
  IN_PLAY: 'LIVE',
  PAUSED: 'HT',
  EXTRA_TIME: 'LIVE',
  PENALTY_SHOOTOUT: 'LIVE',
  FINISHED: 'FT',
  AWARDED: 'FT',
  SUSPENDED: 'POSTPONED',
  POSTPONED: 'POSTPONED',
  CANCELLED: 'POSTPONED',
};

function pickScore(match) {
  const ft = match.score?.fullTime;
  if (ft && ft.home != null && ft.away != null) {
    return { home: ft.home, away: ft.away };
  }
  return { home: 0, away: 0 };
}

function mapMatch(raw) {
  const leagueKey = getLeagueKeyByCode(raw.competition?.code) || raw.competition?.name || '';
  const { home, away } = pickScore(raw);
  return {
    _id: `fd_match_${raw.id}`,
    league: leagueKey,
    leagueName: getLeagueLabel(leagueKey) || raw.competition?.name || '',
    homeTeam: `fd_team_${raw.homeTeam.id}`,
    awayTeam: `fd_team_${raw.awayTeam.id}`,
    homeTeamName: raw.homeTeam.shortName || raw.homeTeam.name,
    awayTeamName: raw.awayTeam.shortName || raw.awayTeam.name,
    homeTeamLogo: raw.homeTeam.crest || '',
    awayTeamLogo: raw.awayTeam.crest || '',
    homeScore: home,
    awayScore: away,
    status: STATUS_MAP[raw.status] || 'NS',
    matchTime: raw.utcDate,
    minute: raw.minute ?? null,
    venue: raw.venue || '',
    stats: null,
  };
}

function mapStandingRow(row, leagueKey) {
  const team = row.team;
  return {
    _id: `standing_${leagueKey}_${team.id}`,
    league: leagueKey,
    teamId: `fd_team_${team.id}`,
    teamName: team.shortName || team.name,
    teamLogo: team.crest || '',
    rank: row.position,
    played: row.playedGames,
    win: row.won,
    draw: row.draw,
    lose: row.lost,
    gf: row.goalsFor,
    ga: row.goalsAgainst,
    gd: row.goalDifference,
    points: row.points,
  };
}

function mapScorerRow(row, index) {
  const player = row.player || {};
  const team = row.team || {};
  return {
    rank: index + 1,
    name: player.name || '',
    team: team.shortName || team.name || '',
    goals: row.goals ?? 0,
  };
}

function mapTeam(raw, leagueKey) {
  return {
    _id: `fd_team_${raw.id}`,
    name: raw.shortName || raw.name,
    logo: raw.crest || '',
    country: raw.area?.name || '',
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

module.exports = { mapMatch, mapStandingRow, mapScorerRow, mapTeam, sortMatches };
