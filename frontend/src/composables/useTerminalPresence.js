import { onBeforeUnmount, onMounted, watch } from "vue";

import { readAuthSession } from "@/auth";
import { reportTerminalPage } from "@/lib/terminalControlApi";

const TERMINAL_PAGE_REPORT_INTERVAL_MS = 15 * 1000;

function useTerminalPresence({ pageTitle, route }) {
  let timer = null;

  const report = async () => {
    if (!readAuthSession()?.terminal_auth) {
      return;
    }
    const path = String(route?.fullPath || route?.path || "").trim();
    if (!path) {
      return;
    }
    try {
      await reportTerminalPage(path, String(pageTitle?.value || document.title || "").trim());
    } catch {
      // 页面上报失败不打断固定终端的业务操作，下一个周期自动重试。
    }
  };

  const stopRouteWatch = watch(
    () => route?.fullPath,
    () => void report(),
  );

  onMounted(() => {
    void report();
    timer = window.setInterval(() => void report(), TERMINAL_PAGE_REPORT_INTERVAL_MS);
  });

  onBeforeUnmount(() => {
    stopRouteWatch();
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  });
}

export { TERMINAL_PAGE_REPORT_INTERVAL_MS, useTerminalPresence };
