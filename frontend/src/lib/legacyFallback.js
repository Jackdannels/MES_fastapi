const STORE_KEY = "__MES_LEGACY_FALLBACK_HITS__";

const normalizeText = (value) => String(value ?? "").trim();
const SAFE_DETAIL_KEYS = new Set([
  "domain",
  "reason",
  "room",
  "source",
  "status",
  "targetIsFallback",
  "targetType",
]);

const createStore = () => ({
  hits: new Map(),
  sequence: 0,
});

const getStore = () => {
  if (!globalThis[STORE_KEY]) {
    globalThis[STORE_KEY] = createStore();
  }
  return globalThis[STORE_KEY];
};

export function recordLegacyFallbackHit(id, detail = {}) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    return null;
  }
  const store = getStore();
  const previous = store.hits.get(normalizedId) || { count: 0, id: normalizedId, lastDetail: null, lastSequence: 0 };
  const safeDetail = Object.fromEntries(
    Object.entries(detail && typeof detail === "object" ? detail : {})
      .filter(([key]) => SAFE_DETAIL_KEYS.has(key))
      .map(([key, value]) => [key, normalizeText(value)]),
  );
  const next = {
    ...previous,
    count: previous.count + 1,
    lastDetail: safeDetail,
    lastSequence: store.sequence + 1,
  };
  store.sequence += 1;
  store.hits.set(normalizedId, next);
  return next;
}

export function getLegacyFallbackHits() {
  return Array.from(getStore().hits.values())
    .map((hit) => ({ ...hit, lastDetail: hit.lastDetail ? { ...hit.lastDetail } : hit.lastDetail }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function resetLegacyFallbackHits() {
  globalThis[STORE_KEY] = createStore();
}

export function legacyFallbackHitCount(id) {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    return 0;
  }
  return getStore().hits.get(normalizedId)?.count || 0;
}
