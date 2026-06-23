/** football-data.org v4 联赛代码 @see miniprogram/utils/leagueCodes.ts */

const APP_LEAGUES = {
  'Premier League': { id: 2021, code: 'PL', label: '英超', country: 'England' },
  'La Liga': { id: 2014, code: 'PD', label: '西甲', country: 'Spain' },
  Bundesliga: { id: 2002, code: 'BL1', label: '德甲', country: 'Germany' },
  'Serie A': { id: 2019, code: 'SA', label: '意甲', country: 'Italy' },
  'Ligue 1': { id: 2015, code: 'FL1', label: '法甲', country: 'France' },
  'Champions League': { id: 2001, code: 'CL', label: '欧冠', country: 'Europe' },
  'World Cup': { id: 2000, code: 'WC', label: '世界杯', country: 'World' },
  Euro: { id: 2018, code: 'EC', label: '欧洲杯', country: 'Europe' },
};

const CODE_TO_KEY = Object.fromEntries(
  Object.entries(APP_LEAGUES).map(([key, meta]) => [meta.code, key])
);

const FILTER_CODES = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'WC', 'EC'];

/** 首页热门赛事 Tab 顺序 */
const HOT_LEAGUE_KEYS = ['World Cup', 'Euro', 'Premier League', 'La Liga', 'Champions League'];

function buildHotLeagues() {
  return HOT_LEAGUE_KEYS.map((key) => ({
    key,
    label: getLeagueLabel(key),
    code: APP_LEAGUES[key]?.code || '',
  }));
}

function getLeagueLabel(key) {
  return APP_LEAGUES[key]?.label || key;
}

function getLeagueKeyByCode(code) {
  return CODE_TO_KEY[code] || null;
}

function getLeagueByKey(key) {
  return APP_LEAGUES[key] || null;
}

module.exports = {
  APP_LEAGUES,
  FILTER_CODES,
  HOT_LEAGUE_KEYS,
  buildHotLeagues,
  getLeagueLabel,
  getLeagueKeyByCode,
  getLeagueByKey,
};
