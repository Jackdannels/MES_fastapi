// The native host supplies presentation settings; server sessions still authorize access.
import { MODULE_ROUTES } from "./moduleCatalog";
import { LAB_CODE_BY_NAME } from "./labs";

const getDesktopModule = () => {
  if (typeof window === "undefined") return "";
  const client = window.__MES_DESKTOP__;
  if (typeof client?.version !== "string" || !Object.hasOwn(MODULE_ROUTES, client.module)) return "";
  if (client.module === "laboratory" && (!LAB_CODE_BY_NAME[client.labName] || LAB_CODE_BY_NAME[client.labName] !== client.labCode)) return "";
  return client.module;
};

const getDesktopLaboratory = () => getDesktopModule() === "laboratory" ? window.__MES_DESKTOP__.labName : "";

const getDesktopHome = () => {
  const module = getDesktopModule();
  if (!module) return null;
  return module === "laboratory"
    ? { path: MODULE_ROUTES.laboratory, query: { lab: LAB_CODE_BY_NAME[getDesktopLaboratory()] } }
    : MODULE_ROUTES[module];
};

const isDesktopAutoLogin = () => Boolean(getDesktopModule() && getDesktopModule() !== "central" && window.__MES_DESKTOP__.autoLogin);
const canCloseDesktopWindow = () => Boolean(getDesktopModule() && getDesktopModule() !== "central" && window.__MES_DESKTOP__.canCloseWindow);
const sendDesktopMessage = (message) => {
  if (typeof window?.chrome?.webview?.postMessage !== "function") return false;
  window.chrome.webview.postMessage(message);
  return true;
};
const requestDesktopClose = () => canCloseDesktopWindow() && sendDesktopMessage("mes-client-close-request");
const requestDesktopAuthentication = () => isDesktopAutoLogin() && sendDesktopMessage("mes-client-auth-required");

export { canCloseDesktopWindow, getDesktopHome, getDesktopLaboratory, getDesktopModule, isDesktopAutoLogin, requestDesktopAuthentication, requestDesktopClose };
