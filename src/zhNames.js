/**
 * 球队 / 国家队 / 国家地区 → 中文名
 * ESPN 英文名在此统一转换，小程序直接展示
 */

/** 国家、地区 */
const COUNTRY_ZH = {
  England: '英格兰',
  Scotland: '苏格兰',
  Wales: '威尔士',
  'Northern Ireland': '北爱尔兰',
  Spain: '西班牙',
  Germany: '德国',
  Italy: '意大利',
  France: '法国',
  Portugal: '葡萄牙',
  Netherlands: '荷兰',
  Belgium: '比利时',
  Croatia: '克罗地亚',
  Switzerland: '瑞士',
  Austria: '奥地利',
  Poland: '波兰',
  Ukraine: '乌克兰',
  Russia: '俄罗斯',
  Serbia: '塞尔维亚',
  Denmark: '丹麦',
  Sweden: '瑞典',
  Norway: '挪威',
  Finland: '芬兰',
  Greece: '希腊',
  Hungary: '匈牙利',
  Czechia: '捷克',
  'Czech Republic': '捷克',
  Slovakia: '斯洛伐克',
  Slovenia: '斯洛文尼亚',
  Romania: '罗马尼亚',
  Bulgaria: '保加利亚',
  Türkiye: '土耳其',
  Turkey: '土耳其',
  Ireland: '爱尔兰',
  'Republic of Ireland': '爱尔兰',
  Argentina: '阿根廷',
  Brazil: '巴西',
  Uruguay: '乌拉圭',
  Colombia: '哥伦比亚',
  Chile: '智利',
  Peru: '秘鲁',
  Ecuador: '厄瓜多尔',
  Paraguay: '巴拉圭',
  Venezuela: '委内瑞拉',
  Bolivia: '玻利维亚',
  Mexico: '墨西哥',
  USA: '美国',
  'United States': '美国',
  Canada: '加拿大',
  'Costa Rica': '哥斯达黎加',
  Panama: '巴拿马',
  Honduras: '洪都拉斯',
  Jamaica: '牙买加',
  Haiti: '海地',
  Japan: '日本',
  'South Korea': '韩国',
  'Korea Republic': '韩国',
  China: '中国',
  Australia: '澳大利亚',
  'New Zealand': '新西兰',
  'Saudi Arabia': '沙特阿拉伯',
  Iran: '伊朗',
  Qatar: '卡塔尔',
  'United Arab Emirates': '阿联酋',
  Iraq: '伊拉克',
  Jordan: '约旦',
  Morocco: '摩洛哥',
  Senegal: '塞内加尔',
  Ghana: '加纳',
  Cameroon: '喀麦隆',
  Tunisia: '突尼斯',
  Algeria: '阿尔及利亚',
  Egypt: '埃及',
  Nigeria: '尼日利亚',
  'Ivory Coast': '科特迪瓦',
  "Côte d'Ivoire": '科特迪瓦',
  'DR Congo': '刚果（金）',
  'Congo DR': '刚果（金）',
  'South Africa': '南非',
  'Cape Verde': '佛得角',
  'Cape Verde Islands': '佛得角',
  Curaçao: '库拉索',
  Curacao: '库拉索',
  'Bosnia and Herzegovina': '波黑',
  'Bosnia-Herzegovina': '波黑',
  'Bosnia-Herz': '波黑',
  Uzbekistan: '乌兹别克斯坦',
  Georgia: '格鲁吉亚',
  World: '国际',
  Europe: '欧洲',
  Asia: '亚洲',
  Africa: '非洲',
  'South America': '南美洲',
  'North America': '北美洲',
};

