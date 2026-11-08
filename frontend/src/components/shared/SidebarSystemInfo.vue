<template>
  <dl class="sidebar-system-info" data-testid="sidebar-system-info">
    <div><dt>系统版本</dt><dd data-testid="sidebar-system-version">v{{ version }}</dd></div>
    <div><dt>{{ desktop ? "本机局域网 IP" : "服务地址" }}</dt><dd data-testid="sidebar-lan-ip">{{ address }}</dd></div>
  </dl>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { version as webVersion } from "../../../package.json";
import { getDesktopModule } from "@/lib/desktopClient";

const desktop = getDesktopModule() === "central";
const normalizeAddresses = (values) => Array.isArray(values)
  ? [...new Set(values.filter(value => typeof value === "string" && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)))]
  : [];
const version = ref(desktop ? window.__MES_DESKTOP__.version : webVersion);
const ips = ref(desktop ? normalizeAddresses(window.__MES_DESKTOP__.localIpAddresses) : []);
const address = computed(() => desktop ? ips.value.join(" / ") || "未检测到局域网地址" : window.location.hostname || "本机访问");
let timer;
const bridge = typeof window !== "undefined" ? window.chrome?.webview : null;
const receiveInfo = (event) => {
  if (event.data?.type !== "mes-client-host-info") return;
  if (typeof event.data.version === "string") version.value = event.data.version;
  ips.value = normalizeAddresses(event.data.localIpAddresses);
};
const refreshInfo = () => bridge?.postMessage("mes-client-host-info-request");
onMounted(() => {
  if (!desktop || !bridge) return;
  bridge.addEventListener("message", receiveInfo);
  refreshInfo();
  timer = window.setInterval(refreshInfo, 30000);
});
onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
  if (desktop && bridge) bridge.removeEventListener("message", receiveInfo);
});
</script>
