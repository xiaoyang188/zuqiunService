/** ESPN 联赛 slug @see docs/ESPN_API.md */

const APP_LEAGUES = {
  'Premier League': { slug: 'eng.1', label: '英超', country: 'England' },
  'La Liga': { slug: 'esp.1', label: '西甲', country: 'Spain' },
  Bundesliga: { slug: 'ger.1', label: '德甲', country: 'Germany' },
  'Serie A': { slug: 'ita.1', label: '意甲', country: 'Italy' },
  'Ligue 1': { slug: 'fra.1', label: '法甲', country: 'France' },
  'Champions League': { slug: 'uefa.champions', label: '欧冠', country: 'Europe' },
  'World Cup': { slug: 'fifa.world', label: '世界杯', country: 'World' },
  Euro: { slug: 'uefa.euro', label: '欧洲杯', country: 'Europe' },
};

const SLUG_TO_KEY = Object.fromEntries(
  Object.entries(APP_LEAGUES).map(([key, meta]) => [meta.slug, key])
);

/** 首页热门赛事 Tab 顺序 */
const HOT_LEAGUE_KEYS = ['World Cup', 'Euro', 'Premier League', 'La Liga', 'Champions League'];

function buildHotLeagues() {
  return HOT_LEAGUE_KEYS.map((key) => ({
    key,
    label: getLeagueLabel(key),
    code: APP_LEAGUES[key]?.slug || '',
  }));
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
  buildHotLeagues,
  getLeagueLabel,
  getLeagueKeyBySlug,
  getLeagueByKey,
};
