const { getPool } = require('../db');

function mapRow(row, opts = {}) {
  if (!row) return null;
  let tags = [];
  if (row.tags) {
    try {
      tags = typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags;
    } catch {
      tags = [];
    }
  }

  const base = {
    id: row.id,
    type: row.type,
    source: row.source,
    externalId: row.external_id,
    title: row.title_zh || row.title,
    titleEn: row.title,
    titleZh: row.title_zh || '',
    summary: row.summary_zh || row.summary || '',
    summaryEn: row.summary || '',
    summaryZh: row.summary_zh || '',
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

  if (opts.includeContent) {
    base.content = row.content || '';
    base.contentZh = row.content_zh || '';
    base.contentFormat = row.content_format || '';
    base.contentStatus = row.content_status || 'pending';
    base.contentFetchedAt = row.content_fetched_at
      ? new Date(row.content_fetched_at).toISOString()
      : null;
  }

  return base;
}

async function upsertItem(item) {
  const pool = getPool();
  if (!pool) return null;

  const touchContent = item.updateContent === true;
  const tagsJson = item.tags ? JSON.stringify(item.tags) : null;

  const contentUpdates = touchContent
    ? `content = IF(VALUES(content) IS NOT NULL AND VALUES(content) != '', VALUES(content), content),
       content_zh = IF(VALUES(content_zh) IS NOT NULL AND VALUES(content_zh) != '', VALUES(content_zh), content_zh),
       content_format = IF(VALUES(content_format) != '', VALUES(content_format), content_format),
       content_status = IF(VALUES(content_status) != 'pending', VALUES(content_status), content_status),
       content_fetched_at = IF(VALUES(content_fetched_at) IS NOT NULL, VALUES(content_fetched_at), content_fetched_at),`
    : '';

  await pool.execute(
    `INSERT INTO vibecoding_items
      (type, source, external_id, title, title_zh, summary, summary_zh,
       content, content_zh, content_format, content_status, content_fetched_at,
       url, image_url, author, score, comment_count, tags, published_at, synced_at, is_featured, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')
     ON DUPLICATE KEY UPDATE
       title = VALUES(title),
       title_zh = IF(VALUES(title_zh) != '', VALUES(title_zh), title_zh),
       summary = IF(VALUES(summary) != '', VALUES(summary), summary),
       summary_zh = IF(VALUES(summary_zh) != '', VALUES(summary_zh), summary_zh),
       ${contentUpdates}
       url = VALUES(url),
       image_url = IF(VALUES(image_url) != '', VALUES(image_url), image_url),
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
      item.titleZh || '',
      item.summary || '',
      item.summaryZh || '',
      touchContent ? item.content || null : null,
      touchContent ? item.contentZh || null : null,
      touchContent ? item.contentFormat || '' : '',
      touchContent ? item.contentStatus || 'pending' : 'pending',
      touchContent ? item.contentFetchedAt || null : null,
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

async function getContentMeta(source, externalId) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.execute(
    `SELECT content, content_zh, content_status, content_format, content_fetched_at, summary
     FROM vibecoding_items
     WHERE source = ? AND external_id = ? AND status = 'active'
     LIMIT 1`,
    [source, externalId]
  );
  return rows[0] || null;
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
  return mapRow(rows[0], { includeContent: true });
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
    items: rows.map((row) => mapRow(row, { includeContent: false })),
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
  getContentMeta,
  listItems,
  writeSyncLog,
};
