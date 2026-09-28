<template>
  <section class="card data-settings-card backup-settings" aria-labelledby="backup-settings-title">
    <div class="data-section-heading">
      <div>
        <h3 id="backup-settings-title">试验数据备份设置</h3>
      </div>
      <span class="data-path-status" role="status">{{ loading ? "读取中…" : status.enabled ? "备份已启用" : "备份未启用" }}</span>
    </div>

    <p class="backup-current">当前生效路径：<span class="data-code" data-testid="backup-current">{{ status.destination || "未配置" }}</span></p>
    <form class="backup-form form-field" @submit.prevent="perform('saving')">
      <label for="test-data-backup-path">备份地址</label>
      <div class="backup-controls">
        <input
          id="test-data-backup-path"
          v-model="draft"
          class="data-code"
          data-testid="backup-path"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="\\服务器IP\共享名\试验数据"
          aria-describedby="backup-result"
          :aria-invalid="probe?.ok === false"
          :disabled="busy"
        />
        <button class="action-btn secondary" type="button" :disabled="busy" data-testid="backup-browse" @click="browse">
          {{ action === 'browsing' ? '选择中…' : '浏览' }}
        </button>
        <button class="action-btn secondary" type="button" :disabled="busy || !draft.trim()" data-testid="backup-check" @click="perform('checking')">
          {{ action === 'checking' ? '检测中…' : '检测路径与权限' }}
        </button>
        <button class="action-btn" type="submit" :disabled="busy || !draft.trim()" data-testid="backup-save">
          {{ action === 'saving' ? '检测并保存中…' : '保存并启用' }}
        </button>
      </div>
      <p v-if="dirty" class="helper backup-dirty" data-testid="backup-dirty">输入尚未保存，后台仍使用当前生效路径。</p>
    </form>

    <div id="backup-result" class="backup-result" aria-live="polite" :aria-busy="Boolean(action)">
      <p v-if="action === 'checking' || action === 'saving'" role="status">正在验证目录及读写权限，请稍候（网络检测最长约 15 秒）…</p>
      <p v-if="error" class="backup-error" role="alert" data-testid="backup-error">{{ error }}</p>
      <template v-if="probe">
        <p :class="probe.ok ? 'backup-success' : 'backup-error'" data-testid="backup-probe-result">{{ probe.detail }}</p>
        <ul v-if="probe.checks?.length" class="backup-checks" aria-label="路径检测结果">
          <li v-for="item in probe.checks" :key="item.label" :class="item.ok ? '' : 'backup-error'">
            {{ item.ok ? '通过' : '失败' }} · {{ item.label }}
          </li>
        </ul>
      </template>
      <p v-if="message" class="backup-success" data-testid="backup-message">{{ message }}</p>
    </div>

    <div class="backup-summary">
      <span v-if="status.counts">已备份 {{ status.counts.synced || 0 }} · 待备份 {{ status.counts.pending || 0 }} · 失败 {{ status.counts.failed || 0 }}</span>
      <span v-if="status.running">后台正在备份</span>
      <button class="action-btn secondary" type="button" :disabled="busy" data-testid="backup-refresh" @click="load(false)">刷新状态</button>
    </div>
    <p v-if="status.lastError" class="backup-error" role="alert">后台提示：{{ status.lastError }}</p>
    <p v-if="status.failures?.length" class="backup-error">最近备份失败：{{ status.failures[0].error }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { checkBackupPath, readBackupStatus, saveBackupPath, selectBackupDirectory } from "@/lib/testDataBackupApi";

const draft = ref("");
const status = ref({ enabled: false, destination: "" });
const loading = ref(true);
const action = ref("");
const error = ref("");
const message = ref("");
const probe = ref(null);
const busy = computed(() => loading.value || Boolean(action.value));
const dirty = computed(() => draft.value.trim() !== status.value.destination);
watch(draft, () => { probe.value = null; error.value = ""; message.value = ""; }, { flush: "sync" });

async function load(initial) {
  loading.value = true;
  error.value = "";
  try {
    status.value = await readBackupStatus();
    if (initial) draft.value = status.value.destination || "";
  } catch (failure) {
    error.value = failure?.message || "读取备份设置失败，请重试";
  } finally {
    loading.value = false;
  }
}

async function browse() {
  if (busy.value) return;
  action.value = "browsing";
  error.value = "";
  try {
    const selected = await selectBackupDirectory(draft.value);
    if (!selected.cancelled) draft.value = selected.backupPath;
  } catch (failure) {
    error.value = failure?.message || "无法浏览目录，请直接填写共享路径";
  } finally {
    action.value = "";
  }
}

async function perform(kind) {
  const requested = draft.value.trim();
  if (busy.value || !requested) return;
  action.value = kind;
  error.value = "";
  message.value = "";
  probe.value = null;
  try {
    const result = kind === "saving" ? await saveBackupPath(requested) : await checkBackupPath(requested);
    if (draft.value.trim() !== requested) return;
    if (kind === "saving") {
      status.value = result;
      draft.value = result.destination;
      probe.value = result.probe;
      message.value = "备份路径已保存，下一轮备份生效，无需重启。";
    } else {
      probe.value = result;
      if (result.ok) message.value = dirty.value ? "检测通过，尚未保存；点击“保存并启用”切换路径。" : "当前路径检测通过，备份配置未改变。";
    }
  } catch (failure) {
    if (draft.value.trim() === requested) {
      error.value = failure?.message || "操作失败，请检查路径后重试";
      probe.value = failure?.probe || null;
    }
  } finally {
    action.value = "";
  }
}

onMounted(() => { void load(true); });
</script>

<style scoped>
.backup-current { margin: 0; overflow-wrap: anywhere; }
.backup-form { display: grid; gap: 8px; min-width: 0; }
.backup-controls { display: flex; flex-wrap: wrap; gap: 12px; }
.backup-controls input { flex: 1 1 320px; min-width: 0; min-height: 46px; padding: 10px 14px; font-size: 14px; }
.backup-controls button, .backup-summary button { min-height: 46px; cursor: pointer; }
.backup-controls :focus-visible, .backup-summary button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.backup-controls :disabled, .backup-summary button:disabled { cursor: not-allowed; }
.backup-result { min-width: 0; overflow-wrap: anywhere; }
.backup-result p { margin: 0 0 8px; }
.backup-success { color: var(--accent); }
.backup-error { color: var(--danger); overflow-wrap: anywhere; }
.backup-dirty { margin: 0; color: var(--text); }
.backup-checks { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; padding: 0; list-style: none; font-size: 14px; }
.backup-summary { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.backup-summary button { margin-left: auto; }
@media (max-width: 600px) {
  .backup-controls input { flex-basis: 100%; }
  .backup-controls button { flex: 1 1 auto; }
  .backup-settings .data-section-heading { flex-wrap: wrap; }
  .backup-summary button { margin-left: 0; }
}
</style>
