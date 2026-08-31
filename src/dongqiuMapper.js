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

function formatMarketValue(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return raw ? String(raw) : '';
  if (n >= 10000) return `${Math.round(n / 10000)}万欧元`;
  if (n >= 100) return `${(n / 100).toFixed(1)}万欧元`;
  return `${n}欧元`;
}

function pickBaseInfoExtra(raw, type) {
  const rows = raw?.base_info_v_1 || [];
  const hit = rows.find((r) => r.type === type);
  return hit?.value || '';
}

function mapCareerRows(list, limit = 12) {
  return (list || []).slice(0, limit).map((c) => ({
    teamId: c.team_id ? String(c.team_id) : '',
    teamName: c.team_name || '',
    teamLogo: c.team_logo || '',
    start: c.start_date || '',
    end: c.end_date || '至今',
    apps: num(c.appearance),
    goals: num(c.goals),
    assists: num(c.assist),
  }));
}

/**
 * 懂球帝未开放能力数值 API：用生涯数据 + 位置 + 风格标签估算六维雷达（供 UI 展示）。
 */
function deriveAbility(raw, positionLabel) {
  const career = [...(raw?.player_career_info || []), ...(raw?.player_nation_career_info || [])];
  let apps = 0;
  let goals = 0;
  let assists = 0;
  career.forEach((c) => {
    apps += num(c.appearance);
    goals += num(c.goals);
    assists += num(c.assist);
  });
  const gpg = apps > 0 ? goals / apps : 0;
  const apg = apps > 0 ? assists / apps : 0;
  const pos = String(positionLabel || '');

  let shooting = 52;
  let passing = 52;
  let dribbling = 52;
  let defense = 48;
  let speed = 58;
  let power = 55;

  if (/前锋|攻击|attacker/i.test(pos)) {
    shooting += 12;
    dribbling += 8;
    speed += 8;
    defense -= 8;
  } else if (/中场|mid/i.test(pos)) {
    passing += 12;
    dribbling += 6;
    defense += 4;
  } else if (/后卫|defender/i.test(pos)) {
    defense += 16;
    power += 8;
    shooting -= 6;
  } else if (/门将|goal/i.test(pos)) {
    defense += 18;
    power += 6;
    shooting = 35;
    dribbling = 40;
  }

  shooting = Math.round(shooting + Math.min(gpg * 55, 22));
  passing = Math.round(passing + Math.min(apg * 70, 18));
  dribbling = Math.round(dribbling + Math.min((gpg + apg) * 25, 12));
  power = Math.round(power + Math.min(apps / 80, 8));
  speed = Math.round(speed + Math.min(gpg * 20, 10));

  const strong = [
    ...(raw?.character_info?.strength?.very_strong || []),
    ...(raw?.character_info?.strength?.strong || []),
    ...(raw?.character_info?.styles || []),
  ];
  const weak = [
    ...(raw?.character_info?.weakness?.very_weak || []),
    ...(raw?.character_info?.weakness?.weak || []),
  ];
  const bump = (list, amount, map) => {
    list.forEach((label) => {
      const key = map(String(label));
      if (!key) return;
      if (key === 'shooting') shooting += amount;
      if (key === 'passing') passing += amount;
      if (key === 'dribbling') dribbling += amount;
      if (key === 'defense') defense += amount;
      if (key === 'speed') speed += amount;
      if (key === 'power') power += amount;
    });
  };
  const tagMap = (label) => {
    if (/终结|射门|远射|头球|点球/.test(label)) return 'shooting';
    if (/传球|传中|长传|短传|任意球/.test(label)) return 'passing';
    if (/盘带|控球|内切|过人/.test(label)) return 'dribbling';
    if (/抢断|防守|盯人|铲球|拦截/.test(label)) return 'defense';
    if (/速度|加速|反击/.test(label)) return 'speed';
    if (/力量|强壮|弹跳|耐力/.test(label)) return 'power';
    return '';
  };
  bump(strong, 5, tagMap);
  bump(weak, -5, tagMap);

  const clamp = (v) => Math.max(28, Math.min(92, Math.round(v)));
  const radar = [
    { key: 'speed', label: '速度', value: clamp(speed) },
    { key: 'power', label: '力量', value: clamp(power) },
    { key: 'defense', label: '防守', value: clamp(defense) },
    { key: 'dribbling', label: '盘带', value: clamp(dribbling) },
    { key: 'passing', label: '传球', value: clamp(passing) },
    { key: 'shooting', label: '射门', value: clamp(shooting) },
  ];
  const overall = Math.round(radar.reduce((s, d) => s + d.value, 0) / radar.length);
  return { overall, radar, estimated: true };
}

