import { resolveModuleHome } from "@/auth";
import { resolveLaboratoryDisplayName, resolveLaboratoryRouteKey } from "@/lib/labs";

function resolveSessionHome(session) {
  if (session?.terminal_auth && session?.module === "laboratory" && String(session?.lab_name || "").trim()) {
    return { path: "/laboratory", query: { lab: resolveLaboratoryRouteKey(session.lab_name) } };
  }
  return resolveModuleHome(session?.module);
}

async function buildRouteAccessDecision({ getSession, session, to }) {
  const currentSession = session ?? (typeof getSession === "function" ? await getSession() : null);

  if (to?.meta?.layout === "auth") {
    if (currentSession?.module) {
      return resolveSessionHome(currentSession);
    }
    return true;
  }

  if (!currentSession) {
    return { path: "/login", query: { redirect: to?.fullPath || "/" } };
  }

  const selectedModule = currentSession.module || "central";
  const targetModule = to?.meta?.module || "central";
  if (selectedModule !== targetModule) {
    return resolveSessionHome(currentSession);
  }

  if (currentSession?.terminal_auth && selectedModule === "laboratory") {
    const boundLabName = String(currentSession?.lab_name || "").trim();
    const requestedLabName = resolveLaboratoryDisplayName(to?.query?.lab);
    if (boundLabName && requestedLabName !== boundLabName) {
      return resolveSessionHome(currentSession);
    }
  }

  return true;
}

export { buildRouteAccessDecision };
