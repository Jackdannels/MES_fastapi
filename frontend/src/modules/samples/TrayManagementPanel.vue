<template>
  <div class="tray-management-panel" :class="{ 'is-hidden': hidden }" data-testid="tray-management-panel">
    <div class="tray-management-layout">
      <section class="card section tray-management-workspace" data-testid="samples-trays-workspace">
        <div class="tray-management-head">
          <div>
            <h3>托盘管理</h3>
            <div class="muted" data-testid="samples-trays-counter">剩余托盘/总托盘数 {{ trayCounterText }}</div>
          </div>
          <label class="tray-management-filter tray-management-filter-emphasis">
            <span>按任务号筛选</span>
            <select data-testid="samples-trays-task-filter" :value="selectedTaskCode" @change="setTaskFilter($event.target.value)">
              <option value="">全部任务</option>
              <option v-for="taskCode in taskCodeOptions" :key="taskCode" :value="taskCode">
                {{ taskCode }}
              </option>
            </select>
          </label>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>序号</th>
              <th>任务号</th>
              <th>托盘编号</th>
              <th>任务信息</th>
              <th>当前状态</th>
              <th>样品数</th>
              <th>样品编号</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredTrayRows.length === 0">
              <td colspan="7" class="muted">暂无托盘数据</td>
            </tr>
            <tr
              v-for="(row, index) in filteredTrayRows"
              :key="row.trayCode"
              :data-testid="`samples-trays-row-${index}`"
              :class="{ 'tray-row-active': row.trayCode === selectedTrayCode, 'is-active': row.trayCode === selectedTrayCode }"
              @click="selectTray(row.trayCode)"
            >
              <td>{{ index + 1 }}</td>
              <td :data-testid="`samples-trays-task-code-${index}`">{{ row.taskCode || "-" }}</td>
              <td>{{ row.trayCode }}</td>
              <td :data-testid="`samples-trays-task-${index}`">
                <div>{{ row.taskCode || "-" }}</div>
                <div class="muted">{{ row.taskName || row.testType || "-" }}</div>
              </td>
              <td>
                <select
                  class="tray-status-select"
                  :data-testid="`samples-trays-status-${index}`"
                  :value="row.status"
                  @click.stop
                  @change="updateTrayStatus(row.trayCode, $event.target.value)"
                >
                  <option v-for="status in samplesFlow.trayStatusOptions" :key="status" :value="status">
                    {{ status }}
                  </option>
                </select>
              </td>
              <td>{{ row.sampleCount }}</td>
              <td class="tray-sample-summary">{{ row.sampleSummary || "-" }}</td>
            </tr>
          </tbody>
        </table>
        <div class="form-alert" :class="{ 'is-hidden': !samplesFlow.warning }">{{ samplesFlow.warning }}</div>
      </section>

      <aside class="tray-management-sidebar" data-testid="samples-trays-flows">
        <section class="sample-flow-card section sample-flow-horizontal" data-testid="samples-task-flow">
          <div class="sample-flow-title">任务流程图</div>
          <div class="sample-flow-status" data-testid="samples-task-flow-status">{{ selectedTaskFlow.currentStatus }}</div>
          <ol class="sample-flow-unified">
            <li
              v-for="(step, index) in selectedTaskFlow.steps"
              :key="step.key"
              :data-flow-step="index"
              :data-testid="`samples-task-flow-step-${step.key}`"
              :class="{ current: step.active, reached: step.reached }"
            >
              {{ step.label }}
            </li>
          </ol>
        </section>

        <section class="sample-flow-card section">
          <div class="sample-flow-title">统一托盘流程图</div>
          <div class="sample-flow-status" data-testid="samples-tray-flow-status">{{ selectedTrayFlow.currentStatus }}</div>
          <ol class="sample-flow-unified">
            <li
              v-for="(step, index) in selectedTrayFlow.steps"
              :key="step.key"
              :data-flow-step="index"
              :data-testid="`samples-tray-flow-step-${step.key}`"
              :class="{ current: step.active, reached: step.reached }"
            >
              {{ step.label }}
            </li>
          </ol>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

import { SYSTEM_TRAY_TOTAL, getRemainingSystemTrayCount } from "@/lib/trayCapacity";
import { buildTrayFlowView } from "./samplesFlowModel";
import {
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  aggregateTaskStatusFromSamples,
  buildTaskExperimentProgress,
  buildTaskStatusLabel,
  normalizeText,
} from "../tasks/model.js";

const props = defineProps({
  hidden: {
    type: Boolean,
    default: false,
  },
  samplesFlow: {
    type: Object,
    required: true,
  },
});

const TASK_FLOW_STEPS = [
  { key: "waiting", label: STATUS_WAITING },
  { key: "scheduled", label: STATUS_SCHEDULED },
  { key: "running", label: STATUS_RUNNING },
  { key: "completed", label: STATUS_COMPLETED },
  { key: "returned", label: STATUS_RETENTION },
];

