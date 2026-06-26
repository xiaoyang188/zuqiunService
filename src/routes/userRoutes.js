const express = require('express');
const { isDbEnabled } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { code2Session, isWechatConfigured } = require('../wechat/wechatService');
const userRepo = require('../repositories/userRepo');
const followRepo = require('../repositories/followRepo');
const reminderRepo = require('../repositories/reminderRepo');
const matchRepo = require('../repositories/matchRepo');
const { sortMatches } = require('../mapper');

const router = express.Router();

const ALLOWED_ADVANCE = new Set([1440, 60, 15]);

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(message, code = 1) {
  return { code, data: null, message };
}

function dbRequired(_req, res, next) {
  if (!isDbEnabled()) {
    res.status(503).json(fail('用户功能需要启用 MySQL（USE_DATABASE=true）', 503));
    return;
  }
  next();
}

async function resolveTeamInfo(teamId, teamPayload) {
  if (teamPayload && teamPayload._id) {
    return {
      _id: teamPayload._id,
      name: teamPayload.name || '',
      logo: teamPayload.logo || '',
      league: teamPayload.league || '',
    };
  }
  const externalId = followRepo.parseTeamExternalId(teamId);
  const pool = require('../db').getPool();
  const [rows] = await pool.execute(
    `SELECT external_id, name, logo, league_key FROM teams WHERE external_id = ? LIMIT 1`,
    [externalId]
  );
  if (rows[0]) {
    return {
      _id: `espn_team_${rows[0].external_id}`,
      name: rows[0].name,
      logo: rows[0].logo || '',
      league: rows[0].league_key || '',
    };
  }
  return {
    _id: teamId,
    name: teamPayload?.name || teamId,
    logo: teamPayload?.logo || '',
    league: teamPayload?.league || '',
  };
}

function enrichMyTeams(teams, matches) {
  const sorted = sortMatches(matches);
  const upcoming = sorted.filter((m) => ['NS', 'LIVE', 'HT'].includes(m.status));
  const finished = sorted.filter((m) => m.status === 'FT');

  return teams.map((team) => ({
    ...team,
    nextMatch:
      upcoming.find((m) => m.homeTeam === team._id || m.awayTeam === team._id) || null,
    lastMatch:
      finished.find((m) => m.homeTeam === team._id || m.awayTeam === team._id) || null,
  }));
}

router.post('/auth/login', dbRequired, async (req, res) => {
  if (!isWechatConfigured()) {
    res.status(503).json(fail('未配置 WECHAT_APPID / WECHAT_SECRET', 503));
    return;
  }
  const code = String(req.body?.code || '').trim();
  if (!code) {
    res.status(400).json(fail('缺少 code'));
    return;
  }
  try {
    const { openid } = await code2Session(code);
    const user = await userRepo.upsertByOpenid(openid);
    const expiresIn = Math.floor((user.expiresAt.getTime() - Date.now()) / 1000);
    res.json(
      ok({
        token: user.token,
        expiresIn,
      })
    );
  } catch (e) {
    console.error('[auth/login]', e.message);
    res.status(400).json(fail(e.message || '登录失败'));
  }
});

const userApi = express.Router();
userApi.use(requireAuth);

/** GET /api/user/follows */
userApi.get('/follows', async (req, res) => {
  try {
    const teams = await followRepo.listByUserId(req.user.id);
    res.json(ok(teams));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取关注失败'));
  }
});

/** GET /api/user/my-teams  关注球队 + 下一场/上一场 */
userApi.get('/my-teams', async (req, res) => {
  try {
    const teams = await followRepo.listByUserId(req.user.id);
    const [today, week] = await Promise.all([
      matchRepo.findToday(),
      matchRepo.findByDateRange('week'),
    ]);
    const map = new Map();
    [...week, ...today].forEach((m) => map.set(m._id, m));
    res.json(ok(enrichMyTeams(teams, Array.from(map.values()))));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取我的球队失败'));
  }
});

/** POST /api/user/follows  { teamId, action, team? } */
userApi.post('/follows', async (req, res) => {
  const teamId = String(req.body?.teamId || '').trim();
  const action = req.body?.action;
  if (!teamId || !['follow', 'unfollow'].includes(action)) {
    res.status(400).json(fail('参数无效：需要 teamId 与 action(follow|unfollow)'));
    return;
  }
  try {
    if (action === 'unfollow') {
      await followRepo.unfollow(req.user.id, teamId);
      await reminderRepo.removeByTeam(req.user.id, teamId);
      res.json(ok(null));
      return;
    }
    const team = await resolveTeamInfo(teamId, req.body?.team);
    await followRepo.follow(req.user.id, team);
    res.json(ok(null));
  } catch (e) {
    res.status(500).json(fail(e.message || '关注操作失败'));
  }
});

/** GET /api/user/reminders */
userApi.get('/reminders', async (req, res) => {
  try {
    const list = await reminderRepo.listByUserId(req.user.id);
    res.json(ok(list));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取提醒设置失败'));
  }
});

/** POST /api/user/reminders  { teamId, advanceMinutes, enabled } */
userApi.post('/reminders', async (req, res) => {
  const teamId = String(req.body?.teamId || '').trim();
  const advanceMinutes = Number(req.body?.advanceMinutes);
  const enabled = Boolean(req.body?.enabled);

  if (!teamId) {
    res.status(400).json(fail('缺少 teamId'));
    return;
  }
  if (!ALLOWED_ADVANCE.has(advanceMinutes)) {
    res.status(400).json(fail('advanceMinutes 无效，可选 1440 / 60 / 15'));
    return;
  }

  try {
    const following = await followRepo.isFollowing(req.user.id, teamId);
    if (!following) {
      res.status(400).json(fail('请先关注该球队后再设置提醒'));
      return;
    }
    await reminderRepo.upsert(req.user.id, teamId, advanceMinutes, enabled);
    res.json(ok(null));
  } catch (e) {
    res.status(500).json(fail(e.message || '保存提醒失败'));
  }
});

router.use('/user', dbRequired, userApi);

module.exports = router;
