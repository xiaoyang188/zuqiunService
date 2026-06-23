const store = new Map();

function get(key) {
  const item = store.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) {
    store.delete(key);
    return null;
  }
  return item.value;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: Date.now() + ttlMs });
}

function cached(key, ttlMs, fetcher) {
  const hit = get(key);
  if (hit) return Promise.resolve(hit);
  return fetcher().then((value) => {
    set(key, value, ttlMs);
    return value;
  });
}

module.exports = { cached };
