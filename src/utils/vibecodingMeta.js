const FETCH_TIMEOUT_MS = 10_000;

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

async function translateToZh(text) {
  const input = decodeHtml(String(text || '').trim());
  if (!input) return '';
  if (process.env.VIBECODING_TRANSLATE === 'false') return '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const q = encodeURIComponent(input.slice(0, 450));
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${q}`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return '';

    const data = await res.json();
    if (!Array.isArray(data?.[0])) return '';

    return data[0]
      .map((part) => part?.[0])
      .filter(Boolean)
      .join('')
      .trim();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  decodeHtml,
  extractDomain,
  resolveImageUrl,
  translateToZh,
  sleep,
};
