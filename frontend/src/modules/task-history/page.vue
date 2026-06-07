<template>
  <section class="history-task-page section">
    <div class="history-task-layout">
      <aside class="card history-task-list" data-testid="history-task-list">
        <div class="history-task-list__head">
          <h3>历史任务数据</h3>
          <span class="muted">含收回托盘任务 {{ historyTotalCount }}</span>
        </div>
        <div class="history-task-controls">
          <input
            v-model="historySearch"
            class="search-input history-task-search"
            data-testid="history-task-search"
            placeholder="搜索任务、托盘、样品"
            type="search"
          />
          <select
            v-model="historyDateRange"
            class="search-input history-task-range"
            data-testid="history-task-range"
          >
            <option value="">全部时间</option>
            <option value="7">7日内</option>
            <option value="30">30日内</option>
            <option value="180">180日内</option>
          </select>
        </div>
        <div v-if="loadError" class="form-alert">{{ loadError }}</div>
        <div v-if="pagedHistoryTasks.length === 0" class="history-empty muted">暂无历史任务数据</div>
        <button
          v-for="task in pagedHistoryTasks"
          :key="task.code"
          class="history-task-row"
          :class="{ active: selectedTaskCode === task.code }"
          :data-testid="`history-task-${task.code}`"
          type="button"
          @click="selectTask(task.code)"
        >
          <span class="history-task-row__code">{{ task.code || "-" }}</span>
          <span class="history-task-row__name">{{ task.name || "-" }}</span>
          <span class="history-task-row__meta">{{ task.trayCountText }} · {{ task.sampleCountText }}</span>
        </button>
        <AppPagination
          v-if="historyPageCount > 1"
          :current-page="historyPage"
          :page-count="historyPageCount"
          @change="historyPage = $event"
        />
      </aside>

      <aside class="history-task-side">
        <section class="card history-task-flow-card history-task-flow-card--horizontal" data-testid="history-task-flow-card">
          <template v-if="selectedTask">
            <div class="history-section-title">
              <h4>任务流程图</h4>
              <span class="muted">{{ selectedTask.status || "厂家收回" }}</span>
            </div>
            <div class="history-flow-strip">
              <div
                v-for="step in selectedTask.taskFlow"
                :key="`task-${step.label}`"
                class="history-flow-strip-item"
                :class="{ current: step.active, reached: step.reached }"
              >
                <span class="history-flow-label">{{ step.label }}</span>
                <span
                  class="history-flow-time"
                  :title="formatHistoryTime(step.time)"
                >
                  <span class="history-flow-time__date">
                    {{ formatHistoryDatePart(step.time) }}
                  </span>
                  <span class="history-flow-time__clock">
                    {{ formatHistoryClockPart(step.time) }}
                  </span>
                </span>
                <span class="history-flow-dot"></span>
              </div>
            </div>
          </template>
          <div v-else class="history-empty muted">请选择左侧历史任务查看任务流转信息</div>
        </section>

        <section class="card history-task-detail history-task-detail-card" data-testid="history-task-detail">
          <template v-if="selectedTask">
            <section class="history-tray-section history-tray-picker">
              <div class="history-tray-toolbar">
                <div class="history-tray-tabs" aria-label="选择托盘">
                  <button
                    v-for="tray in selectedTask.trays"
                    :key="tray.trayCode"
                    class="history-tray-tab"
                    :class="{ active: selectedTrayCode === tray.trayCode }"
                    :data-testid="`history-tray-${tray.trayCode}`"
                    type="button"
                    @click="selectTray(tray.trayCode)"
                  >
                    {{ tray.trayCode }}
                  </button>
                </div>
                <div v-if="selectedTray" class="history-tray-samples-summary">
                  <span>包含样品</span>
                  <div v-if="selectedTraySampleRows.length" class="history-tray-sample-list">
                    <div
                      v-for="(row, rowIndex) in selectedTraySampleRows"
                      :key="`sample-row-${rowIndex}`"
                      class="history-tray-sample-row"
                    >
                      <strong
                        v-for="sampleCode in row"
                        :key="sampleCode"
                        class="history-tray-sample-code"
                      >
                        {{ sampleCode }}
                      </strong>
                    </div>
                  </div>
                  <strong v-else class="history-tray-sample-code">暂无样品</strong>
                </div>
              </div>

              <div v-if="selectedTray" class="history-tray-detail">
                <div class="history-tray-unified-flow" data-testid="history-tray-unified-flow">
                  <div class="history-tray-flow-current">{{ selectedTrayFlow.currentStatus }}</div>
                  <div class="history-tray-flow-grid">
                    <div
                      v-for="(step, index) in selectedTrayFlow.steps"
                      :key="step.key || `${step.label}-${index}`"
                      class="history-tray-flow-step"
                      :class="{ current: step.active, reached: step.reached }"
                    >
                      <span class="history-flow-label">{{ step.label }}</span>
                      <span
                        class="history-flow-time"
                        :title="formatHistoryTime(step.time)"
                      >
                        <span class="history-flow-time__date">
                          {{ formatHistoryDatePart(step.time) }}
                        </span>
                        <span class="history-flow-time__clock">
                          {{ formatHistoryClockPart(step.time) }}
                        </span>
                      </span>
                      <span class="history-flow-dot"></span>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </template>
          <div v-else class="history-empty muted">请选择左侧历史任务查看托盘与流转信息</div>
        </section>
      </aside>
    </div>
  </section>
