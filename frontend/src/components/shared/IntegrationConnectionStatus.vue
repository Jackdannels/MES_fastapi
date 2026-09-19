<template>
  <div class="integration-connections" role="status" aria-live="polite" aria-label="外部系统连接状态">
    <div v-for="item in connections" :key="item.key" class="integration-connection" :title="item.detail">
      <span>{{ item.label }}</span>
      <span :class="`integration-connection__state integration-connection__state--${item.state}`">{{ labels[item.state] || labels.unknown }}</span>
      <span
        v-if="item.alert"
        class="integration-connection__alert"
        :class="{ 'integration-connection__alert--critical': item.alertSeverity === 'critical' }"
      >{{ item.alert }}</span>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";

const emit = defineEmits(["update"]);

const labels = { online: "已连接", offline: "未连接", partial: "部分连接", unknown: "未确认", checking: "检测中" };
const systems = [{ key: "lims", label: "LIMS" }, { key: "upper_computer", label: "上位机系统" }];
const connections = ref(systems.map((item) => ({ ...item, state: "checking", detail: "正在获取实际连接状态" })));
let timer;
let controller;
let stopped = false;

const refresh = async () => {
  if (stopped || controller || document.visibilityState === "hidden") return;
  controller = new AbortController();
  const timeout = window.setTimeout(() => controller?.abort(), 5000);
  try {
    const response = await fetch(buildApiUrl("/api/system/integrations", getFrontendApiBaseUrl()), {
      credentials: "include", cache: "no-store", signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Status unavailable");
    const payload = await response.json();
    if (!stopped && document.visibilityState !== "hidden") emit("update", payload);
    if (!stopped && document.visibilityState !== "hidden") connections.value = systems.map((item) => ({
      ...item,
      state: Object.hasOwn(labels, payload?.[item.key]?.state) ? payload[item.key].state : "unknown",
      detail: payload?.[item.key]?.detail || "未取得有效连接状态",
      alert: payload?.[item.key]?.alert || "",
      alertSeverity: payload?.[item.key]?.alert_severity || "",
    }));
  } catch {
    if (!stopped && document.visibilityState !== "hidden") emit("update", null);
    if (!stopped && document.visibilityState !== "hidden") connections.value = systems.map((item) => ({ ...item, state: "unknown", detail: "连接状态获取失败，不能确认外部系统是否在线" }));
  } finally {
    window.clearTimeout(timeout);
    controller = null;
    if (!stopped) timer = window.setTimeout(refresh, 3000);
  }
};

const resume = () => {
  if (document.visibilityState === "hidden") {
    emit("update", null);
    window.clearTimeout(timer);
    connections.value = systems.map((item) => ({ ...item, state: "unknown", detail: "页面处于后台，等待重新检测" }));
    controller?.abort();
    return;
  }
  window.clearTimeout(timer);
  void refresh();
};

onMounted(() => {
  emit("update", null);
  void refresh();
  document.addEventListener("visibilitychange", resume);
});
onBeforeUnmount(() => {
  emit("update", null);
  stopped = true;
  window.clearTimeout(timer);
  controller?.abort();
  document.removeEventListener("visibilitychange", resume);
});
</script>

<style scoped>
.integration-connections { display: grid; gap: 6px; font-size: 12px; }
.integration-connection { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; }
.integration-connection__state { color: var(--muted); }
.integration-connection__state--online { color: var(--status-success-text); }
.integration-connection__state--offline { color: var(--status-danger-text); }
.integration-connection__state--partial { color: var(--status-warning-text); }
.integration-connection__alert { flex-basis: 100%; color: var(--status-danger-text); overflow-wrap: anywhere; }
.integration-connection__alert--critical {
  position: relative;
  padding: 6px 8px;
  border: 1px solid var(--status-danger-border);
  border-radius: 4px;
  background: var(--status-danger-bg);
  font-weight: 700;
}
/* Pulse the red frame, never hide or dim the alarm text. */
.integration-connection__alert--critical::before {
  content: "";
  position: absolute;
  inset: -1px;
  border: 2px solid var(--status-danger-border);
  border-radius: inherit;
  box-shadow: 0 0 8px var(--status-danger-border);
  pointer-events: none;
  animation: integration-critical-pulse 1.6s ease-in-out infinite;
}
@keyframes integration-critical-pulse {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .integration-connection__alert--critical::before { animation: none; opacity: 1; }
}
</style>
