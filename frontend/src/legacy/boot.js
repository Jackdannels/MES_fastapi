let legacyBootPromise = null;

function loadLegacyRuntime() {
  if (legacyBootPromise) {
    return legacyBootPromise;
  }
  if (typeof window === "undefined" || window.__MES_LEGACY_BOOT__) {
    legacyBootPromise = Promise.resolve();
    return legacyBootPromise;
  }

  legacyBootPromise = import("./runtime/main.js").then(() => {});
  return legacyBootPromise;
}

async function bootLegacyUI() {
  await loadLegacyRuntime();
  if (typeof window !== "undefined" && typeof window.__MES_LEGACY_BOOT__ === "function") {
    window.__MES_LEGACY_BOOT__();
  }
}

export { bootLegacyUI };
