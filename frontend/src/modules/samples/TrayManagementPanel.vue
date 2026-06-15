<template>
  <div class="tray-management-panel" :class="{ 'is-hidden': hidden }" data-testid="tray-management-panel">
    <div class="tray-management-layout">
      <section class="card section tray-management-workspace" data-testid="samples-trays-workspace">
        <div class="tray-management-head">
          <div>
            <h3>托盘信息</h3>
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
        <table class="table samples-trays-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>任务号</th>
              <th>托盘编号</th>
              <th>当前状态</th>
              <th>样品数</th>
              <th>样品编号</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="filteredTrayRows.length === 0">
              <td colspan="6" class="muted">暂无托盘数据</td>
            </tr>
            <tr
              v-for="(slot, index) in pagedTraySlots"
              :key="slot.key"
              :data-testid="`samples-trays-row-${index}`"
              :class="{
                'tray-row-active': slot.row?.trayCode === selectedTrayCode,
                'is-active': slot.row?.trayCode === selectedTrayCode,
                'samples-trays-row--placeholder': slot.isPlaceholder,
              }"
              @click="slot.row ? selectTray(slot.row.trayCode) : undefined"
            >
              <template v-if="slot.row">
              <td>{{ index + 1 }}</td>
              <td :data-testid="`samples-trays-task-code-${index}`">
                <div class="tray-code-stack">
                  <span class="tray-code-line">{{ slot.row.taskCode || "-" }}</span>
                </div>
              </td>
              <td :data-testid="`samples-trays-tray-code-${index}`">
                <div class="tray-code-stack">
                  <span class="tray-code-line">{{ slot.row.trayCode || "-" }}</span>
                </div>
              </td>
              <td>
                <div class="tray-current-status" :data-testid="`samples-trays-current-status-${index}`">
                  {{ slot.row.status || "-" }}
                </div>
              </td>
              <td>{{ slot.row.sampleCount }}</td>
              <td class="tray-sample-summary" :data-testid="`samples-trays-sample-codes-${index}`">
                <div class="tray-sample-lines" tabindex="0">
                  <span
                    v-for="sampleCode in visibleSampleCodes(slot.row)"
                    :key="`${slot.row.trayCode}-${sampleCode}`"
                    class="tray-sample-line"
                    :class="{ 'is-ellipsis': sampleCode === SAMPLE_CODES_ELLIPSIS }"
                  >
                    {{ sampleCode }}
                  </span>
                  <div
                    v-if="hasHiddenSampleCodes(slot.row)"
                    class="tray-sample-popover"
                    :data-testid="`samples-trays-sample-popover-${index}`"
                  >
                    <strong>全部样品编号</strong>
                    <span
                      v-for="sampleCode in allSampleCodes(slot.row)"
                      :key="`${slot.row.trayCode}-popover-${sampleCode}`"
                      class="tray-sample-popover-line"
                    >
                      {{ sampleCode }}
                    </span>
                  </div>
                </div>
              </td>
              </template>
              <td v-else colspan="6" aria-hidden="true">&nbsp;</td>
            </tr>
          </tbody>
        </table>
        <AppPagination
          v-if="trayPageCount > 1"
          :current-page="trayPage"
          :page-count="trayPageCount"
          @change="trayPage = $event"
        />
        <AppFeedback :message="samplesFlow.warning" tone="warning" @close="samplesFlow.clearWarning" />
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

        <section class="sample-flow-card section" data-testid="samples-tray-flow">
          <div class="sample-flow-title">统一托盘流程图</div>
          <ol class="sample-flow-unified sample-flow-unified--timed">
            <li
              v-for="(step, index) in selectedTrayFlow.steps"
              :key="step.key"
              :data-flow-step="index"
              :data-testid="`samples-tray-flow-step-${step.key}`"
              :class="{ current: step.active, reached: step.reached }"
            >
              <span class="sample-flow-label">{{ step.label }}</span>
              <span class="sample-flow-time">{{ formatFlowTime(step.time) }}</span>
            </li>
          </ol>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
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
const SAMPLE_CODES_ELLIPSIS = "...";
const SAMPLE_CODES_VISIBLE_LIMIT = 5;
const TRAY_PAGE_SIZE = 5;
const formatFlowTime = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace("T", " ")
    .replace(/\.\d{1,6}/, "")
    .replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
};

const TASK_FLOW_INDEX = new Map(TASK_FLOW_STEPS.map((step, index) => [step.label, index]));

const selectedTrayCode = ref("");
const selectedTaskCode = ref("");
const trayPage = ref(1);

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

const trayPageCount = computed(() => Math.max(1, Math.ceil(filteredTrayRows.value.length / TRAY_PAGE_SIZE)));
const safeTrayPage = computed(() => Math.min(Math.max(Number.parseInt(String(trayPage.value || 1), 10) || 1, 1), trayPageCount.value));
const pagedTrayRows = computed(() => {
  const startIndex = (safeTrayPage.value - 1) * TRAY_PAGE_SIZE;
  return filteredTrayRows.value.slice(startIndex, startIndex + TRAY_PAGE_SIZE);
});
const pagedTraySlots = computed(() => {
  const rows = pagedTrayRows.value.map((row) => ({ key: row.trayCode, row }));
  if (!filteredTrayRows.value.length) {
    return rows;
  }
  const placeholderCount = Math.max(0, TRAY_PAGE_SIZE - rows.length);
  return [
    ...rows,
    ...Array.from({ length: placeholderCount }, (_, index) => ({
      isPlaceholder: true,
      key: `placeholder-${safeTrayPage.value}-${index}`,
      row: null,
    })),
  ];
});

const allSampleCodes = (row) => {
  if (Array.isArray(row?.sampleCodes)) {
    return row.sampleCodes.map((code) => normalizeText(code)).filter(Boolean);
  }
  return normalizeText(row?.sampleSummary)
    .split(/[、,，/]+/)
    .map((code) => normalizeText(code))
    .filter(Boolean);
};

const hasHiddenSampleCodes = (row) => allSampleCodes(row).length > SAMPLE_CODES_VISIBLE_LIMIT;

const visibleSampleCodes = (row) => {
  const codes = allSampleCodes(row);
  if (!codes.length) {
    return ["-"];
  }
  if (codes.length <= SAMPLE_CODES_VISIBLE_LIMIT) {
    return codes;
  }
  return [...codes.slice(0, SAMPLE_CODES_VISIBLE_LIMIT - 1), SAMPLE_CODES_ELLIPSIS];
};

const selectTray = (trayCode) => {
  selectedTrayCode.value = String(trayCode || "").trim();
};

watch(
  () => selectedTaskCode.value,
  () => {
    trayPage.value = 1;
  },
);

watch(
  () => pagedTrayRows.value,
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
  const rows = pagedTrayRows.value;
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
    experimentRuns: props.samplesFlow.rawExperimentRuns,
    experimentRunTrays: props.samplesFlow.rawExperimentRunTrays,
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
