const express = require('express');
const { isDbEnabled } = require('../db');
const vibecodingRepo = require('../repositories/vibecodingRepo');
const { syncVibecodingOnce } = require('../sync/vibecodingSync');

const router = express.Router();

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(message, code = 1) {
  return { code, data: null, message };
}

function dbRequired(_req, res, next) {
  if (!isDbEnabled()) {
    res.status(503).json(fail('VibeCoding 功能需要启用 MySQL（USE_DATABASE=true）', 503));
    return;
  }
  next();
}

router.get('/vibecoding/items', dbRequired, async (req, res) => {
  const type = req.query.type ? String(req.query.type) : undefined;
  const source = req.query.source ? String(req.query.source) : undefined;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const sort = req.query.sort === 'recent' ? 'recent' : 'score';

  if (type && !['project', 'news', 'tool'].includes(type)) {
    res.status(400).json(fail('type 无效，可选 project / news / tool'));
    return;
  }
  if (source && !['hn', 'github', 'manual'].includes(source)) {
    res.status(400).json(fail('source 无效，可选 hn / github / manual'));
    return;
  }

  try {
    const result = await vibecodingRepo.listItems({ type, source, page, limit, sort });
    res.json(ok(result));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取列表失败'));
  }
});

router.get('/vibecoding/items/:id', dbRequired, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json(fail('id 无效'));
    return;
  }
  try {
    const item = await vibecodingRepo.getById(id);
    if (!item) {
      res.status(404).json(fail('条目不存在'));
      return;
    }
    res.json(ok(item));
  } catch (e) {
    res.status(500).json(fail(e.message || '获取详情失败'));
  }
});

router.post('/vibecoding/sync', dbRequired, async (req, res) => {
  const scope = String(req.query.scope || 'all');
  if (!['all', 'project', 'news'].includes(scope)) {
    res.status(400).json(fail('scope 无效，可选 all / project / news'));
    return;
  }

  try {
    const result = await syncVibecodingOnce(scope);
    if (!result.ok) {
      res.status(500).json(fail(result.error || '同步失败'));
      return;
    }
    res.json(ok(result));
  } catch (e) {
    res.status(500).json(fail(e.message || '同步失败'));
  }
});

module.exports = router;
