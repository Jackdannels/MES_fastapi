import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

import { devServerProxy } from "./src/lib/devServerProxy.js";

export default defineConfig({
  plugins: [vue()],
  base: "/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["mes-server", "192.168.110.15", "820rbhs27834.vicp.fun"],
    proxy: devServerProxy,
  },
});
