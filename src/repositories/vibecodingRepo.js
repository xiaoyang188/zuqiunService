const { getPool } = require('../db');

function mapRow(row) {
  if (!row) return null;
  let tags = [];
  if (row.tags) {
    try {
      tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags;
    } catch {
      tags = [];
    }
  }
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    summary: row.summary || '',
    url: row.url,
    imageUrl: row.image_url || '',
    author: row.author || '',
    score: row.score,
    commentCount: row.comment_count,
    tags,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    syncedAt: row.synced_at ? new Date(row.synced_at).toISOString() : null,
    isFeatured: Boolean(row.is_featured),
  };
}

async function upsertItem(item) {
  const pool = getPool();
  if (!pool) return null;

  const tagsJson = item.tags ? JSON.stringify(item.tags) : null;
  await pool.execute(
    `INSERT INTO vibecoding_items
      (type, source, external_id, title, summary, url, image_url, author,
       score, comment_count, tags, published_at, synced_at, is_featured, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       summary = VALUES(summary),
       url = VALUES(url),
       image_url = VALUES(image_url),
       author = VALUES(author),
       score = VALUES(score),
       comment_count = VALUES(comment_count),
       tags = VALUES(tags),
       published_at = VALUES(published_at),
       synced_at = NOW(),
       updated_at = NOW()`,
    [
      item.type || 'project',
      item.source,
      item.externalId,
      item.title,
      item.summary || '',
      item.url || '',
      item.imageUrl || '',
      item.author || '',
      item.score || 0,
      item.commentCount || 0,
      tagsJson,
      item.publishedAt || null,
      item.isFeatured ? 1 : 0,
    ]
  );
  return getBySourceExternal(item.source, item.externalId);
}

async function getBySourceExternal(source, externalId) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.execute(
    `SELECT * FROM vibecoding_items
     WHERE source = ? AND external_id = ? AND status = 'active'
     LIMIT 1`,
    [source, externalId]
  );
  return mapRow(rows[0]);
}

async function getById(id) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.execute(
    `SELECT * FROM vibecoding_items WHERE id = ? AND status = 'active' LIMIT 1`,
    [id]
  );
  return mapRow(rows[0]);
}

async function listItems({ type, source, page = 1, limit = 20, sort = 'score' }) {
  const pool = getPool();
  if (!pool) return { items: [], total: 0, page, limit };

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const where = ["status = 'active'"];
  const params = [];

  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (source) {
    where.push('source = ?');
    params.push(source);
  }

  const orderBy =
    sort === 'recent'
      ? 'COALESCE(published_at, synced_at) DESC, score DESC'
      : 'score DESC, COALESCE(published_at, synced_at) DESC';

  const whereSql = where.join(' AND ');

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM vibecoding_items WHERE ${whereSql}`,
    params
  );
  const total = countRows[0]?.total || 0;

  const [rows] = await pool.execute(
    `SELECT * FROM vibecoding_items
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );

  return {
    items: rows.map(mapRow),
    total,
    page: safePage,
    limit: safeLimit,
    hasNext: offset + rows.length < total,
  };
}

async function writeSyncLog(source, status, itemCount, errorMsg, startedAt) {
  const pool = getPool();
  if (!pool) return;
  await pool.execute(
    `INSERT INTO vibecoding_sync_logs (source, status, item_count, error_msg, started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [source, status, itemCount || 0, (errorMsg || '').slice(0, 512), startedAt]
  );
}

module.exports = {
  upsertItem,
  getById,
  getBySourceExternal,
  listItems,
  writeSyncLog,
};
