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
            <select class="search-input" data-testid="samples-trays-task-filter" :value="selectedTaskCode" @change="setTaskFilter($event.target.value)">
              <option value="">全部任务</option>
              <option v-for="taskCode in taskCodeOptions" :key="taskCode" :value="taskCode">
                {{ taskCode }}
              </option>
            </select>
          </label>
        </div>
        <div class="samples-trays-table-scroll">
          <table
            ref="trayTableRef"
            class="table samples-trays-table"
          >
            <colgroup>
              <col
                v-for="(column, index) in trayTableColumns"
                :key="column.key"
                :style="{ width: `${(columnWidths[index] / trayTableWidth) * 100}%` }"
              />
            </colgroup>
            <thead>
              <tr>
                <th
                  v-for="(column, index) in trayTableColumns"
                  :key="column.key"
                  :class="{ 'has-left-resizer': isResizableColumn(index - 1) }"
                >
                  <span>{{ column.label }}</span>
                  <span
                    v-if="isResizableColumn(index - 1)"
                    class="samples-trays-column-resizer"
                    :class="{ 'is-active': resizingColumnIndex === index - 1 }"
                    role="separator"
                    tabindex="0"
                    aria-orientation="vertical"
                    :aria-label="`调整“${trayTableColumns[index - 1].label}”列宽`"
                    :aria-valuemin="trayTableColumns[index - 1].minWidth"
                    :aria-valuemax="columnWidths[index - 1] + columnWidths[index] - trayTableColumns[index].minWidth"
                    :aria-valuenow="columnWidths[index - 1]"
                    :data-testid="`samples-trays-column-resizer-${trayTableColumns[index - 1].key}`"
                    @dblclick="resetColumnWidth(index - 1)"
                    @keydown="resizeColumnWithKeyboard(index - 1, $event)"
                    @pointerdown="startColumnResize(index - 1, $event)"
                  />
                </th>
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
                  <component
                    :is="sampleCode === SAMPLE_CODES_ELLIPSIS ? 'button' : 'span'"
                    v-for="sampleCode in visibleSampleCodes(slot.row)"
                    :key="`${slot.row.trayCode}-${sampleCode}`"
                    class="tray-sample-line"
                    :class="{ 'is-ellipsis': sampleCode === SAMPLE_CODES_ELLIPSIS }"
                    :type="sampleCode === SAMPLE_CODES_ELLIPSIS ? 'button' : undefined"
                    :aria-expanded="sampleCode === SAMPLE_CODES_ELLIPSIS ? sampleCodesPopoverIsOpen(slot.row) : undefined"
                    :aria-label="sampleCode === SAMPLE_CODES_ELLIPSIS ? '查看全部样品编号' : undefined"
                    @click.stop="sampleCode === SAMPLE_CODES_ELLIPSIS ? toggleSampleCodesPopover(slot.row) : undefined"
                  >
                    {{ sampleCode }}
                  </component>
                  <div
                    v-if="hasHiddenSampleCodes(slot.row) && sampleCodesPopoverIsOpen(slot.row)"
                    class="tray-sample-popover"
                    :class="{ 'is-above': samplePopoverOpensAbove(index) }"
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
        </div>
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
          <div
            v-if="selectedTrayFlow.displayRemark"
            class="sample-flow-status"
            data-testid="samples-tray-flow-remark"
          >
            备注：{{ selectedTrayFlow.displayRemark }}
          </div>
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

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
const TRAY_TABLE_COLUMN_STORAGE_KEY = "mes.samples.tray-table-column-widths";
const trayTableColumns = [
  { key: "sequence", label: "序号", defaultWidth: 80, minWidth: 64 },
  { key: "taskCode", label: "任务号", defaultWidth: 210, minWidth: 140 },
  { key: "trayCode", label: "托盘编号", defaultWidth: 220, minWidth: 150 },
  { key: "status", label: "当前状态", defaultWidth: 170, minWidth: 120 },
  { key: "sampleCount", label: "样品数", defaultWidth: 100, minWidth: 80 },
  { key: "sampleCodes", label: "样品编号", defaultWidth: 320, minWidth: 180 },
];
const FIRST_RESIZABLE_COLUMN_INDEX = 0;
const LAST_RESIZABLE_COLUMN_INDEX = trayTableColumns.length - 2;

const isResizableColumn = (index) =>
  index >= FIRST_RESIZABLE_COLUMN_INDEX && index <= LAST_RESIZABLE_COLUMN_INDEX;

const clampColumnWidth = (width, column) => {
  const numericWidth = Number(width);
  const normalizedWidth = Number.isFinite(numericWidth) ? numericWidth : column.defaultWidth;
  return Math.max(column.minWidth, Math.round(normalizedWidth));
};

const loadColumnWidths = () => {
  if (typeof window === "undefined") {
    return trayTableColumns.map((column) => column.defaultWidth);
  }
  try {
    const storedWidths = JSON.parse(window.localStorage.getItem(TRAY_TABLE_COLUMN_STORAGE_KEY) || "[]");
    if (!Array.isArray(storedWidths) || storedWidths.length !== trayTableColumns.length) {
      return trayTableColumns.map((column) => column.defaultWidth);
    }
    return trayTableColumns.map((column, index) => clampColumnWidth(storedWidths[index], column));
  } catch {
    return trayTableColumns.map((column) => column.defaultWidth);
  }
};

