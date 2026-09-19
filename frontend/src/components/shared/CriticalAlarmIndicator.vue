<template>
  <button
    v-if="isCritical"
    ref="trigger"
    class="action-btn critical-alarm-trigger"
    type="button"
    data-testid="critical-alarm-trigger"
    aria-haspopup="dialog"
    :aria-expanded="open"
    aria-label="严重告警 1 条，查看 LIMS 通讯告警详情"
    @click="showDetails"
  >
    <span class="critical-alarm-dot" aria-hidden="true"></span>
    严重告警 <span class="critical-alarm-count">1</span>
  </button>
  <Teleport to="body">
    <AppModal
      ref="modal"
      :open="open"
      title="LIMS 通讯告警详情"
      class="critical-alarm-modal"
      content-class="critical-alarm-content"
      data-testid="critical-alarm-modal"
      @close="close"
      @keydown.tab="trapFocus"
    >
      <div class="critical-alarm-summary" :class="{ 'is-critical': isCritical }" role="status">
        <strong>{{ headline }}</strong>
        <p>{{ status?.detail || '暂时无法取得最新状态，请等待刷新；不能据此判断故障已恢复。' }}</p>
      </div>
      <dl v-if="details" class="critical-alarm-fields">
        <div><dt>故障开始（北京时间）</dt><dd>{{ timestamp(details.fault_since) }}</dd></div>
        <div><dt>故障持续</dt><dd>{{ duration }}</dd></div>
        <div><dt>自动重试</dt><dd>{{ details.retry_count ?? '—' }} 次 / 每 {{ details.retry_interval_seconds ?? '—' }} 秒</dd></div>
        <div><dt>下次检测 / 重试</dt><dd>{{ nextCheck }}</dd></div>
        <div><dt>MES → LIMS · HTTP</dt><dd>{{ linkLabel(details.http) }}</dd></div>
        <div><dt>LIMS → MES · RabbitMQ</dt><dd>{{ linkLabel(details.rabbitmq) }}</dd></div>
        <div><dt>最近检测（北京时间）</dt><dd>{{ timestamp(details.last_check_at) }}</dd></div>
        <div><dt>处理状态</dt><dd>{{ details.acknowledged ? '已知悉，等待故障恢复' : '未确认' }}</dd></div>
      </dl>
      <section v-if="history.length" class="critical-alarm-history">
        <h3>最近事件</h3>
        <ol>
          <li v-for="(entry, index) in history" :key="`${entry.at}-${entry.kind}-${index}`">
            <time>{{ timestamp(entry.at) }}</time>
            <span>{{ historyLabel(entry.kind) }} · {{ entry.detail }}</span>
          </li>
        </ol>
      </section>
      <p class="critical-alarm-note">确认已知悉不代表恢复，不停止自动重试或严重告警提醒。此弹窗不会改变当前页面的任务数据。</p>
      <p v-if="feedback" class="critical-alarm-feedback" :class="{ 'is-error': failed }" role="status">{{ feedback }}</p>
      <template #footer>
        <button
          class="action-btn secondary"
          type="button"
          data-testid="acknowledge-critical-alarm"
          :disabled="!isCritical || !details || details.acknowledged || submitting || submitted"
          @click="acknowledge"
        >{{ submitting ? '提交中…' : details?.acknowledged ? '已知悉' : submitted ? '等待后台确认' : '确认已知悉' }}</button>
        <button class="action-btn" type="button" data-testid="close-critical-alarm" @click="close">关闭</button>
      </template>
    </AppModal>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppModal from "./AppModal.vue";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";

