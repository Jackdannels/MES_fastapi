const LEGACY_UI_ROUTE_NAMES = Object.freeze([
  "dashboard",
  "tasks",
  "schedule",
  "samples",
  "devices",
  "data",
  "system",
]);

const legacyUiRouteNameSet = new Set(LEGACY_UI_ROUTE_NAMES);

const resolveBooleanEnv = (value, fallback) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const appConfig = Object.freeze({
  demoAuthMode: false,
  enableLegacyUiBridge: resolveBooleanEnv(import.meta.env.VITE_ENABLE_LEGACY_UI_BRIDGE, true),
  legacyUiRoutes: LEGACY_UI_ROUTE_NAMES,
});

function shouldBridgeLegacyUi(route) {
  if (!appConfig.enableLegacyUiBridge) {
    return false;
  }

  if (!route || route.meta?.layout === "auth") {
    return false;
  }

  return Boolean(route.meta?.legacyUi && legacyUiRouteNameSet.has(String(route.name || "")));
}

export { appConfig, shouldBridgeLegacyUi };
