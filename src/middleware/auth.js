const userRepo = require('../repositories/userRepo');

function extractBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  if (typeof header !== 'string') return '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ code: 401, data: null, message: '请先登录' });
    return;
  }
  try {
    const user = await userRepo.findByToken(token);
    if (!user) {
      res.status(401).json({ code: 401, data: null, message: '登录已过期，请重新登录' });
      return;
    }
    req.user = user;
    next();
  } catch (e) {
    res.status(500).json({ code: 1, data: null, message: e.message || '鉴权失败' });
  }
}

module.exports = { requireAuth, extractBearerToken };
