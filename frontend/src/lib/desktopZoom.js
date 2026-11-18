const ZOOM_MESSAGE_TYPE = "mes-client-zoom";
const ZOOM_REQUEST_PREFIX = "mes-client-zoom:";

const isDesktopZoomAvailable = () => typeof window !== "undefined"
  && window.__MES_DESKTOP__?.module === "test"
  && window.__MES_DESKTOP__?.testClient === true
  && window.__MES_DESKTOP__?.pageZoomSupported === true
  && typeof window.__MES_DESKTOP__?.version === "string"
  && typeof window.chrome?.webview?.postMessage === "function";

function requestDesktopZoom(action) {
  if (!isDesktopZoomAvailable() || !["get", "in", "out", "reset"].includes(action)) return false;
  window.chrome.webview.postMessage(ZOOM_REQUEST_PREFIX + action);
  return true;
}

function subscribeDesktopZoom(listener) {
  const bridge = typeof window !== "undefined" ? window.chrome?.webview : null;
  if (!isDesktopZoomAvailable() || typeof bridge?.addEventListener !== "function") return () => {};
  const onMessage = ({ data }) => {
    if (data?.type !== ZOOM_MESSAGE_TYPE || !Number.isInteger(data.percent) || !Array.isArray(data.levels)
      || data.levels.length < 2 || data.levels.length > 20
      || data.levels[0] !== 50 || data.levels.at(-1) !== 200 || !data.levels.includes(100)
      || !data.levels.includes(data.percent)
      || data.levels.some((level, index) => !Number.isInteger(level) || (index > 0 && level <= data.levels[index - 1]))) return;
    listener({ percent: data.percent, levels: [...data.levels] });
  };
  bridge.addEventListener("message", onMessage);
  return () => bridge.removeEventListener("message", onMessage);
}

export { isDesktopZoomAvailable, requestDesktopZoom, subscribeDesktopZoom };