</template>

<script setup>
defineOptions({
  name: "TaskHistoryPage",
});

import { computed, onMounted, ref, watch } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import AppPagination from "@/components/shared/AppPagination.vue";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { readTasks } from "@/lib/tasksApi";
import { buildTrayFlowView } from "@/modules/samples/samplesFlowModel";

import {
  buildReturnedTaskHistoryView,
  formatHistoryClockPart,
  formatHistoryDatePart,
  formatHistoryTime,
} from "./model";

const tasks = ref([]);
const samples = ref([]);
const loadError = ref("");
const selectedTaskCode = ref("");
const selectedTrayCode = ref("");
const historySearch = ref("");
const historyDateRange = ref("");
const historyPage = ref(1);
const experiments = ref([]);
const experimentRuns = ref([]);
const experimentRunTrays = ref([]);
const experimentTrays = ref([]);
const schedules = ref([]);
const { loadSnapshot } = useStorageSnapshot([
  STORAGE_KEYS.samples,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.schedules,
]);

const historyView = computed(() => buildReturnedTaskHistoryView({
  filters: {
    days: historyDateRange.value,
    query: historySearch.value,
  },
  page: historyPage.value,
  pageSize: 8,
  tasks: tasks.value,
  samples: samples.value,
  experiments: experiments.value,
  experimentTrays: experimentTrays.value,
}));
const historyTasks = computed(() => historyView.value.tasks);
const pagedHistoryTasks = computed(() => historyTasks.value);
const historyTotalCount = computed(() => historyView.value.totalCount || 0);
const historyPageCount = computed(() => historyView.value.totalPages || 1);
const selectedTask = computed(() => historyTasks.value.find((task) => task.code === selectedTaskCode.value) || null);
const selectedTray = computed(() => selectedTask.value?.trays.find((tray) => tray.trayCode === selectedTrayCode.value) || null);
const selectedTraySampleRows = computed(() => {
  const codes = Array.isArray(selectedTray.value?.sampleCodes) ? selectedTray.value.sampleCodes : [];
  const rows = [];
  for (let index = 0; index < codes.length; index += 3) {
    rows.push(codes.slice(index, index + 3));
  }
  return rows;
});
const selectedTrayFlow = computed(() => {
  if (!selectedTray.value) {
    return buildTrayFlowView();
  }
  return buildTrayFlowView({
    experimentRuns: experimentRuns.value,
    experimentRunTrays: experimentRunTrays.value,
    experimentTrays: experimentTrays.value,
    experiments: experiments.value,
    location: selectedTray.value.status,
    samples: samples.value,
    schedules: schedules.value,
    status: selectedTray.value.status,
    taskCode: selectedTask.value?.code,
    trayCode: selectedTray.value.trayCode,
  });
});

const selectTask = (taskCode) => {
  selectedTaskCode.value = taskCode;
};

const selectTray = (trayCode) => {
  selectedTrayCode.value = trayCode;
};

watch(historyTasks, (nextTasks) => {
  if (!nextTasks.length) {
    selectedTaskCode.value = "";
    selectedTrayCode.value = "";
    return;
  }
  if (!nextTasks.some((task) => task.code === selectedTaskCode.value)) {
    selectedTaskCode.value = nextTasks[0].code;
  }
}, { immediate: true });

watch([historySearch, historyDateRange], () => {
  historyPage.value = 1;
});

watch(selectedTask, (task) => {
  if (!task?.trays?.length) {
    selectedTrayCode.value = "";
    return;
  }
  if (!task.trays.some((tray) => tray.trayCode === selectedTrayCode.value)) {
    selectedTrayCode.value = task.trays[0].trayCode;
  }
}, { immediate: true });

