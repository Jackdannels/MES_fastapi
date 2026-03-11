import { DEFAULT_BACKEND_TARGET, resolveBackendTarget } from "./apiBase.js";

const backendTarget = resolveBackendTarget(process.env.VITE_API_BASE_URL, DEFAULT_BACKEND_TARGET);

const devServerProxy = {
  "/auth": {
    target: backendTarget,
    changeOrigin: true,
  },
  "/api": {
    target: backendTarget,
    changeOrigin: true,
  },
};

export { backendTarget, devServerProxy };
