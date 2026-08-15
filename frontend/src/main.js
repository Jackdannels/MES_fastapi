import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { startServerClockSync, syncServerClock } from "./lib/serverClock";
import {
  performanceNow,
  recordPerformanceMetric,
  startFrontendPerformanceMonitoring,
} from "./lib/performanceMonitor";
import { initializeTheme } from "./composables/useTheme";
import "./assets/app.css";

window.__MES_VUE_BOOT__ = true;
initializeTheme();
const applicationBootStartedAt = performanceNow();
window.__MES_STOP_PERFORMANCE_MONITOR__ = startFrontendPerformanceMonitoring();

const app = createApp(App);
app.use(router);

void syncServerClock()
  .catch(() => {})
  .finally(() => {
    startServerClockSync();
    app.mount("#app");
    const recordFirstRender = () => recordPerformanceMetric(
      "app.first-render",
      performanceNow() - applicationBootStartedAt,
      { category: "render" },
    );
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(recordFirstRender);
    } else {
      queueMicrotask(recordFirstRender);
    }
  });
