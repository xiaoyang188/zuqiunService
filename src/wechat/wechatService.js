const crypto = require('crypto');
const { getLeagueLabel } = require('../leagueCodes');

const WX_API = 'https://api.weixin.qq.com';

let accessTokenCache = { token: '', expiresAt: 0 };

function isWechatConfigured() {
  return Boolean(process.env.WECHAT_APPID && process.env.WECHAT_SECRET);
}

function getReminderTemplateId() {
  return (process.env.REMINDER_TEMPLATE_ID || '').trim();
}

async function wxGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${WX_API}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    const err = new Error(data.errmsg || `微信 API 错误 ${data.errcode}`);
    err.errcode = data.errcode;
    throw err;
  }
  return data;
}

async function wxPost(path, body, query = {}) {
  const qs = new URLSearchParams(query).toString();
  const url = `${WX_API}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.errcode && data.errcode !== 0) {
    const err = new Error(data.errmsg || `微信 API 错误 ${data.errcode}`);
    err.errcode = data.errcode;
    throw err;
  }
  return data;
}

async function getAccessToken() {
  if (!isWechatConfigured()) {
    throw new Error('未配置 WECHAT_APPID / WECHAT_SECRET');
  }
  const now = Date.now();
  if (accessTokenCache.token && accessTokenCache.expiresAt > now + 60_000) {
    return accessTokenCache.token;
  }
  const data = await wxGet('/cgi-bin/token', {
    grant_type: 'client_credential',
    appid: process.env.WECHAT_APPID,
    secret: process.env.WECHAT_SECRET,
  });
  accessTokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 7200) * 1000,
  };
  return accessTokenCache.token;
}

async function code2Session(code) {
  if (!isWechatConfigured()) {
    throw new Error('未配置 WECHAT_APPID / WECHAT_SECRET');
  }
  const data = await wxGet('/sns/jscode2session', {
    appid: process.env.WECHAT_APPID,
    secret: process.env.WECHAT_SECRET,
    js_code: code,
    grant_type: 'authorization_code',
  });
  if (!data.openid) {
    throw new Error('微信登录失败：未返回 openid');
  }
  return { openid: data.openid, sessionKey: data.session_key || '' };
}

function truncateThing(text, maxLen = 20) {
  const s = String(text || '').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function formatKickoffTime(matchTime) {
  const d = matchTime instanceof Date ? matchTime : new Date(matchTime);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function advanceLabel(minutes) {
  if (minutes >= 1440) return '24 小时';
  if (minutes >= 60) return '1 小时';
  if (minutes >= 15) return '15 分钟';
  return `${minutes} 分钟`;
}

/**
 * 「比赛开始提醒」模板字段（可在 .env 覆盖）：
 * - REMINDER_TMPL_FIELD_MATCHUP  默认 thing6  比赛对阵
 * - REMINDER_TMPL_FIELD_TIME     默认 thing2  比赛时间
 * - REMINDER_TMPL_FIELD_LEAGUE   默认 thing3  赛事类别
 * - REMINDER_TMPL_FIELD_TIP      默认 thing5  备注
 */
function buildLeagueCategory(payload) {
  const league = getLeagueLabel(payload.league || '');
  const stage = payload.stageText || payload.groupText || '';
  if (stage && stage !== league) {
    return truncateThing(`${league} · ${stage}`);
  }
  return truncateThing(league || '足球赛况');
}

function buildReminderTemplateData(match, advanceMinutes) {
  const matchupField = process.env.REMINDER_TMPL_FIELD_MATCHUP || 'thing6';
  const timeField = process.env.REMINDER_TMPL_FIELD_TIME || 'thing2';
  const leagueField = process.env.REMINDER_TMPL_FIELD_LEAGUE || 'thing3';
  const tipField = process.env.REMINDER_TMPL_FIELD_TIP || 'thing5';

  const payload = match.payload || match;
  const vs = `${payload.homeTeamName || '主队'} VS ${payload.awayTeamName || '客队'}`;
  const kickoff = formatKickoffTime(match.match_time || payload.matchTime);
  const category = buildLeagueCategory(payload);
  const tip = `距离开球还有${advanceLabel(advanceMinutes)}，点击查看赛况`;

  return {
    [matchupField]: { value: truncateThing(vs) },
    [timeField]: { value: truncateThing(kickoff) },
    [leagueField]: { value: category },
    [tipField]: { value: truncateThing(tip) },
  };
}

async function sendSubscribeMessage({ openid, templateId, page, data }) {
  const accessToken = await getAccessToken();
  return wxPost(
    '/cgi-bin/message/subscribe/send',
    {
      touser: openid,
      template_id: templateId,
      page,
      miniprogram_state: process.env.WECHAT_MINIPROGRAM_STATE || 'formal',
      lang: 'zh_CN',
      data,
    },
    { access_token: accessToken }
  );
}

async function sendMatchReminder(openid, matchRow, advanceMinutes) {
  const templateId = getReminderTemplateId();
  if (!templateId) {
    throw new Error('未配置 REMINDER_TEMPLATE_ID');
  }

  const payload =
    typeof matchRow.payload === 'string' ? JSON.parse(matchRow.payload) : matchRow.payload;
  const matchId = payload._id || `espn_match_${matchRow.external_id}`;
  const page = `pages/match-detail/match-detail?id=${encodeURIComponent(matchId)}`;
  const data = buildReminderTemplateData({ ...matchRow, payload }, advanceMinutes);

  return sendSubscribeMessage({ openid, templateId, page, data });
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function getTokenTtlMs() {
  const days = Number(process.env.AUTH_TOKEN_DAYS) || 30;
  return days * 24 * 60 * 60 * 1000;
}

module.exports = {
  isWechatConfigured,
  getReminderTemplateId,
  code2Session,
  getAccessToken,
  sendMatchReminder,
  sendSubscribeMessage,
  buildReminderTemplateData,
  generateToken,
  getTokenTtlMs,
};
