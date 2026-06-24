/** ESPN 联赛 slug @see docs/ESPN_API.md */

const APP_LEAGUES = {
  'Premier League': { slug: 'eng.1', label: '英超', country: '英格兰' },
  'La Liga': { slug: 'esp.1', label: '西甲', country: '西班牙' },
  Bundesliga: { slug: 'ger.1', label: '德甲', country: '德国' },
  'Serie A': { slug: 'ita.1', label: '意甲', country: '意大利' },
  'Ligue 1': { slug: 'fra.1', label: '法甲', country: '法国' },
  'Champions League': { slug: 'uefa.champions', label: '欧冠', country: '欧洲' },
  'World Cup': { slug: 'fifa.world', label: '世界杯', country: '国际' },
  Euro: { slug: 'uefa.euro', label: '欧洲杯', country: '欧洲' },
};

const SLUG_TO_KEY = Object.fromEntries(
  Object.entries(APP_LEAGUES).map(([key, meta]) => [meta.slug, key])
);

/** 首页热门赛事 Tab 顺序 */
const HOT_LEAGUE_KEYS = ['World Cup', 'Euro', 'Premier League', 'La Liga', 'Champions League'];

/** 赛程页横向 Chip 筛选 */
const FILTER_LEAGUE_KEYS = [
  'Premier League',
  'La Liga',
  'Bundesliga',
  'Serie A',
  'Ligue 1',
  'Champions League',
];

/** 积分榜页联赛 */
const STANDINGS_LEAGUE_KEYS = [
  'World Cup',
  'Premier League',
  'La Liga',
  'Bundesliga',
  'Serie A',
  'Ligue 1',
  'Champions League',
  'Euro',
];

function mapLeagueKeys(keys) {
  return keys.map((key) => ({
    key,
    label: getLeagueLabel(key),
    code: APP_LEAGUES[key]?.slug || '',
  }));
}

function buildLeagues(scope = 'hot') {
  switch (scope) {
    case 'filter':
      return mapLeagueKeys(FILTER_LEAGUE_KEYS);
    case 'standings':
      return mapLeagueKeys(STANDINGS_LEAGUE_KEYS);
    case 'all':
      return mapLeagueKeys(Object.keys(APP_LEAGUES));
    case 'hot':
    default:
      return mapLeagueKeys(HOT_LEAGUE_KEYS);
  }
}

function buildHotLeagues() {
  return buildLeagues('hot');
}

function getLeagueLabel(key) {
  return APP_LEAGUES[key]?.label || key;
}

function getLeagueKeyBySlug(slug) {
  return SLUG_TO_KEY[slug] || null;
}

function getLeagueByKey(key) {
  return APP_LEAGUES[key] || null;
}

module.exports = {
  APP_LEAGUES,
  HOT_LEAGUE_KEYS,
  FILTER_LEAGUE_KEYS,
  STANDINGS_LEAGUE_KEYS,
  buildLeagues,
  buildHotLeagues,
  getLeagueLabel,
  getLeagueKeyBySlug,
  getLeagueByKey,
};
