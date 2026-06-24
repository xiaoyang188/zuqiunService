const store = new Map();
/** 同一 key 并发请求合并，避免首页+赛程 Tab 同时打穿 ESPN */
const inflight = new Map();

function get(key) {
  const item = store.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) return null;
  return item.value;
}

function getStale(key) {
  const item = store.get(key);
  return item ? item.value : null;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

function cached(key, ttlMs, fetcher) {
  const hit = get(key);
  if (hit) return Promise.resolve(hit);
  return dedupe(key, () =>
    fetcher().then((value) => {
      set(key, value, ttlMs);
      return value;
    })
  );
}

/** 先返旧数据，后台刷新（week 赛程专用，避免 20s 白屏） */
function cachedStale(key, ttlMs, staleTtlMs, fetcher) {
  const hit = get(key);
  if (hit) return Promise.resolve(hit);

  const staleKey = `${key}:stale`;
  const stale = getStale(staleKey);

  const refresh = () =>
    dedupe(key, () =>
      fetcher().then((value) => {
        set(key, value, ttlMs);
        set(staleKey, value, staleTtlMs);
        return value;
      })
    );

  if (stale) {
    refresh().catch(() => {});
    return Promise.resolve(stale);
  }

  return refresh().then((value) => {
    set(staleKey, value, staleTtlMs);
    return value;
  });
}

function dedupe(key, run) {
  if (inflight.has(key)) return inflight.get(key);
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

module.exports = { cached, cachedStale, get, set };
