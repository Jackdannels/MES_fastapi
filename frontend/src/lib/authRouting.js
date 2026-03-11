import { resolveModuleHome } from "@/auth";

async function buildRouteAccessDecision({ getSession, session, to }) {
  const currentSession = session ?? (typeof getSession === "function" ? await getSession() : null);

  if (to?.meta?.layout === "auth") {
    if (currentSession?.module) {
      return resolveModuleHome(currentSession.module);
    }
    return true;
  }

  if (!currentSession) {
    return { path: "/login", query: { redirect: to?.fullPath || "/" } };
  }

  const selectedModule = currentSession.module || "central";
  const targetModule = to?.meta?.module || "central";
  if (selectedModule !== targetModule) {
    return resolveModuleHome(selectedModule);
  }

  return true;
}

export { buildRouteAccessDecision };