const refreshHistoryData = async () => {
  try {
    const [loadedTasks, snapshot] = await Promise.all([
      readTasks({ includeArchived: true }),
      loadSnapshot(),
    ]);
    tasks.value = Array.isArray(loadedTasks) ? loadedTasks : [];
    samples.value = Array.isArray(snapshot?.[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    experiments.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
    experimentRuns.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiment_runs]) ? snapshot[STORAGE_KEYS.experiment_runs] : [];
    experimentRunTrays.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiment_run_trays]) ? snapshot[STORAGE_KEYS.experiment_run_trays] : [];
    experimentTrays.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
    schedules.value = Array.isArray(snapshot?.[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
    loadError.value = "";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    loadError.value = detail ? `历史任务数据加载失败，${detail}` : "历史任务数据加载失败";
  }
};

useStorageSnapshotRefresh({
  keys: [
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_runs,
    STORAGE_KEYS.experiment_run_trays,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.staging_events,
  ],
  refresh: refreshHistoryData,
  debounceMs: 100,
});

onMounted(async () => {
  await refreshHistoryData();
});
</script>

<style scoped>
.history-task-page {
  margin-top: 0;
}

.history-task-layout {
  display: grid;
  grid-template-columns: minmax(360px, 0.95fr) minmax(0, 1.45fr);
  gap: 16px;
  align-items: start;
}

.history-task-side {
  display: grid;
  gap: 16px;
  align-content: start;
}

.history-task-list,
.history-task-detail {
  min-height: 420px;
}

.history-task-flow-card {
  container-name: history-task-flow;
  container-type: inline-size;
  min-height: 148px;
}

.history-task-list__head,
.history-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.history-task-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(118px, auto);
  gap: 8px;
  margin-top: 12px;
}

.history-task-row {
  width: 100%;
  margin-top: 10px;
  padding: 14px;
  border: 1px solid #d8e2ef;
  border-radius: 8px;
  background: #fff;
  color: #10233f;
  text-align: left;
  cursor: pointer;
}

.history-task-row.active {
  border-color: #38bdf8;
  background: #eff8ff;
}

.history-task-row__code,
.history-task-row__name,
.history-task-row__meta {
  display: block;
}

.history-task-row__code {
  font-weight: 800;
}

.history-task-row__name,
.history-task-row__meta {
  margin-top: 4px;
}

.history-task-row__meta {
  color: #64748b;
  font-size: 13px;
}

.history-flow-section,
.history-tray-section {
  margin-top: 24px;
}

.history-tray-section:first-child {
  margin-top: 0;
}

.history-flow-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 142px), 1fr));
  gap: 8px;
  margin-top: 12px;
}

.history-flow-strip-item {
  position: relative;
  display: grid;
  place-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 68px;
  padding: 12px 10px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  text-align: center;
}

.history-flow-strip-item::after {
  content: "";
  position: absolute;
  left: calc(100% - 1px);
  top: 50%;
  width: 10px;
  height: 2px;
  background: #cbd5e1;
  transform: translateY(-50%);
}

.history-flow-strip-item:last-child::after {
  display: none;
}

.history-flow-strip-item.reached,
.history-flow-strip-item.current {
  border-color: #86efac;
  background: #dcfce7;
}

.history-flow-strip-item.reached::after,
.history-flow-strip-item.current::after {
  background: #86efac;
}

.history-flow-strip-item .history-flow-dot {
  background: #94a3b8;
}

.history-flow-strip-item.reached .history-flow-dot,
.history-flow-strip-item.current .history-flow-dot {
  background: #22c55e;
}

.history-flow-strip-item.current .history-flow-label {
  color: #052e16;
}

.history-flow-strip .history-flow-time {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  justify-content: center;
  gap: 4px;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  font-size: 12px;
}

.history-flow-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.history-flow-item {
  display: grid;
  grid-template-columns: 14px minmax(120px, 1fr) minmax(150px, auto);
  gap: 10px;
  align-items: center;
  padding: 11px 12px;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  background: #f0f9ff;
}

.history-flow-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #0ea5e9;
}