const trayTableRef = ref(null);
const columnWidths = ref(loadColumnWidths());
const resizingColumnIndex = ref(-1);
const trayTableWidth = computed(() => columnWidths.value.reduce((total, width) => total + width, 0));
let columnResizeStartX = 0;
let columnResizeStartWidth = 0;

const persistColumnWidths = () => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(TRAY_TABLE_COLUMN_STORAGE_KEY, JSON.stringify(columnWidths.value));
  } catch {
    // 浏览器禁用本地存储时仍保留当前页面内的列宽调整能力。
  }
};

const setColumnWidth = (index, width, persist = false) => {
  const column = trayTableColumns[index];
  if (!column || !isResizableColumn(index)) {
    return;
  }
  const nextWidths = [...columnWidths.value];
  const rightColumnIndex = index + 1;
  const rightColumn = trayTableColumns[rightColumnIndex];
  const pairWidth = nextWidths[index] + nextWidths[rightColumnIndex];
  const maximumLeftWidth = pairWidth - rightColumn.minWidth;
  const nextLeftWidth = Math.min(maximumLeftWidth, clampColumnWidth(width, column));
  nextWidths[index] = nextLeftWidth;
  nextWidths[rightColumnIndex] = pairWidth - nextLeftWidth;
  columnWidths.value = nextWidths;
  if (persist) {
    persistColumnWidths();
  }
};

const captureRenderedColumnWidths = () => {
  const headerCells = trayTableRef.value?.querySelectorAll("thead th");
  if (!headerCells || headerCells.length !== trayTableColumns.length) {
    return;
  }
  const measuredWidths = Array.from(headerCells, (cell) => Math.round(cell.getBoundingClientRect().width));
  if (measuredWidths.every((width) => width > 0)) {
    columnWidths.value = measuredWidths.map((width, index) => clampColumnWidth(width, trayTableColumns[index]));
  }
};

const finishColumnResize = () => {
  if (resizingColumnIndex.value < 0) {
    return;
  }
  resizingColumnIndex.value = -1;
  document.removeEventListener("pointermove", handleColumnResize);
  document.removeEventListener("pointerup", finishColumnResize);
  document.removeEventListener("pointercancel", finishColumnResize);
  document.documentElement.classList.remove("samples-column-resizing");
  persistColumnWidths();
};

const handleColumnResize = (event) => {
  if (resizingColumnIndex.value < 0) {
    return;
  }
  event.preventDefault();
  setColumnWidth(
    resizingColumnIndex.value,
    columnResizeStartWidth + Number(event.clientX - columnResizeStartX),
  );
};

const startColumnResize = (index, event) => {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  captureRenderedColumnWidths();
  resizingColumnIndex.value = index;
  columnResizeStartX = Number(event.clientX) || 0;
  columnResizeStartWidth = columnWidths.value[index];
  document.documentElement.classList.add("samples-column-resizing");
  document.addEventListener("pointermove", handleColumnResize, { passive: false });
  document.addEventListener("pointerup", finishColumnResize);
  document.addEventListener("pointercancel", finishColumnResize);
};

const resizeColumnWithKeyboard = (index, event) => {
  const step = event.shiftKey ? 30 : 10;
  const keyWidths = {
    ArrowLeft: columnWidths.value[index] - step,
    ArrowRight: columnWidths.value[index] + step,
    Home: trayTableColumns[index].minWidth,
    End: columnWidths.value[index] + columnWidths.value[index + 1] - trayTableColumns[index + 1].minWidth,
  };
  if (!Object.prototype.hasOwnProperty.call(keyWidths, event.key)) {
    return;
  }
  event.preventDefault();
  setColumnWidth(index, keyWidths[event.key], true);
};

const resetColumnWidth = (index) => {
  setColumnWidth(index, trayTableColumns[index].defaultWidth, true);
};

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
const openSampleCodesTrayCode = ref("");

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

const sampleCodesPopoverIsOpen = (row) =>
  Boolean(normalizeText(row?.trayCode) && openSampleCodesTrayCode.value === normalizeText(row?.trayCode));

const toggleSampleCodesPopover = (row) => {
  const trayCode = normalizeText(row?.trayCode);
  openSampleCodesTrayCode.value = openSampleCodesTrayCode.value === trayCode ? "" : trayCode;
};

const samplePopoverOpensAbove = (index) => index >= TRAY_PAGE_SIZE - 2;

const closeSampleCodesPopoverOnOutsideClick = (event) => {
  if (!openSampleCodesTrayCode.value) {
    return;
  }
  const target = event?.target;
  if (target instanceof Element && target.closest(".tray-sample-summary")) {
    return;
  }
  openSampleCodesTrayCode.value = "";
};

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

onMounted(() => {
  document.addEventListener("click", closeSampleCodesPopoverOnOutsideClick);
});

onBeforeUnmount(() => {
  finishColumnResize();
  document.removeEventListener("click", closeSampleCodesPopoverOnOutsideClick);
});

watch(
  () => selectedTaskCode.value,
  () => {
    trayPage.value = 1;
    openSampleCodesTrayCode.value = "";
  },
);

watch(
  () => safeTrayPage.value,
  () => {
    openSampleCodesTrayCode.value = "";
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
    experimentRunPauses: props.samplesFlow.rawExperimentRunPauses,
    experimentRuns: props.samplesFlow.rawExperimentRuns,
    experimentRunSteps: props.samplesFlow.rawExperimentRunSteps,
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
