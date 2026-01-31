let legacyBootPromise = null;

function loadLegacyScript() {
  if (legacyBootPromise) {
    return legacyBootPromise;
  }
  legacyBootPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    if (window.__MES_LEGACY_BOOT__) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/static/js/main.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load legacy UI script."));
    document.head.appendChild(script);
  });
  return legacyBootPromise;
}

async function bootLegacyUI() {
  await loadLegacyScript();
  if (typeof window !== "undefined" && typeof window.__MES_LEGACY_BOOT__ === "function") {
    window.__MES_LEGACY_BOOT__();
  }
}

export { bootLegacyUI };
