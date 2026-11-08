import { resolveModuleHome } from "@/auth";
import { resolveLaboratoryDisplayName, resolveLaboratoryRouteKey } from "@/lib/labs";
import { getDesktopHome, getDesktopLaboratory, getDesktopModule } from "./desktopClient";

function resolveSessionHome(session) {
  if (getDesktopModule() === session?.module) return getDesktopHome();
  if (session?.terminal_auth && session?.module === "laboratory" && String(session?.lab_name || "").trim()) {
    return { path: "/laboratory", query: { lab: resolveLaboratoryRouteKey(session.lab_name) } };
  }
  return resolveModuleHome(session?.module);
}

async function buildRouteAccessDecision({ getSession, session, to }) {
  const currentSession = session ?? (typeof getSession === "function" ? await getSession() : null);
  const desktopModule = getDesktopModule();
  const fixedLaboratory = getDesktopLaboratory();
  const wrongBoundLab = fixedLaboratory && currentSession?.terminal_auth
    && resolveLaboratoryDisplayName(currentSession.lab_name) !== fixedLaboratory;
  if (desktopModule && currentSession && (currentSession.module !== desktopModule || wrongBoundLab)) {
    return to?.meta?.layout === "auth" ? true : { path: "/login" };
  }

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

  if (fixedLaboratory && resolveLaboratoryDisplayName(to?.query?.lab) !== fixedLaboratory) {
    return getDesktopHome();
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
