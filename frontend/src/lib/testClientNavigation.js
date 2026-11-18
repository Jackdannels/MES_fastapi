import { LAB_NAME_BY_CODE } from "./labs";
import { MODULE_ROUTES } from "./moduleCatalog";
import { NavigationFailureType } from "vue-router";

const REQUEST_EVENT = "mes-test-client-navigate";
const RESULT_PREFIX = "mes-test-client-navigation:";
const isTestClient = () => window.__MES_DESKTOP__?.module === "test"
  && typeof window.__MES_DESKTOP__?.version === "string" && window.__MES_DESKTOP__.testClient === true;

function testClientTarget(value) {
  if (!value || !Object.hasOwn(MODULE_ROUTES, value.module)) return null;
  if (value.module === "laboratory") {
    if (!Object.hasOwn(LAB_NAME_BY_CODE, value.labCode) || value.key !== value.labCode) return null;
    return { path: MODULE_ROUTES.laboratory, query: { lab: value.labCode } };
  }
  return value.key === value.module && !value.labCode ? MODULE_ROUTES[value.module] : null;
}

function installTestClientNavigation({ readSession, switchSessionModule, router }) {
  if (!isTestClient()) return () => {};
  let switching = false;
  let disposed = false;
  const reply = (detail, result) => {
    if (!disposed) window.chrome?.webview?.postMessage(RESULT_PREFIX + JSON.stringify({ requestId: detail.requestId, key: detail.key, ...result }));
  };
  const listener = async ({ detail }) => {
    if (!detail || typeof detail.requestId !== "string" || detail.requestId.length > 80) return;
    const target = testClientTarget(detail);
    if (!target) { reply(detail, { ok: false, message: "此测试终端没有请求的业务页面。" }); return; }
    if (switching) { reply(detail, { ok: false, message: "正在切换页面，请稍候。" }); return; }
    const session = readSession();
    if (!session || session.terminal_auth) { reply(detail, { ok: false, message: "请先使用开发测试账号登录。" }); return; }
    switching = true;
    let moduleChanged = false;
    try {
      const result = await switchSessionModule(detail.module);
      if (!result.ok) { reply(detail, { ok: false, message: result.message || "账号会话已失效，请重新登录。" }); return; }
      moduleChanged = session.module !== detail.module;
      const failure = await router.push(target);
      if (failure && failure.type !== NavigationFailureType.duplicated) {
        if (session.module !== detail.module) await switchSessionModule(session.module);
        reply(detail, { ok: false, message: "页面切换已取消，请先处理当前页面提示。" });
        return;
      }
      reply(detail, { ok: true });
    } catch {
      if (moduleChanged) await switchSessionModule(session.module).catch(() => {});
      reply(detail, { ok: false, message: "页面切换失败，请检查连接后重试。" });
    } finally { switching = false; }
  };
  window.addEventListener(REQUEST_EVENT, listener);
  return () => { disposed = true; window.removeEventListener(REQUEST_EVENT, listener); };
}

export { installTestClientNavigation, testClientTarget };
