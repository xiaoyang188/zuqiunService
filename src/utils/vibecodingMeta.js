const FETCH_TIMEOUT_MS = 10_000;

const translateStats = { ok: 0, fail: 0, lastError: '' };

function decodeHtml(text) {
  return String(text || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      try {
        return String.fromCodePoint(Number(num));
      } catch {
        return '';
      }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'");
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 同步时解析可访问的预览图 URL */
function resolveImageUrl(url, author) {
  if (!url) {
    if (author) return `https://github.com/${author}.png?size=128`;
    return '';
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'github.com') {
      const [owner] = parsed.pathname.split('/').filter(Boolean);
      if (owner) return `https://github.com/${owner}.png?size=128`;
    }

    if (host === 'news.ycombinator.com' && author) {
      return `https://github.com/${author}.png?size=128`;
    }

    return `https://icons.duckduckgo.com/ip3/${host}.ico`;
  } catch {
    return author ? `https://github.com/${author}.png?size=128` : '';
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, ...options });
  } finally {
    clearTimeout(timer);
  }
}

async function translateViaGoogle(input) {
  const q = encodeURIComponent(input.slice(0, 450));
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${q}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data?.[0])) throw new Error('empty response');

  const text = data[0]
    .map((part) => part?.[0])
    .filter(Boolean)
    .join('')
    .trim();
  if (!text) throw new Error('empty text');
  return text;
}

/** 国内服务器 fallback，无需 API Key（有日配额） */
async function translateViaMyMemory(input) {
  const q = encodeURIComponent(input.slice(0, 480));
  const url = `https://api.mymemory.translated.net/get?q=${q}&langpair=en|zh-CN`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data.responseStatus !== 200) {
    throw new Error(`status ${data.responseStatus}`);
  }

  const text = String(data.responseData?.translatedText || '').trim();
  if (!text) throw new Error('empty text');
  if (text.includes('MYMEMORY WARNING')) {
    throw new Error('daily quota exceeded');
  }
  return text;
}

function resetTranslateStats() {
  translateStats.ok = 0;
  translateStats.fail = 0;
  translateStats.lastError = '';
}

function getTranslateStats() {
  return { ...translateStats };
}

async function translateToZh(text) {
  const input = decodeHtml(String(text || '').trim());
  if (!input) return '';
  if (process.env.VIBECODING_TRANSLATE === 'false') return '';

  const providers = [
    { name: 'google', fn: translateViaGoogle },
    { name: 'mymemory', fn: translateViaMyMemory },
  ];

  const errors = [];
  for (const { name, fn } of providers) {
    try {
      const result = await fn(input);
      translateStats.ok += 1;
      return result;
    } catch (e) {
      const msg = `${name}: ${e.message}`;
      errors.push(msg);
      console.warn(`[vibecoding][translate] ${msg}`);
    }
  }

  translateStats.fail += 1;
  translateStats.lastError = errors.join('; ');
  console.warn(
    `[vibecoding][translate] 全部失败，保留英文: "${input.slice(0, 48)}${input.length > 48 ? '…' : ''}"`
  );
  return '';
}

/** 长文分段翻译（VIBECODING_TRANSLATE_CONTENT=true 时启用） */
async function translateContentToZh(text) {
  if (process.env.VIBECODING_TRANSLATE_CONTENT !== 'true') return '';
  const input = String(text || '').trim();
  if (!input) return '';

  const chunks = [];
  const paragraphs = input.split(/\n{2,}/);
  let buffer = '';

  for (const para of paragraphs) {
    if (Buffer.byteLength(`${buffer}\n\n${para}`, 'utf8') > 3800 && buffer) {
      chunks.push(buffer);
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer) chunks.push(buffer);
  if (chunks.length === 0) chunks.push(input.slice(0, 3800));

  const parts = [];
  for (const chunk of chunks) {
    const translated = await translateToZh(chunk);
    parts.push(translated || chunk);
    await sleep(120);
  }
  return parts.join('\n\n').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  decodeHtml,
  extractDomain,
  resolveImageUrl,
  translateToZh,
  translateContentToZh,
  resetTranslateStats,
  getTranslateStats,
  sleep,
};
