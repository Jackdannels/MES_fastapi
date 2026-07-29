const PERFORMANCE_STORE_KEY = "__MES_PERFORMANCE_ENTRIES__";
const PERFORMANCE_EVENT = "mes:performance";
const MAX_ENTRIES = 300;

const nowMs = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const performanceMonitoringEnabled = () => {
  if (globalThis.__MES_PERFORMANCE_ENABLED__ === false) {
    return false;
  }
  const configured = String(import.meta.env.VITE_PERFORMANCE_MONITOR_ENABLED || "").trim().toLowerCase();
  return configured ? configured === "true" : Boolean(import.meta.env.DEV);
};

const sanitizeDetails = (details) => {
  const source = details && typeof details === "object" ? details : {};
  return Object.fromEntries(
    Object.entries(source)
      .filter(([, value]) => ["boolean", "number", "string"].includes(typeof value))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 500) : value]),
  );
};

function recordPerformanceMetric(name, durationMs, details = {}) {
  if (!performanceMonitoringEnabled()) {
    return null;
  }
  const entry = {
    name: String(name || "unknown").slice(0, 120),
    durationMs: Math.max(0, Number(durationMs) || 0),
    recordedAt: new Date().toISOString(),
    ...sanitizeDetails(details),
  };
  const entries = Array.isArray(globalThis[PERFORMANCE_STORE_KEY])
    ? globalThis[PERFORMANCE_STORE_KEY]
    : [];
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  globalThis[PERFORMANCE_STORE_KEY] = entries;
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(PERFORMANCE_EVENT, { detail: entry }));
  }
  return entry;
}

function getPerformanceEntries() {
  return Array.isArray(globalThis[PERFORMANCE_STORE_KEY])
    ? globalThis[PERFORMANCE_STORE_KEY].map((entry) => ({ ...entry }))
    : [];
}

function resetPerformanceEntries() {
  globalThis[PERFORMANCE_STORE_KEY] = [];
}

function resourcePath(value) {
  try {
    return new URL(String(value || ""), globalThis.location?.href || "http://localhost/").pathname;
  } catch {
    return "";
  }
}

function startFrontendPerformanceMonitoring() {
  if (!performanceMonitoringEnabled() || typeof PerformanceObserver !== "function") {
    return () => {};
  }
  const observers = [];
  const observe = (type, callback) => {
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch {
      // Unsupported performance entry types must not affect the application.
    }
  };

  observe("longtask", (entries) => {
    entries.forEach((entry) => {
      recordPerformanceMetric("browser.longtask", entry.duration, {
        category: "longtask",
        startTimeMs: Number(entry.startTime) || 0,
      });
    });
  });
  observe("resource", (entries) => {
    entries
      .filter((entry) => ["fetch", "xmlhttprequest"].includes(String(entry.initiatorType || "")))
      .forEach((entry) => {
        recordPerformanceMetric("browser.api-resource", entry.duration, {
          category: "resource",
          path: resourcePath(entry.name),
          transferBytes: Number(entry.transferSize) || 0,
          encodedBytes: Number(entry.encodedBodySize) || 0,
          decodedBytes: Number(entry.decodedBodySize) || 0,
        });
      });
  });

  return () => observers.forEach((observer) => observer.disconnect());
}

function performanceNow() {
  return nowMs();
}

export {
  PERFORMANCE_EVENT,
  getPerformanceEntries,
  performanceMonitoringEnabled,
  performanceNow,
  recordPerformanceMetric,
  resetPerformanceEntries,
  startFrontendPerformanceMonitoring,
};