const props = defineProps({ status: { type: Object, default: null } });
const open = ref(false);
const trigger = ref(null);
const modal = ref(null);
const feedback = ref("");
const failed = ref(false);
const submitting = ref(false);
const submitted = ref(false);
const now = ref(Date.now());
let offset = 0;
let timer = null;
let controller = null;
let disposed = false;
let previousOverflow = "";
const details = computed(() => props.status?.alert_details || null);
const isCritical = computed(() => props.status?.alert_severity === "critical");
const headline = computed(() => isCritical.value ? '严重告警' : details.value?.alarm === 'none' && details.value?.phase === 'online' ? '通讯已恢复' : props.status?.alert || '告警状态未确认');
const history = computed(() => Array.isArray(details.value?.history) ? details.value.history.slice(0, 10) : []);
const timestamp = (value) => typeof value === "number" && Number.isFinite(value)
  ? new Date(value * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";
const linkLabel = (value) => ({ online: "已连通", offline: "未连通", unknown: "未确认" })[value] || "未确认";
const historyLabel = (value) => ({ warning: "普通告警", critical: "升级严重告警", acknowledged: "人工已知悉", recovered: "恢复正常" })[value] || "状态变化";
const serverNow = computed(() => now.value / 1000 + offset);
const duration = computed(() => {
  if (typeof details.value?.fault_since !== "number") return "—";
  const seconds = Math.max(0, Math.floor(serverNow.value - details.value.fault_since));
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
});
const nextCheck = computed(() => typeof details.value?.next_check_at === "number" ? `${Math.max(0, Math.ceil(details.value.next_check_at - serverNow.value))} 秒` : "—");
watch(() => props.status, () => {
  offset = typeof details.value?.server_time === "number" ? details.value.server_time - Date.now() / 1000 : 0;
  now.value = Date.now();
}, { immediate: true });
watch(() => details.value?.fault_since, () => { submitted.value = false; feedback.value = ""; });

const showDetails = async () => {
  if (open.value) return;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  open.value = true;
  feedback.value = "";
  now.value = Date.now();
  timer = window.setInterval(() => { now.value = Date.now(); }, 1000);
  await nextTick();
  modal.value?.$el?.querySelector(".modal-close")?.focus();
};
const close = async () => {
  if (!open.value) return;
  open.value = false;
  document.body.style.overflow = previousOverflow;
  window.clearInterval(timer);
  timer = null;
  await nextTick();
  (trigger.value || document.querySelector(".page-header--central h1"))?.focus();
};
const trapFocus = (event) => {
  const buttons = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
  if (!buttons.length) { event.preventDefault(); return; }
  const index = buttons.indexOf(document.activeElement);
  if (event.shiftKey && index <= 0) { event.preventDefault(); buttons.at(-1).focus(); }
  else if (!event.shiftKey && (index < 0 || index === buttons.length - 1)) { event.preventDefault(); buttons[0].focus(); }
};
const acknowledge = async () => {
  if (!isCritical.value || submitting.value || submitted.value) return;
  submitting.value = true;
  failed.value = false;
  controller = new AbortController();
  const timeout = window.setTimeout(() => controller?.abort(), 5000);
  try {
    const response = await fetch(buildApiUrl("/api/system/integrations/lims/acknowledge", getFrontendApiBaseUrl()), {
      method: "POST", credentials: "include", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error(typeof result.detail === "string" ? result.detail : "确认失败，请稍后重试");
    if (!disposed) { submitted.value = true; feedback.value = result.message || "确认请求已提交，等待后台处理"; }
  } catch (error) {
    if (!disposed) { failed.value = true; feedback.value = error.name === "AbortError" ? "请求超时，确认结果未确定，请等待状态刷新后重试" : error.message; }
  } finally {
    window.clearTimeout(timeout);
    controller = null;
    if (!disposed) submitting.value = false;
  }
};
onBeforeUnmount(() => {
  disposed = true;
  if (open.value) document.body.style.overflow = previousOverflow;
  window.clearInterval(timer);
  controller?.abort();
});
</script>

<style>
.critical-alarm-trigger.action-btn {
  position: relative; gap: 10px; background: var(--status-danger-bg);
  color: var(--status-danger-text); border-color: var(--status-danger-border); min-height: 44px;
}
.critical-alarm-trigger::before {
  content: ""; position: absolute; inset: -1px; border: 2px solid var(--status-danger-border);
  border-radius: inherit; box-shadow: 0 0 8px var(--status-danger-border); pointer-events: none;
  animation: critical-header-pulse 1.6s ease-in-out infinite;
}
.critical-alarm-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--status-danger-text); }
.critical-alarm-count { padding-left: 10px; border-left: 1px solid var(--status-danger-border); font-variant-numeric: tabular-nums; }
.modal.critical-alarm-modal { z-index: 1300; align-items: center; justify-content: center; padding: 16px; }
.modal-content.critical-alarm-content { width: min(680px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; margin: 0; }
.critical-alarm-summary { padding: 14px; background: var(--surface-subtle); border: 1px solid var(--border); border-radius: var(--radius-control); }
.critical-alarm-summary.is-critical { color: var(--status-danger-text); background: var(--status-danger-bg); border-color: var(--status-danger-border); }
.critical-alarm-summary strong { font-size: 18px; }
.critical-alarm-summary p { margin: 8px 0 0; overflow-wrap: anywhere; }
.critical-alarm-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0 20px; margin: 18px 0; }
.critical-alarm-fields > div { padding: 10px 0; border-bottom: 1px solid var(--border); min-width: 0; }
.critical-alarm-fields dt { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
.critical-alarm-fields dd { margin: 0; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.critical-alarm-history h3 { font-size: 15px; }
.critical-alarm-history ol { list-style: none; padding: 0; margin: 0; max-height: 180px; overflow-y: auto; }
.critical-alarm-history li { display: grid; gap: 4px; margin: 10px 0; padding-left: 12px; border-left: 2px solid var(--border-strong); overflow-wrap: anywhere; }
.critical-alarm-history time, .critical-alarm-note { color: var(--muted); font-size: 12px; }
.critical-alarm-feedback.is-error { color: var(--status-danger-text); }
.critical-alarm-content .form-actions { flex-wrap: wrap; }
@keyframes critical-header-pulse { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .critical-alarm-trigger::before { animation: none; opacity: 1; } }
@media (max-width: 520px) { .critical-alarm-fields { grid-template-columns: 1fr; } }
</style>
