const vibecodingRepo = require('../repositories/vibecodingRepo');
const {
  decodeHtml,
  resolveImageUrl,
  translateToZh,
  resetTranslateStats,
  getTranslateStats,
  sleep,
} = require('../utils/vibecodingMeta');

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const SHOW_HN_LIMIT = Math.min(
  Math.max(Number(process.env.VIBECODING_SHOW_HN_LIMIT) || 120, 1),
  500
);
const FETCH_TIMEOUT_MS = 12_000;

const VIBE_KEYWORDS = [
  'ai',
  'agent',
  'llm',
  'gpt',
  'claude',
  'codex',
  'cursor',
  'vibe',
  'coding',
  'skill',
  'automation',
  'devtools',
  'open source',
  'startup',
  'saas',
  'app',
  'tool',
];

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function matchesVibeKeywords(title, summary) {
  const haystack = `${title} ${summary}`.toLowerCase();
  return VIBE_KEYWORDS.some((kw) => haystack.includes(kw));
}

async function fetchHnItem(id) {
  const item = await fetchJson(`${HN_BASE}/item/${id}.json`);
  if (!item || item.deleted || item.dead) return null;
  if (!item.title) return null;
  return item;
}

async function syncShowHnOnce() {
  const startedAt = new Date();
  let count = 0;
  resetTranslateStats();

  try {
    const ids = await fetchJson(`${HN_BASE}/showstories.json`);
    const slice = Array.isArray(ids) ? ids.slice(0, SHOW_HN_LIMIT) : [];

    for (const id of slice) {
      try {
        const item = await fetchHnItem(id);
        if (!item) continue;

        const title = decodeHtml(item.title);
        const summary = stripHtml(item.text);
        if (!matchesVibeKeywords(title, summary)) continue;

        const url = item.url || `https://news.ycombinator.com/item?id=${item.id}`;
        const imageUrl = resolveImageUrl(url, item.by || '');
        const titleZh = await translateToZh(title);
        await sleep(120);
        const summaryZh = summary ? await translateToZh(summary) : '';
        await sleep(120);

        await vibecodingRepo.upsertItem({
          type: 'project',
          source: 'hn',
          externalId: String(item.id),
          title,
          titleZh,
          summary,
          summaryZh,
          url,
          imageUrl,
          author: item.by || '',
          score: item.score || 0,
          commentCount: item.descendants || 0,
          tags: ['show-hn', 'vibecoding'],
          publishedAt: item.time ? new Date(item.time * 1000) : new Date(),
        });
        count += 1;
      } catch (e) {
        console.warn(`[vibecoding] HN item ${id} 跳过:`, e.message);
      }
    }

    const tStats = getTranslateStats();
    const logHint =
      tStats.fail > 0
        ? `translate ok=${tStats.ok} fail=${tStats.fail}: ${tStats.lastError}`.slice(0, 512)
        : '';

    await vibecodingRepo.writeSyncLog('hn', 'ok', count, logHint, startedAt);
    console.log(
      `[vibecoding] HN Show 同步完成，扫描 ${SHOW_HN_LIMIT} 条，写入 ${count} 条，翻译 ok=${tStats.ok} fail=${tStats.fail}`
    );
    if (tStats.fail > 0) {
      console.warn(`[vibecoding] 翻译告警: ${tStats.lastError}`);
    }
    return { ok: true, count, translate: tStats };
  } catch (e) {
    await vibecodingRepo.writeSyncLog('hn', 'error', count, e.message, startedAt);
    console.error('[vibecoding] HN 同步失败:', e.message);
    return { ok: false, error: e.message, count };
  }
}

async function syncVibecodingOnce() {
  return syncShowHnOnce();
}

module.exports = { syncShowHnOnce, syncVibecodingOnce };
