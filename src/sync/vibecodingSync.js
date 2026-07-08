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
const NEWS_TOP_LIMIT = Math.min(
  Math.max(Number(process.env.VIBECODING_NEWS_TOP_LIMIT) || 60, 1),
  500
);
const NEWS_NEW_LIMIT = Math.min(
  Math.max(Number(process.env.VIBECODING_NEWS_NEW_LIMIT) || 40, 1),
  500
);
const NEWS_MAX_IDS = 80;
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

const NEWS_KEYWORDS = [
  'ai',
  'artificial intelligence',
  'llm',
  'gpt',
  'claude',
  'anthropic',
  'openai',
  'agent',
  'copilot',
  'cursor',
  'gemini',
  'deepseek',
  'mistral',
  'meta',
  'nvidia',
  'machine learning',
  'ml',
  'benchmark',
  'model',
  'inference',
  'fine-tune',
  'regulation',
  'chip',
  'cuda',
  'transformer',
  'diffusion',
  'vlm',
  'multimodal',
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

function matchesKeywords(title, summary, keywords) {
  const haystack = `${title} ${summary}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw));
}

function matchesVibeKeywords(title, summary) {
  return matchesKeywords(title, summary, VIBE_KEYWORDS);
}

function isAiNewsItem(item) {
  if (!item?.title || item.deleted || item.dead) return false;
  if (/^show hn:/i.test(item.title)) return false;
  const summary = stripHtml(item.text);
  return matchesKeywords(decodeHtml(item.title), summary, NEWS_KEYWORDS);
}

async function fetchHnItem(id) {
  const item = await fetchJson(`${HN_BASE}/item/${id}.json`);
  if (!item || item.deleted || item.dead) return null;
  if (!item.title) return null;
  return item;
}

async function upsertTranslatedItem(fields) {
  const titleZh = await translateToZh(fields.title);
  await sleep(120);
  const summaryZh = fields.summary ? await translateToZh(fields.summary) : '';
  await sleep(120);

  await vibecodingRepo.upsertItem({
    ...fields,
    titleZh,
    summaryZh,
  });
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
        await upsertTranslatedItem({
          type: 'project',
          source: 'hn',
          externalId: String(item.id),
          title,
          summary,
          url,
          imageUrl: resolveImageUrl(url, item.by || ''),
          author: item.by || '',
          score: item.score || 0,
          commentCount: item.descendants || 0,
          tags: ['show-hn', 'vibecoding'],
          publishedAt: item.time ? new Date(item.time * 1000) : new Date(),
        });
        count += 1;
      } catch (e) {
        console.warn(`[vibecoding] HN Show item ${id} 跳过:`, e.message);
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
    return { ok: true, count };
  } catch (e) {
    await vibecodingRepo.writeSyncLog('hn', 'error', count, e.message, startedAt);
    console.error('[vibecoding] HN Show 同步失败:', e.message);
    return { ok: false, error: e.message, count };
  }
}

async function syncHnNewsOnce() {
  const startedAt = new Date();
  let count = 0;

  try {
    const [topIds, newIds] = await Promise.all([
      fetchJson(`${HN_BASE}/topstories.json`),
      fetchJson(`${HN_BASE}/newstories.json`),
    ]);

    const topSlice = Array.isArray(topIds) ? topIds.slice(0, NEWS_TOP_LIMIT) : [];
    const newSlice = Array.isArray(newIds) ? newIds.slice(0, NEWS_NEW_LIMIT) : [];
    const ids = [...new Set([...topSlice, ...newSlice])].slice(0, NEWS_MAX_IDS);

    for (const id of ids) {
      try {
        const item = await fetchHnItem(id);
        if (!item || !isAiNewsItem(item)) continue;

        const title = decodeHtml(item.title);
        const summary = stripHtml(item.text);
        const url = item.url || `https://news.ycombinator.com/item?id=${item.id}`;

        await upsertTranslatedItem({
          type: 'news',
          source: 'hn',
          externalId: String(item.id),
          title,
          summary,
          url,
          imageUrl: resolveImageUrl(url, item.by || ''),
          author: item.by || '',
          score: item.score || 0,
          commentCount: item.descendants || 0,
          tags: ['hn-top', 'ai-news'],
          publishedAt: item.time ? new Date(item.time * 1000) : new Date(),
        });
        count += 1;
      } catch (e) {
        console.warn(`[vibecoding] HN News item ${id} 跳过:`, e.message);
      }
    }

    const tStats = getTranslateStats();
    const logHint =
      tStats.fail > 0
        ? `translate ok=${tStats.ok} fail=${tStats.fail}: ${tStats.lastError}`.slice(0, 512)
        : '';

    await vibecodingRepo.writeSyncLog('hn-news', 'ok', count, logHint, startedAt);
    console.log(
      `[vibecoding] HN News 同步完成，扫描 ${ids.length} 条，写入 ${count} 条，翻译 ok=${tStats.ok} fail=${tStats.fail}`
    );
    if (tStats.fail > 0) {
      console.warn(`[vibecoding] 翻译告警: ${tStats.lastError}`);
    }
    return { ok: true, count };
  } catch (e) {
    await vibecodingRepo.writeSyncLog('hn-news', 'error', count, e.message, startedAt);
    console.error('[vibecoding] HN News 同步失败:', e.message);
    return { ok: false, error: e.message, count };
  }
}

async function syncVibecodingOnce(scope = 'all') {
  resetTranslateStats();

  const runProject = scope === 'all' || scope === 'project';
  const runNews = scope === 'all' || scope === 'news';

  let projectCount = 0;
  let newsCount = 0;
  const errors = [];

  if (runProject) {
    const projectResult = await syncShowHnOnce();
    if (!projectResult.ok) errors.push(projectResult.error || 'project sync failed');
    else projectCount = projectResult.count;
  }

  if (runNews) {
    const newsResult = await syncHnNewsOnce();
    if (!newsResult.ok) errors.push(newsResult.error || 'news sync failed');
    else newsCount = newsResult.count;
  }

  const translate = getTranslateStats();
  const count = projectCount + newsCount;
  const ok = errors.length === 0;

  if (!ok) {
    return {
      ok: false,
      error: errors.join('; '),
      count,
      projectCount,
      newsCount,
      translate,
    };
  }

  return { ok: true, count, projectCount, newsCount, translate };
}

module.exports = { syncShowHnOnce, syncHnNewsOnce, syncVibecodingOnce };
