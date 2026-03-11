const backendTarget = "http://127.0.0.1:8000";

const devServerProxy = {
  "/auth": {
    target: backendTarget,
    changeOrigin: true,
  },
  "/api": {
    target: backendTarget,
    changeOrigin: true,
  },
  "/static": {
    target: backendTarget,
    changeOrigin: true,
  },
};

export { backendTarget, devServerProxy };
