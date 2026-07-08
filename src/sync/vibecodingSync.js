const vibecodingRepo = require('../repositories/vibecodingRepo');
const {
  decodeHtml,
  resolveImageUrl,
  translateToZh,
  sleep,
} = require('../utils/vibecodingMeta');

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const SHOW_HN_LIMIT = 40;
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

    await vibecodingRepo.writeSyncLog('hn', 'ok', count, '', startedAt);
    console.log(`[vibecoding] HN Show 同步完成，写入 ${count} 条`);
    return { ok: true, count };
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
