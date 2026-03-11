import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

import { devServerProxy } from "./src/lib/devServerProxy.js";

export default defineConfig({
  plugins: [vue()],
  base: "/static/dist/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "../app/static/dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: devServerProxy,
    fs: {
      allow: [".."],
    },
  },
});
