const { toZhName } = require('./zhNames');
const { resolveTeamDisplayName } = require('./zhNames');

const KNOCKOUT_SLUGS = new Set([
  'round-of-32',
  'round-of-16',
  'quarterfinals',
  'semifinals',
  '3rd-place-match',
  'final',
]);

const ROUND_ORDER = [
  'round-of-32',
  'round-of-16',
  'quarterfinals',
  'semifinals',
  '3rd-place-match',
  'final',
];

const ROUND_LABELS = {
  'round-of-32': '1/16 决赛',
  'round-of-16': '1/8 决赛',
  quarterfinals: '1/4 决赛',
  semifinals: '半决赛',
  '3rd-place-match': '季军战',
  final: '决赛',
};

const CUP_LEAGUES = new Set(['World Cup', 'Euro', 'Champions League']);

function pickKnockoutDateRange(leaguesMeta) {
  const league = leaguesMeta?.[0];
  const entries = league?.calendar?.[0]?.entries || [];
  const knockout = entries.filter((e) => e.value && e.value !== '1');
  if (!knockout.length) return null;

  const start = knockout[0].startDate?.slice(0, 10).replace(/-/g, '');
  const end = knockout[knockout.length - 1].endDate?.slice(0, 10).replace(/-/g, '');
  if (!start || !end) return null;
  return `${start}-${end}`;
}

function getRoundSlug(event) {
  const slug = event?.season?.slug || '';
  if (KNOCKOUT_SLUGS.has(slug)) return slug;
  const note = event?.competitions?.[0]?.altGameNote || '';
  const name = event?.name || '';
  if (/round of 32/i.test(note)) return 'round-of-32';
  if (/round of 16/i.test(note)) return 'round-of-16';
  if (/quarterfinal/i.test(note)) return 'quarterfinals';
  if (/semifinal/i.test(note) && /loser/i.test(name)) return '3rd-place-match';
  if (/semifinal/i.test(note) || /semifinal/i.test(name)) return 'semifinals';
  if (/\bfinal\b/i.test(note) || (/\bfinal\b/i.test(name) && !/semifinal/i.test(name))) {
    return 'final';
  }
  return '';
}

function teamLogo(team) {
  return team?.logos?.[0]?.href || team?.logo || '';
}

function mapEspnStatus(status) {
  const state = status?.type?.state;
  const name = status?.type?.name || '';
  if (state === 'pre') return 'NS';
  if (state === 'post') return 'FT';
  if (state === 'in') {
    if (/half/i.test(name) || name === 'STATUS_HALFTIME') return 'HT';
    return 'LIVE';
  }
  return 'NS';
}

function mapBracketMatch(event, leagueKey) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home?.team || !away?.team) return null;

  const status = mapEspnStatus(comp.status);
  return {
    _id: `espn_match_${event.id}`,
    league: leagueKey,
    homeTeamName: toZhName(resolveTeamDisplayName(home.team)),
    awayTeamName: toZhName(resolveTeamDisplayName(away.team)),
    homeTeamLogo: teamLogo(home.team),
    awayTeamLogo: teamLogo(away.team),
    homeScore: Number(home.score) || 0,
    awayScore: Number(away.score) || 0,
    status,
    matchTime: comp.startDate || event.date,
    homeWinner: Boolean(home.winner),
    awayWinner: Boolean(away.winner),
  };
}

function buildBracketRounds(events, leagueKey) {
  const buckets = new Map();
  ROUND_ORDER.forEach((k) => buckets.set(k, []));

  events.forEach((event) => {
    const roundKey = getRoundSlug(event);
    if (!roundKey || !buckets.has(roundKey)) return;
    const match = mapBracketMatch(event, leagueKey);
    if (match) buckets.get(roundKey).push({ ...match, roundKey });
  });

  return ROUND_ORDER.map((key) => ({
    key,
    title: ROUND_LABELS[key] || key,
    matches: (buckets.get(key) || []).sort(
      (a, b) => new Date(a.matchTime).getTime() - new Date(b.matchTime).getTime()
    ),
  })).filter((r) => r.matches.length > 0);
}

module.exports = {
  CUP_LEAGUES,
  pickKnockoutDateRange,
  getRoundSlug,
  buildBracketRounds,
};