const TASK_FLOW_INDEX = new Map(TASK_FLOW_STEPS.map((step, index) => [step.label, index]));

const selectedTrayCode = ref("");
const selectedTaskCode = ref("");

const setTaskFilter = (taskCode) => {
  selectedTaskCode.value = String(taskCode || "").trim();
};

const taskCodeOptions = computed(() =>
  Array.from(
    new Set(
      (Array.isArray(props.samplesFlow.trayRows) ? props.samplesFlow.trayRows : [])
        .map((row) => String(row?.taskCode || "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN")),
);

const filteredTrayRows = computed(() => {
  const rows = Array.isArray(props.samplesFlow.trayRows) ? props.samplesFlow.trayRows : [];
  if (!selectedTaskCode.value) {
    return rows;
  }
  return rows.filter((row) => String(row?.taskCode || "").trim() === selectedTaskCode.value);
});

const trayCounterText = computed(() => {
  const occupiedCount = Array.isArray(props.samplesFlow.trayRows) ? props.samplesFlow.trayRows.length : 0;
  return `${getRemainingSystemTrayCount(occupiedCount)}/${SYSTEM_TRAY_TOTAL}`;
});

const selectTray = (trayCode) => {
  selectedTrayCode.value = String(trayCode || "").trim();
};

const updateTrayStatus = async (trayCode, status) => {
  selectTray(trayCode);
  await props.samplesFlow.updateTrayStatusInline(trayCode, status);
};

watch(
  () => filteredTrayRows.value,
  (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      selectedTrayCode.value = "";
      return;
    }
    if (!list.some((row) => row.trayCode === selectedTrayCode.value)) {
      selectedTrayCode.value = list[0].trayCode;
    }
  },
  { immediate: true, deep: true },
);

const selectedTray = computed(() => {
  const rows = filteredTrayRows.value;
  return rows.find((row) => row.trayCode === selectedTrayCode.value) || rows[0] || { trayCode: "", status: "样品运输中" };
});

const selectedTaskCodeForFlow = computed(() => normalizeText(selectedTray.value?.taskCode) || selectedTaskCode.value);

const selectedTask = computed(() =>
  (Array.isArray(props.samplesFlow.rawTasks) ? props.samplesFlow.rawTasks : []).find(
    (task) => normalizeText(task?.code) === selectedTaskCodeForFlow.value,
  ) || null,
);

const selectedTaskSamples = computed(() =>
  (Array.isArray(props.samplesFlow.rawSamples) ? props.samplesFlow.rawSamples : []).filter(
    (sample) => normalizeText(sample?.task_code) === selectedTaskCodeForFlow.value,
  ),
);

const selectedTaskStatus = computed(() => {
  const aggregatedStatus = aggregateTaskStatusFromSamples(selectedTask.value, selectedTaskSamples.value);
  const experimentProgress = buildTaskExperimentProgress(selectedTaskCodeForFlow.value, props.samplesFlow.rawExperiments);
  if (aggregatedStatus !== STATUS_RETENTION && experimentProgress.hasPartialCompletion) {
    return STATUS_RUNNING;
  }
  if (aggregatedStatus) {
    return aggregatedStatus;
  }
  return normalizeText(selectedTask.value?.status) || STATUS_WAITING;
});

const selectedTaskStatusLabel = computed(() =>
  buildTaskStatusLabel(
    selectedTaskStatus.value,
    buildTaskExperimentProgress(selectedTaskCodeForFlow.value, props.samplesFlow.rawExperiments),
  ),
);

const selectedTaskFlow = computed(() => {
  const currentStatus = TASK_FLOW_INDEX.has(selectedTaskStatus.value) ? selectedTaskStatus.value : STATUS_WAITING;
  const activeIndex = TASK_FLOW_INDEX.get(currentStatus) ?? 0;
  return {
    currentStatus: selectedTaskStatusLabel.value,
    steps: TASK_FLOW_STEPS.map((step, index) => ({
      ...step,
      active: index === activeIndex,
      reached: index <= activeIndex,
    })),
  };
});

const selectedTrayFlow = computed(() =>
  buildTrayFlowView({
    currentExperimentCode: "",
    experimentTrays: props.samplesFlow.rawExperimentTrays,
    experiments: props.samplesFlow.rawExperiments,
    location: selectedTray.value?.status === "已到达暂存间" ? "恒温恒湿间（暂存间）" : "",
    samples: props.samplesFlow.rawSamples,
    schedules: props.samplesFlow.rawSchedules,
    taskCode: selectedTray.value?.taskCode,
    trayCode: selectedTray.value?.trayCode,
    status: selectedTray.value?.status,
  }),
);
</script>