/** 俱乐部 + 国家队常用 ESPN 显示名 */
const TEAM_ZH = {
  ...COUNTRY_ZH,
  // 英超
  Arsenal: '阿森纳',
  'Manchester United': '曼联',
  'Man United': '曼联',
  'Manchester City': '曼城',
  'Man City': '曼城',
  Liverpool: '利物浦',
  Chelsea: '切尔西',
  Tottenham: '热刺',
  'Tottenham Hotspur': '热刺',
  'Aston Villa': '阿斯顿维拉',
  Newcastle: '纽卡斯尔',
  'Newcastle United': '纽卡斯尔',
  'West Ham': '西汉姆',
  'West Ham United': '西汉姆',
  'Crystal Palace': '水晶宫',
  Brighton: '布莱顿',
  'Brighton & Hove Albion': '布莱顿',
  Bournemouth: '伯恩茅斯',
  Fulham: '富勒姆',
  Wolves: '狼队',
  'Wolverhampton Wanderers': '狼队',
  Everton: '埃弗顿',
  Brentford: '布伦特福德',
  'Nottingham Forest': '诺丁汉森林',
  Nottingham: '诺丁汉森林',
  Luton: '卢顿',
  Burnley: '伯恩利',
  Sheffield: '谢菲联',
  'Sheffield United': '谢菲联',
  Coventry: '考文垂',
  Leicester: '莱斯特城',
  'Leicester City': '莱斯特城',
  Leeds: '利兹联',
  'Leeds United': '利兹联',
  Southampton: '南安普顿',
  // 西甲
  'Real Madrid': '皇马',
  Barcelona: '巴萨',
  Barça: '巴萨',
  Atlético: '马竞',
  'Atlético Madrid': '马竞',
  'Atletico Madrid': '马竞',
  Villarreal: '比利亚雷亚尔',
  'Real Sociedad': '皇家社会',
  'Athletic Club': '毕尔巴鄂',
  'Athletic Bilbao': '毕尔巴鄂',
  Sevilla: '塞维利亚',
  Valencia: '瓦伦西亚',
  Betis: '贝蒂斯',
  'Real Betis': '贝蒂斯',
  // 德甲
  'Bayern Munich': '拜仁',
  'Bayern München': '拜仁',
  Bayern: '拜仁',
  'Borussia Dortmund': '多特蒙德',
  Dortmund: '多特蒙德',
  'RB Leipzig': '莱比锡',
  Leverkusen: '勒沃库森',
  'Bayer Leverkusen': '勒沃库森',
  // 意甲
  Inter: '国际米兰',
  'Inter Milan': '国际米兰',
  Milan: 'AC米兰',
  'AC Milan': 'AC米兰',
  Juventus: '尤文图斯',
  Napoli: '那不勒斯',
  Roma: '罗马',
  Lazio: '拉齐奥',
  Atalanta: '亚特兰大',
  Fiorentina: '佛罗伦萨',
  // 法甲
  'Paris Saint-Germain': '巴黎圣日耳曼',
  PSG: '巴黎圣日耳曼',
  Marseille: '马赛',
  Lyon: '里昂',
  Monaco: '摩纳哥',
  Lille: '里尔',
  // 其他
  Ajax: '阿贾克斯',
  'Benfica': '本菲卡',
  Porto: '波尔图',
  Celtic: '凯尔特人',
  Rangers: '流浪者',
};

const lookup = new Map(
  Object.entries(TEAM_ZH).flatMap(([en, zh]) => [
    [en, zh],
    [en.toLowerCase(), zh],
  ])
);

function toZhName(name) {
  if (!name || typeof name !== 'string') return name || '';
  const trimmed = name.trim();
  return lookup.get(trimmed) || lookup.get(trimmed.toLowerCase()) || trimmed;
}

function toZhCountry(country) {
  return toZhName(country);
}

function formatPlaceholderTeam(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  if (/^3RD\b/i.test(trimmed)) {
    const groups = trimmed.replace(/^3RD\s+/i, '').trim();
    return groups ? `待定（${groups}）` : '待定';
  }
  const groupRank = trimmed.match(/^(\d+)([A-L])$/i);
  if (groupRank) return `${groupRank[2].toUpperCase()}组第${groupRank[1]}`;
  return '';
}

function resolveTeamDisplayName(team) {
  if (!team) return '';
  const raw =
    team.shortDisplayName || team.displayName || team.name || team.abbreviation || '';
  const placeholder = formatPlaceholderTeam(raw);
  if (placeholder) return placeholder;
  return toZhName(raw);
}

function toZhPosition(pos) {
  if (!pos) return '';
  const map = {
    Forward: '前锋',
    Midfielder: '中场',
    Defender: '后卫',
    Goalkeeper: '守门员',
    F: '前锋',
    M: '中场',
    D: '后卫',
    G: '守门员',
  };
  return map[pos] || map[pos.toUpperCase?.()] || pos;
}

module.exports = {
  toZhName,
  toZhCountry,
  resolveTeamDisplayName,
  toZhPosition,
};
