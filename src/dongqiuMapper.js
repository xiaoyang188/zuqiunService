/**
 * 懂球帝原始数据 → 小程序 / 仓储统一结构
 */

const { toZhName, toZhCountry, toZhPosition } = require('./zhNames');

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapDongqiuStatus(status, minute) {
  const s = String(status || '').toLowerCase();
  if (s === 'played' || s === 'finished' || s === 'ft') return 'FT';
  if (s === 'playing' || s === 'live' || s === '1h' || s === '2h') {
    if (String(minute) === 'HT' || s === 'ht') return 'HT';
    return 'LIVE';
  }
  if (s === 'fixture' || s === 'unplayed' || s === 'notstarted' || s === 'ns') return 'NS';
  if (s === 'postponed') return 'POSTPONED';
  if (s === 'cancelled' || s === 'canceled') return 'POSTPONED';
  return 'NS';
}

function toIsoFromDongqiu(startPlay, dateUtc, timeUtc) {
  // start_play: "2026-08-01 11:00:00" 视为北京时间
  const raw = startPlay || `${dateUtc || ''} ${timeUtc || ''}`.trim();
  if (!raw) return '';
  const normalized = raw.replace(' ', 'T');
  // 无时区时按 UTC+8
  const d = new Date(/Z|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}+08:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function mapMatchFromTab(raw, leagueKey = 'Chinese Super League') {
  if (!raw?.match_id) return null;
  const status = mapDongqiuStatus(raw.status, raw.minute_period || raw.minute);
  const homeScore = raw.fs_A !== '' && raw.fs_A != null ? num(raw.fs_A) : null;
  const awayScore = raw.fs_B !== '' && raw.fs_B != null ? num(raw.fs_B) : null;
  return {
    _id: `dq_${raw.match_id}`,
    league: leagueKey,
    leagueName: raw.competition_name || '中超',
    homeTeam: String(raw.team_A_id || ''),
    awayTeam: String(raw.team_B_id || ''),
    homeTeamName: toZhName(raw.team_A_name) || raw.team_A_name || '',
    awayTeamName: toZhName(raw.team_B_name) || raw.team_B_name || '',
    homeLogo: raw.team_A_logo || '',
    awayLogo: raw.team_B_logo || '',
    homeScore: homeScore ?? 0,
    awayScore: awayScore ?? 0,
    status,
    matchTime: toIsoFromDongqiu(raw.start_play, raw.date_utc, raw.time_utc),
    minute: status === 'LIVE' ? (raw.minute ? `${raw.minute}'` : '') : '',
    periodLabel: raw.minute_period || raw.match_title || '',
    venue: '',
    source: 'dongqiu',
  };
}

function mapMatchFromSchedule(raw, leagueKey = 'Chinese Super League') {
  if (!raw?.match_id) return null;
  return mapMatchFromTab(
    {
      ...raw,
      competition_name: '中超',
      minute_period: raw.status === 'Played' ? 'FT' : raw.minute || '',
    },
    leagueKey
  );
}

function mapStandingRow(row, leagueKey = 'Chinese Super League', index = 0) {
  const teamId = String(row.team_id || '');
  const rank = num(row.rank, index + 1);
  const gf = num(row.goals_pro);
  const ga = num(row.goals_against);
  return {
    _id: `standing_${leagueKey}_dq_${teamId}`,
    league: leagueKey,
    teamId: `dq_team_${teamId}`,
    teamName: toZhName(row.team_name) || row.team_name || '',
    teamLogo: row.team_logo || '',
    rank,
    played: num(row.matches_total),
    win: num(row.matches_won),
    draw: num(row.matches_draw),
    lose: num(row.matches_lost),
    gf,
    ga,
    gd: gf - ga,
    points: num(row.points),
    groupName: '',
    source: 'dongqiu',
  };
}

function mapTeamFromStanding(row, leagueKey = 'Chinese Super League') {
  return {
    _id: `dq_team_${row.team_id}`,
    name: toZhName(row.team_name) || row.team_name || '',
    logo: row.team_logo || '',
    country: '中国',
    league: leagueKey,
    source: 'dongqiu',
  };
}

function mapPosition(pos) {
  const raw = String(pos || '');
  const map = {
    forward: '前锋',
    midfielder: '中场',
    defender: '后卫',
    goalkeeper: '守门员',
    F: '前锋',
    M: '中场',
    D: '后卫',
    G: '守门员',
    前锋: '前锋',
    中场: '中场',
    后卫: '后卫',
    守门员: '守门员',
  };
  return map[raw] || map[raw.toLowerCase()] || toZhPosition(raw) || raw;
}

function mapPersonDetail(raw, leagueKey = 'Chinese Super League') {
  const info = raw?.base_info;
  if (!info?.person_id) return null;
  const team = info.team_info || {};
  const height = info.height ? `${info.height} cm` : '';
  const weight = info.weight ? `${info.weight} kg` : '';
  return {
    _id: `dq_player_${info.person_id}`,
    athleteId: String(info.person_id),
    name: info.person_name || info.person_en_name || '',
    shortName: info.person_en_name || info.nickname || '',
    avatar: info.person_logo || '',
    jerseyImage: '',
    teamName: toZhName(team.team_name) || team.team_name || '',
    teamId: team.team_id ? String(team.team_id) : '',
    teamLogo: team.team_img || '',
    position: mapPosition(team.type || info.position),
    number: team.shirtnumber ? `${team.shirtnumber}号` : '',
    age: info.age ? num(info.age) : null,
    height,
    weight,
    nationality: toZhCountry(info.nationality) || info.nationality || '',
    birthDate: info.date_of_birth || '',
    league: leagueKey,
    source: 'dongqiu',
    foot: info.foot || '',
    marketValue: info.market_value || '',
    transfers: (raw.transfer_info || []).slice(0, 8).map((t) => ({
      type: t.type || '',
      date: t.announced_date || '',
      from: t.from_club_name || '',
      to: t.to_club_name || '',
      fee: t.money || '',
    })),
    career: (raw.player_career_info || []).slice(0, 12).map((c) => ({
      teamId: c.team_id ? String(c.team_id) : '',
      teamName: c.team_name || '',
      teamLogo: c.team_logo || '',
      start: c.start_date || '',
      end: c.end_date || '',
    })),
  };
}

function mapTeamDetail(raw, extras = {}) {
  const info = raw?.base_info;
  if (!info?.team_id) return null;
  const leagueKey = extras.leagueKey || 'Chinese Super League';
  const record = extras.record || null;
  const roster = extras.roster || [];
  const recentMatches = extras.recentMatches || [];

  return {
    _id: `dq_team_${info.team_id}`,
    teamId: String(info.team_id),
    name: toZhName(info.team_name) || info.team_name || '',
    shortName: info.team_en_name || info.nickname || '',
    logo: info.team_img || '',
    color: info.color ? (info.color.startsWith('#') ? info.color : `#${info.color}`) : '',
    country: toZhCountry(info.country) || info.country || '中国',
    league: leagueKey,
    leagueLabel: '中超',
    venue: info.venue_name
      ? `${info.venue_name}${info.venue_capacity ? ` · ${info.venue_capacity}人` : ''}`
      : '',
    founded: info.founded || '',
    city: info.city || '',
    record,
    roster,
    recentMatches,
    source: 'dongqiu',
    honors: (raw.honor_info || []).slice(0, 6).map((h) => ({
      name: h.name || '',
      times: h.times || '',
      logo: h.logo || '',
    })),
  };
}

function mapTeammatesToRoster(teammatePayload) {
  const groups = teammatePayload?.data?.list || teammatePayload?.list || [];
  const roster = [];
  for (const g of groups) {
    if (g.type === 'coach') continue;
    for (const p of g.data || []) {
      if (!p.person_id) continue;
      roster.push({
        id: String(p.person_id),
        athleteId: String(p.person_id),
        name: p.person_name || '',
        shortName: '',
        number: p.shirtnumber || p.number || '',
        position: mapPosition(p.type || p.position || g.title || ''),
        avatar: p.person_logo || '',
      });
    }
  }
  return roster;
}

function mapScorerRow(row, index) {
  return {
    rank: num(row.rank, index + 1),
    name: row.person_name || '',
    team: toZhName(row.team_name || row.row_1) || row.team_name || row.row_1 || '',
    goals: num(row.goal ?? row.count),
    personId: row.person_id ? String(row.person_id) : '',
    teamId: row.team_id ? String(row.team_id) : '',
    logo: row.person_logo || '',
    source: 'dongqiu',
  };
}

function mapAssistRow(row, index) {
  return {
    rank: num(row.rank, index + 1),
    name: row.person_name || '',
    team: toZhName(row.team_name || row.row_1) || row.team_name || row.row_1 || '',
    assists: num(row.assist ?? row.count ?? row.goal),
    personId: row.person_id ? String(row.person_id) : '',
    teamId: row.team_id ? String(row.team_id) : '',
    logo: row.person_logo || '',
    source: 'dongqiu',
  };
}

function mapSearchResults(raw) {
  return {
    players: (raw.players || []).map((p) => ({
      ...p,
      id: String(p.id || '').replace(/^dq_player_/, ''),
      name: p.name || '',
      leagueLabel: p.leagueLabel || p.subtitle || '',
    })),
    teams: (raw.teams || []).map((t) => ({
      ...t,
      id: String(t.id || '').replace(/^dq_team_/, ''),
      name: t.name || '',
      leagueLabel: t.leagueLabel || t.subtitle || '',
    })),
  };
}

module.exports = {
  mapMatchFromTab,
  mapMatchFromSchedule,
  mapStandingRow,
  mapTeamFromStanding,
  mapPersonDetail,
  mapTeamDetail,
  mapTeammatesToRoster,
  mapScorerRow,
  mapAssistRow,
  mapSearchResults,
  mapDongqiuStatus,
};