function mapTraits(raw) {
  const v1 = raw?.character_info_v1?.categories || [];
  if (v1.length) {
    return v1.map((cat) => ({
      title: cat.title || '',
      items: (cat.datas || []).slice(0, 8).map((d) => ({
        title: d.title || '',
        level: d.level || '',
        color: d.color || '',
      })),
    }));
  }
  const info = raw?.character_info;
  if (!info) return [];
  return [
    { title: '风格', items: (info.styles || []).map((t) => ({ title: t, level: '风格', color: '' })) },
    {
      title: '强项',
      items: [...(info.strength?.very_strong || []), ...(info.strength?.strong || [])].map((t) => ({
        title: t,
        level: '强项',
        color: '#7FD002',
      })),
    },
    {
      title: '弱项',
      items: [...(info.weakness?.very_weak || []), ...(info.weakness?.weak || [])].map((t) => ({
        title: t,
        level: '弱项',
        color: '#E7B900',
      })),
    },
  ].filter((c) => c.items.length);
}

function mapPersonDetail(raw, leagueKey = 'Chinese Super League') {
  const info = raw?.base_info;
  if (!info?.person_id) return null;
  const team = info.team_info || {};
  const height = info.height ? `${info.height} cm` : '';
  const weight = info.weight ? `${info.weight} kg` : '';
  const position = mapPosition(team.type || info.position);
  const career = mapCareerRows(raw.player_career_info, 12);
  const nationCareer = mapCareerRows(raw.player_nation_career_info, 6);
  const ability = deriveAbility(raw, position);
  const marketRaw = info.market_value || '';
  const marketLabel = formatMarketValue(marketRaw) || pickBaseInfoExtra(raw, '身价') || '';

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
    position,
    number: team.shirtnumber ? `${team.shirtnumber}号` : '',
    age: info.age ? num(info.age) : null,
    height,
    weight,
    nationality: toZhCountry(info.nationality) || info.nationality || '',
    nationalityLogo: info.nationality_logo || '',
    birthDate: info.date_of_birth || '',
    birthPlace: pickBaseInfoExtra(raw, '出生地') || '',
    league: leagueKey,
    leagueLabel: '中超',
    source: 'dongqiu',
    foot: info.foot || '',
    marketValue: marketLabel || String(marketRaw || ''),
    contract: info.contract || pickBaseInfoExtra(raw, '合同到期') || '',
    transfers: (raw.transfer_info || []).slice(0, 10).map((t) => ({
      type: t.type || '',
      date: t.announced_date || '',
      from: t.from_club_name || '',
      to: t.to_club_name || '',
      fee: t.money || '',
    })),
    career,
    nationCareer,
    careerStats: career.map((c) => ({
      season: `${c.start} - ${c.end}`,
      team: c.teamName,
      teamLogo: c.teamLogo,
      apps: c.apps,
      goals: c.goals,
      assists: c.assists,
    })),
    honors: (raw.honor_info || []).slice(0, 8).map((h) => ({
      name: h.name || '',
      times: String(h.times || ''),
      logo: h.logo || '',
    })),
    traits: mapTraits(raw),
    ability,
    overall: ability.overall,
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