.history-flow-label {
  display: -webkit-box;
  max-width: 100%;
  font-weight: 700;
  line-height: 1.35;
  overflow: hidden;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.history-flow-time {
  color: #475569;
  text-align: right;
  white-space: nowrap;
}

.history-flow-time__date,
.history-flow-time__clock {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-flow-time__clock {
  flex-shrink: 0;
}

.history-tray-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.history-tray-tab {
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
  color: #10233f;
  cursor: pointer;
}

.history-tray-tab.active {
  border-color: #22c55e;
  background: #ecfdf5;
  font-weight: 800;
}

.history-tray-detail {
  margin-top: 14px;
}

.history-tray-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(540px, max-content);
  gap: 12px;
  align-items: start;
}

.history-tray-samples-summary {
  display: grid;
  justify-items: end;
  gap: 5px;
  padding: 8px 0;
  color: #475569;
  font-size: 13px;
  text-align: right;
}

.history-tray-samples-summary span {
  font-weight: 700;
}

.history-tray-sample-list {
  display: grid;
  gap: 4px;
  justify-content: end;
}

.history-tray-sample-row {
  display: grid;
  grid-template-columns: repeat(3, max-content);
  gap: 6px 12px;
}

.history-tray-sample-code {
  max-width: 100%;
  color: #10233f;
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  white-space: nowrap;
}

.history-tray-unified-flow {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #f8fbff;
}

.history-tray-flow-current {
  color: #334155;
  font-weight: 800;
}

.history-tray-flow-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(142px, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.history-tray-flow-step {
  position: relative;
  display: grid;
  place-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 78px;
  padding: 12px 10px 10px;
  border: 1px solid #7dd3fc;
  border-radius: 8px;
  background: #e0f2fe;
  text-align: center;
}

.history-tray-flow-step::after {
  content: "";
  position: absolute;
  left: calc(100% - 1px);
  top: 50%;
  width: 10px;
  height: 2px;
  background: #7dd3fc;
  transform: translateY(-50%);
}

.history-tray-flow-step:last-child::after {
  display: none;
}

.history-tray-flow-step.reached,
.history-tray-flow-step.current {
  border-color: #86efac;
  background: #dcfce7;
}

.history-tray-flow-step.reached::after,
.history-tray-flow-step.current::after {
  background: #86efac;
}

.history-tray-flow-step .history-flow-dot {
  background: #38bdf8;
}

.history-tray-flow-step.reached .history-flow-dot,
.history-tray-flow-step.current .history-flow-dot {
  background: #22c55e;
}

.history-tray-flow-step.current .history-flow-label {
  color: #052e16;
}

.history-tray-flow-step .history-flow-time {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  justify-content: center;
  gap: 4px;
  overflow: hidden;
  min-height: 15px;
  color: #475569;
  font-size: 12px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-empty {
  padding: 24px 0;
}

@media (max-width: 900px) {
  .history-task-layout {
    grid-template-columns: 1fr;
  }

  .history-flow-strip {
    grid-template-columns: 1fr;
  }

  .history-flow-strip-item::after {
    left: 50%;
    top: calc(100% - 1px);
    width: 2px;
    height: 10px;
    transform: translateX(-50%);
  }

  .history-flow-item {
    grid-template-columns: 14px 1fr;
  }

  .history-flow-time {
    grid-column: 2;
    text-align: left;
  }

  .history-tray-toolbar {
    grid-template-columns: 1fr;
  }

  .history-tray-samples-summary {
    justify-items: start;
    text-align: left;
  }

  .history-tray-sample-row {
    grid-template-columns: 1fr;
    justify-content: start;
  }

  .history-tray-flow-grid {
    grid-template-columns: 1fr;
  }

  .history-tray-flow-step::after {
    left: 50%;
    top: calc(100% - 1px);
    width: 2px;
    height: 10px;
    transform: translateX(-50%);
  }
}

@container history-task-flow (max-width: 520px) {
  .history-flow-strip .history-flow-time__clock {
    display: none;
  }
}

/* Industrial blackbox skin: returned task history cards and flow nodes. */
.history-task-row,
.history-flow-strip-item,
.history-flow-item,
.history-tray-tab,
.history-tray-unified-flow,
.history-tray-flow-step,
.history-tray-sample-code {
  border-color: var(--border);
  background: var(--bg-panel-strong);
  color: var(--text);
}

.history-task-row.active,
.history-tray-tab.active,
.history-flow-strip-item.reached,
.history-flow-strip-item.current,
.history-tray-flow-step.reached,
.history-tray-flow-step.current {
  border-color: rgba(var(--industrial-accent-rgb), 0.55);
  background: rgba(var(--industrial-accent-rgb), 0.16);
  color: var(--accent);
}

.history-flow-strip-item::after,
.history-tray-flow-step::after {
  background: var(--border-strong);
}

.history-flow-strip-item.reached::after,
.history-flow-strip-item.current::after,
.history-tray-flow-step.reached::after,
.history-tray-flow-step.current::after {
  background: rgba(var(--industrial-accent-rgb), 0.58);
}

.history-flow-strip-item .history-flow-dot,
.history-tray-flow-step .history-flow-dot {
  background: var(--muted);
}

.history-flow-strip-item.reached .history-flow-dot,
.history-flow-strip-item.current .history-flow-dot,
.history-tray-flow-step.reached .history-flow-dot,
.history-tray-flow-step.current .history-flow-dot {
  background: var(--accent);
}

.history-flow-strip-item.current .history-flow-label,
.history-tray-flow-step.current .history-flow-label,
.history-tray-flow-current,
.history-task-row__code,
.history-task-row__name {
  color: var(--text);
}

.history-task-row__meta,
.history-flow-time,
.history-tray-flow-step .history-flow-time,
.history-tray-samples-summary {
  color: var(--muted);
}
</style>
