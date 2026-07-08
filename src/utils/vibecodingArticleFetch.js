const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');

const USER_AGENT = 'RuleHub-VibeCoding/1.0 (+https://www.yimingyinglou.top)';
const CONTENT_TIMEOUT_MS = Number(process.env.VIBECODING_CONTENT_TIMEOUT_MS) || 15_000;
const CONTENT_MAX_BYTES = Number(process.env.VIBECODING_CONTENT_MAX_BYTES) || 51_200;

const SKIP_HOSTS = new Set([
  'news.ycombinator.com',
  'twitter.com',
  'x.com',
  'youtu.be',
  'youtube.com',
  'reddit.com',
  'old.reddit.com',
]);

function truncateContent(text) {
  const raw = String(text || '');
  if (Buffer.byteLength(raw, 'utf8') <= CONTENT_MAX_BYTES) return raw;
  return Buffer.from(raw, 'utf8').subarray(0, CONTENT_MAX_BYTES).toString('utf8');
}

function extractMetaContent(html, attrPattern) {
  const re = new RegExp(attrPattern, 'i');
  const match = html.match(re);
  if (!match) return '';
  return match[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function extractOgDescription(html) {
  return (
    extractMetaContent(html, '<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)') ||
    extractMetaContent(html, '<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description') ||
    extractMetaContent(html, '<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)') ||
    extractMetaContent(html, '<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description')
  );
}

function extractOgImage(html) {
  return (
    extractMetaContent(html, '<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)') ||
    extractMetaContent(html, '<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:image')
  );
}

function plainTextFromMarkdown(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isExternalArticleUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return !SKIP_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return '';
    return await res.text();
  } catch (e) {
    console.warn(`[vibecoding][fetch] ${url}:`, e.message);
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchArticleContent(url) {
  if (!isExternalArticleUrl(url)) {
    return { ok: false, skipped: true, body: '', format: 'plain', ogImage: '', ogDescription: '' };
  }

  const html = await fetchHtml(url);
  if (!html) {
    return { ok: false, skipped: false, body: '', format: 'plain', ogImage: '', ogDescription: '' };
  }

  const ogImage = extractOgImage(html);
  const ogDescription = extractOgDescription(html);

  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.content) {
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      const markdown = truncateContent(td.turndown(article.content));
      return {
        ok: markdown.length > 80,
        skipped: false,
        body: markdown,
        format: 'markdown',
        ogImage,
        ogDescription,
        title: article.title || '',
      };
    }
  } catch (e) {
    console.warn(`[vibecoding][readability] ${url}:`, e.message);
  }

  const desc = truncateContent(ogDescription);
  return {
    ok: desc.length > 20,
    skipped: false,
    body: desc,
    format: 'plain',
    ogImage,
    ogDescription: desc,
  };
}

module.exports = {
  fetchArticleContent,
  extractOgDescription,
  extractOgImage,
  isExternalArticleUrl,
  plainTextFromMarkdown,
};
