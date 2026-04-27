<template>
  <section class="history-task-page section">
    <div class="history-task-layout">
      <aside class="card history-task-list" data-testid="history-task-list">
        <div class="history-task-list__head">
          <h3>历史任务数据</h3>
          <span class="muted">已收回任务 {{ historyTasks.length }}</span>
        </div>
        <div v-if="loadError" class="form-alert">{{ loadError }}</div>
        <div v-if="historyTasks.length === 0" class="history-empty muted">暂无历史任务数据</div>
        <button
          v-for="task in historyTasks"
          :key="task.code"
          class="history-task-row"
          :class="{ active: selectedTaskCode === task.code }"
          :data-testid="`history-task-${task.code}`"
          type="button"
          @click="selectTask(task.code)"
        >
          <span class="history-task-row__code">{{ task.code || "-" }}</span>
          <span class="history-task-row__name">{{ task.name || "-" }}</span>
          <span class="history-task-row__meta">{{ task.trayCount }} 个托盘 · {{ task.sampleCount }} 个样品</span>
        </button>
      </aside>

      <section class="card history-task-detail" data-testid="history-task-detail">
        <template v-if="selectedTask">
          <div class="history-detail-head">
            <div>
              <h3>{{ selectedTask.code }}</h3>
              <div class="muted">{{ selectedTask.name || "-" }}</div>
            </div>
            <div class="history-status-pill">{{ selectedTask.status || "厂家收回" }}</div>
          </div>

          <section class="history-flow-section">
            <div class="history-section-title">
              <h4>任务流转信息</h4>
              <span class="muted">按流程节点汇总最新时间</span>
            </div>
            <div class="history-flow-list">
              <div v-for="step in selectedTask.taskFlow" :key="`task-${step.label}`" class="history-flow-item">
                <span class="history-flow-dot"></span>
                <span class="history-flow-label">{{ step.label }}</span>
                <span class="history-flow-time">{{ formatTime(step.time) }}</span>
              </div>
            </div>
          </section>

          <section class="history-tray-section">
            <div class="history-section-title">
              <h4>当前分配托盘</h4>
              <span class="muted">{{ selectedTask.trayCount }} 个托盘</span>
            </div>
            <div class="history-tray-tabs">
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

            <div v-if="selectedTray" class="history-tray-detail">
              <div class="history-tray-summary">
                <strong>{{ selectedTray.trayCode }}</strong>
                <span>{{ selectedTray.status || "-" }}</span>
                <span>{{ selectedTray.sampleCodes.join(" / ") || "暂无样品" }}</span>
              </div>
              <div class="history-flow-list history-flow-list--tray">
                <div v-for="step in selectedTray.flowSteps" :key="`tray-${selectedTray.trayCode}-${step.label}`" class="history-flow-item">
                  <span class="history-flow-dot"></span>
                  <span class="history-flow-label">{{ step.label }}</span>
                  <span class="history-flow-time">{{ formatTime(step.time) }}</span>
                </div>
              </div>
            </div>
          </section>
        </template>
        <div v-else class="history-empty muted">请选择左侧历史任务查看托盘与流转信息</div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { readTasks } from "@/lib/tasksApi";

import { buildReturnedTaskHistoryView } from "./model";

const tasks = ref([]);
const samples = ref([]);
const loadError = ref("");
const selectedTaskCode = ref("");
const selectedTrayCode = ref("");
const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.samples]);

const historyView = computed(() => buildReturnedTaskHistoryView({
  tasks: tasks.value,
  samples: samples.value,
}));
const historyTasks = computed(() => historyView.value.tasks);
const selectedTask = computed(() => historyTasks.value.find((task) => task.code === selectedTaskCode.value) || null);
const selectedTray = computed(() => selectedTask.value?.trays.find((tray) => tray.trayCode === selectedTrayCode.value) || null);

const selectTask = (taskCode) => {
  selectedTaskCode.value = taskCode;
};

const selectTray = (trayCode) => {
  selectedTrayCode.value = trayCode;
};

const formatTime = (value) => String(value || "-").replace("T", " ");

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

watch(selectedTask, (task) => {
  if (!task?.trays?.length) {
    selectedTrayCode.value = "";
    return;
  }
  if (!task.trays.some((tray) => tray.trayCode === selectedTrayCode.value)) {
    selectedTrayCode.value = task.trays[0].trayCode;
  }
}, { immediate: true });

onMounted(async () => {
  try {
    const [loadedTasks, snapshot] = await Promise.all([
      readTasks(),
      loadSnapshot(),
    ]);
    tasks.value = Array.isArray(loadedTasks) ? loadedTasks : [];
    samples.value = Array.isArray(snapshot?.[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    loadError.value = "";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    loadError.value = detail ? `历史任务数据加载失败，${detail}` : "历史任务数据加载失败";
  }
});
</script>

<style scoped>
.history-task-page {
  margin-top: 0;
}

.history-task-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.history-task-list,
.history-task-detail {
  min-height: 420px;
}

.history-task-list__head,
.history-detail-head,
.history-section-title,
.history-tray-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

.history-status-pill {
  padding: 7px 12px;
  border-radius: 999px;
  background: #dcfce7;
  color: #166534;
  font-weight: 800;
}

.history-flow-section,
.history-tray-section {
  margin-top: 24px;
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

.history-flow-list--tray .history-flow-item {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.history-flow-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #0ea5e9;
}

.history-flow-list--tray .history-flow-dot {
  background: #22c55e;
}

.history-flow-label {
  font-weight: 700;
}

.history-flow-time {
  color: #475569;
  text-align: right;
  white-space: nowrap;
}

.history-tray-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
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

.history-tray-summary {
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.history-empty {
  padding: 24px 0;
}

@media (max-width: 900px) {
  .history-task-layout {
    grid-template-columns: 1fr;
  }

  .history-flow-item {
    grid-template-columns: 14px 1fr;
  }

  .history-flow-time {
    grid-column: 2;
    text-align: left;
  }
}
</style>
