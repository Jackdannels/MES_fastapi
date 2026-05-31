<template>
  <div class="visualization-page">
    <section class="visualization-toolbar" aria-label="可视化编排状态">
      <div class="visualization-heading">
        <div class="visualization-eyebrow">可视化管理</div>
        <h3>八屏可视化编排</h3>
        <div class="visualization-sync">2026-05-22 14:00 中控同步</div>
      </div>
      <div class="visualization-toolbar-actions">
        <div class="visualization-live-chip">
          <span class="visualization-live-dot"></span>
          实时监控
        </div>
        <button
          class="action-btn visual-preview-button"
          data-testid="visual-combined-preview-open"
          type="button"
          @click="openCombinedPreview"
        >
          全屏预览
        </button>
      </div>
    </section>

    <section class="visual-operations-summary" data-testid="visual-operations-summary" aria-label="八屏运行摘要">
      <div v-for="item in operationsSummary" :key="item.label" class="visual-summary-item">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </section>

    <section class="visual-screen-grid" aria-label="八屏缩略预览">
      <button
        v-for="(screen, index) in screenCards"
        :key="screen.key"
        class="visual-screen-card"
        data-testid="visual-screen-card"
        type="button"
        :aria-label="`放大${screen.name}`"
        @click="openSinglePreview(screen)"
      >
        <div class="visual-card-meta">
          <span class="visual-card-index">{{ formatScreenIndex(index) }}</span>
          <span class="visual-card-name">{{ screen.name }}</span>
          <span class="visual-card-status" :class="`tone-${screen.tone}`">{{ screen.status }}</span>
        </div>
        <div class="visual-screen-frame">
          <component
            :is="resolveScreenComponent(screen)"
            :screen="screen"
            :labs="defaultLabs"
            :lab-names="labNames"
            :schedule-view="scheduleView"
            :staging-view="stagingSamplesView"
            compact
          />
        </div>
      </button>
    </section>

    <div
      v-if="selectedScreen"
      class="visual-preview-overlay"
      data-testid="visual-single-preview"
      role="dialog"
      aria-modal="true"
      @click.self="closeSinglePreview"
    >
      <section class="visual-preview-shell is-screen-only">
        <button
          class="visual-screen-close"
          type="button"
          @click="closeSinglePreview"
        >
          关闭
        </button>
        <div class="visual-expanded-screen is-screen-only" :class="{ 'is-lab-process': selectedScreen.kind === 'lab-process' }">
          <component
            :is="resolveScreenComponent(selectedScreen)"
            :screen="selectedScreen"
            :labs="selectedLabs"
            :lab-names="labNames"
            :schedule-view="scheduleView"
            :staging-view="stagingSamplesView"
            :interactive="selectedScreen.kind === 'lab-process' || selectedScreen.kind === 'schedule-three-day' || selectedScreen.kind === 'staging-samples' || selectedScreen.kind === 'analysis'"
            @open-lab-picker="openLabPicker"
            @schedule-today="resetScheduleWindow"
            @schedule-window="shiftScheduleWindow"
          />
        </div>
        <div
          v-if="selectedScreen.kind === 'lab-process' && labPickerPosition"
          class="visual-lab-picker-overlay"
          data-testid="visual-lab-picker"
          role="dialog"
          aria-modal="true"
        >
          <section class="visual-lab-picker-panel">
            <div class="visual-lab-picker-head">
              <div>
                <div class="visual-board-kicker">LAB SELECT</div>
                <h3>{{ labPickerTitle }}</h3>
              </div>
              <button class="visual-lab-picker-close" type="button" @click="closeLabPicker">关闭</button>
            </div>
            <div class="visual-lab-picker-grid">
              <button
                v-for="lab in labPickerOptions"
                :key="lab.name"
                class="visual-lab-picker-option"
                :class="{ 'is-selected': lab.name === activePickerLabName }"
                data-testid="visual-lab-picker-option"
                type="button"
                @click="selectLabFromPicker(lab.name)"
              >
                <span>{{ lab.name }}</span>
                <strong>{{ lab.trayCount }} 托盘</strong>
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>

    <div
      v-if="combinedPreviewOpen"
      class="visual-preview-overlay visual-combined-overlay"
      data-testid="visual-combined-preview"
      role="dialog"
      aria-modal="true"
      @click.self="closeCombinedPreview"
    >
      <section
        class="visual-combined-shell is-fullscreen-merge"
        data-testid="visual-combined-shell"
        :style="combinedPreviewStyle"
      >
        <div class="visual-preview-header visual-combined-header">
          <div>
            <div class="visualization-eyebrow">全屏预览</div>
            <h3>八屏拼接展示</h3>
          </div>
          <button
            class="action-btn secondary visual-combined-close"
            data-testid="visual-combined-preview-close"
            type="button"
            @click="closeCombinedPreview"
          >
            关闭
          </button>
        </div>
        <div class="visual-combined-grid">
          <div
            v-for="screen in screenCards"
            :key="screen.key"
            class="visual-combined-screen"
            data-testid="visual-combined-screen"
          >
            <div class="visual-combined-stage" data-testid="visual-combined-stage">
              <div
                class="visual-combined-stage-scale"
                data-testid="visual-combined-stage-scale"
                :style="stageStyle"
              >
                <component
                  :is="resolveScreenComponent(screen)"
                  :screen="screen"
                  :labs="screen.kind === 'lab-process' ? selectedLabs : defaultLabs"
                  :lab-names="labNames"
                  :schedule-view="scheduleView"
                  :staging-view="stagingSamplesView"
                  :interactive="screen.kind === 'lab-process' || screen.kind === 'schedule-three-day' || screen.kind === 'staging-samples' || screen.kind === 'analysis'"
                  @open-lab-picker="openLabPicker"
                  @schedule-today="resetScheduleWindow"
                  @schedule-window="shiftScheduleWindow"
                />
              </div>
            </div>
          </div>
        </div>
        <div
          v-if="labPickerPosition"
          class="visual-lab-picker-overlay visual-combined-lab-picker"
          data-testid="visual-combined-lab-picker"
          role="dialog"
          aria-modal="true"
        >
          <section class="visual-lab-picker-panel">
            <div class="visual-lab-picker-head">
              <div>
                <div class="visual-board-kicker">LAB SELECT</div>
                <h3>{{ labPickerTitle }}</h3>
              </div>
              <button class="visual-lab-picker-close" type="button" @click="closeLabPicker">关闭</button>
            </div>
            <div class="visual-lab-picker-grid">
              <button
                v-for="lab in labPickerOptions"
                :key="lab.name"
                class="visual-lab-picker-option"
                :class="{ 'is-selected': lab.name === activePickerLabName }"
                data-testid="visual-lab-picker-option"
                type="button"
                @click="selectLabFromPicker(lab.name)"
              >
                <span>{{ lab.name }}</span>
                <strong>{{ lab.trayCount }} 托盘</strong>
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
defineOptions({
  name: "VisualizationPage",
});

import { computed, h, onMounted, onUnmounted, ref } from "vue";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import { buildLabProcessPanels, buildLabScheduleThreeDayView, buildStagingSamplesView, getVisualizationLabNames } from "./model";

const screenCards = [
  { key: "lab-process", name: "实验室流程监控屏", kind: "lab-process", status: "运行中", tone: "live" },
  {
    key: "lab-schedule-three-day",
    name: "三日实验室排期屏",
    kind: "schedule-three-day",
    status: "排程中",
    metric: "三日排期",
    accent: "cyan",
    tone: "sync",
  },
  {
    key: "today-plan",
    name: "今日任务计划屏",
    kind: "placeholder",
    status: "排程中",
    metric: "18 项计划",
    accent: "lime",
    tone: "live",
    indicators: [
      ["上午", "8"],
      ["下午", "7"],
      ["夜间", "3"],
    ],
  },
  {
    key: "sample-stat",
    name: "样品与托盘统计屏",
    kind: "placeholder",
    status: "同步中",
    metric: "96 件样品",
    accent: "amber",
    tone: "sync",
    indicators: [
      ["到货", "32"],
      ["试验", "48"],
      ["暂存", "16"],
    ],
  },
  {
    key: "today-task-plan-overview",
    name: "今日任务计划总览屏",
    kind: "today-task-plan",
    status: "模拟数据",
    metric: "6 项任务",
    accent: "cyan",
    tone: "live",
    indicators: [
      ["已分盘", "4"],
      ["待分盘", "2"],
      ["样品", "48"],
    ],
  },
  {
    key: "staging-samples",
    name: "暂存间样品信息屏",
    kind: "staging-samples",
    status: "实时快照",
    metric: "暂存样品",
    accent: "cyan",
    tone: "live",
    indicators: [
      ["托盘", String(SYSTEM_TRAY_TOTAL)],
      ["盐雾", "100"],
      ["霉菌", "100"],
    ],
  },
  {
    key: "exception",
    name: "异常告警屏",
    kind: "placeholder",
    status: "告警",
    metric: "2 条待处理",
    accent: "red",
    tone: "alert",
    indicators: [
      ["高", "0"],
      ["中", "1"],
      ["低", "1"],
    ],
  },
  {
    key: "archive",
    name: "设备状态与产品统计屏",
    kind: "analysis",
    status: "年初至今",
    metric: "设备健康 / 产品数",
    accent: "cyan",
    tone: "live",
    indicators: [
      ["正常率", "78.2%"],
      ["产品数", "449"],
      ["试验间", "10"],
    ],
  },
];

const { loadSnapshot } = useStorageSnapshot([
  STORAGE_KEYS.devices,
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.staging_events,
]);
const labNames = getVisualizationLabNames();
const rawSnapshot = ref({});

const selectedScreen = ref(null);
const selectedPrimaryLabName = ref(labNames[0] || "");
const selectedSecondaryLabName = ref(labNames[1] || "");
const combinedPreviewOpen = ref(false);
const viewportSize = ref({ height: 1080, width: 1920 });
const labPickerPosition = ref("");
const manualLabSelection = ref(false);
const labRandomSeed = ref(Math.random());
const scheduleWindowOffsetDays = ref(0);
const SCREEN_STAGE_WIDTH = 1920;
const SCREEN_STAGE_HEIGHT = 1080;
const COMBINED_COLUMNS = 4;
const COMBINED_ROWS = 2;
const COMBINED_GAP = 6;
const COMBINED_PADDING = 8;
const labScreens = computed(() => {
  const snapshot = rawSnapshot.value || {};
  return buildLabProcessPanels({
    labNames,
    tasks: snapshot[STORAGE_KEYS.tasks],
    samples: snapshot[STORAGE_KEYS.samples],
    experiments: snapshot[STORAGE_KEYS.experiments],
    experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
    schedules: snapshot[STORAGE_KEYS.schedules],
    devices: snapshot[STORAGE_KEYS.devices],
  });
});
const scheduleView = computed(() => {
  const snapshot = rawSnapshot.value || {};
  const anchorDate = new Date();
  anchorDate.setDate(anchorDate.getDate() + scheduleWindowOffsetDays.value);
  return buildLabScheduleThreeDayView({
    labNames,
    now: anchorDate,
    tasks: snapshot[STORAGE_KEYS.tasks],
    samples: snapshot[STORAGE_KEYS.samples],
    devices: snapshot[STORAGE_KEYS.devices],
    experiments: snapshot[STORAGE_KEYS.experiments],
    experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
    schedules: snapshot[STORAGE_KEYS.schedules],
  });
});
const stagingSamplesView = computed(() => {
  const snapshot = rawSnapshot.value || {};
  return buildStagingSamplesView({
    tasks: snapshot[STORAGE_KEYS.tasks],
    samples: snapshot[STORAGE_KEYS.samples],
    experiments: snapshot[STORAGE_KEYS.experiments],
    experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
    schedules: snapshot[STORAGE_KEYS.schedules],
    stagingEvents: snapshot[STORAGE_KEYS.staging_events],
  });
});
const operationsSummary = computed(() => [
  { label: "在线屏幕", value: "8/8" },
  { label: "监控试验间", value: labScreens.value.length },
  { label: "运行任务", value: labScreens.value.reduce((total, lab) => total + lab.taskCount, 0) },
  { label: "托盘流程", value: labScreens.value.reduce((total, lab) => total + lab.trayCount, 0) },
]);
const seededLabWeight = (lab, index) => {
  const textWeight = Array.from(String(lab?.name || "")).reduce((total, char) => total + char.charCodeAt(0), 0);
  const raw = Math.sin((labRandomSeed.value + 1) * (textWeight + index * 97 + 17)) * 10000;
  return raw - Math.floor(raw);
};
const labDisplayOrder = computed(() => {
  const labs = labScreens.value.slice();
  const hasTaskLabs = labs.some((lab) => lab.taskCount > 0 || lab.trayCount > 0);
  if (!hasTaskLabs) {
    return labs
      .map((lab, index) => ({ lab, weight: seededLabWeight(lab, index) }))
      .sort((left, right) => left.weight - right.weight)
      .map((entry) => entry.lab);
  }
  return labs.sort((left, right) => {
    const leftScore = left.taskCount * 10 + left.trayCount;
    const rightScore = right.taskCount * 10 + right.trayCount;
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return labNames.indexOf(left.name) - labNames.indexOf(right.name);
  });
});
const defaultLabs = computed(() => labDisplayOrder.value.slice(0, 2).filter(Boolean));
const selectedLabs = computed(() => [
  manualLabSelection.value
    ? labScreens.value.find((lab) => lab.name === selectedPrimaryLabName.value) || defaultLabs.value[0]
    : defaultLabs.value[0],
  manualLabSelection.value
    ? labScreens.value.find((lab) => lab.name === selectedSecondaryLabName.value) || defaultLabs.value[1]
    : defaultLabs.value[1],
].filter(Boolean));
const activePickerLabName = computed(() => {
  const index = labPickerPosition.value === "secondary" ? 1 : 0;
  return selectedLabs.value[index]?.name || "";
});
const excludedPickerLabName = computed(() => {
  const index = labPickerPosition.value === "secondary" ? 0 : 1;
  return selectedLabs.value[index]?.name || "";
});
const labPickerTitle = computed(() => (labPickerPosition.value === "secondary" ? "选择下方试验间" : "选择上方试验间"));
const labPickerOptions = computed(() => labScreens.value.filter((lab) => lab.name !== excludedPickerLabName.value));
const combinedScale = computed(() => {
  const availableWidth = Math.max(1, viewportSize.value.width - COMBINED_PADDING * 2 - COMBINED_GAP * (COMBINED_COLUMNS - 1));
  const availableHeight = Math.max(1, viewportSize.value.height - COMBINED_PADDING * 2 - COMBINED_GAP * (COMBINED_ROWS - 1));
  return Math.min(availableWidth / COMBINED_COLUMNS / SCREEN_STAGE_WIDTH, availableHeight / COMBINED_ROWS / SCREEN_STAGE_HEIGHT);
});
const combinedPreviewStyle = computed(() => ({
  "--visual-combined-scale": String(combinedScale.value),
}));
const stageStyle = {
  "--visual-stage-height": `${SCREEN_STAGE_HEIGHT}px`,
  "--visual-stage-width": `${SCREEN_STAGE_WIDTH}px`,
};
const mockTodayTaskPlans = [
  {
    taskCode: "SYLU-2026-0524-001",
    phase: "上午",
    state: "已分配",
    experiments: [
      { experimentType: "冲击试验", time: "09:00-11:30", lab: "冲击一室", trays: ["TP-001", "TP-002"], sampleCount: 8 },
      { experimentType: "振动试验", time: "13:00-16:00", lab: "振动一室", trays: ["TP-003"], sampleCount: 5 },
    ],
  },
  {
    taskCode: "SYLU-2026-0524-002",
    phase: "下午",
    state: "已分配",
    experiments: [
      { experimentType: "高低温湿热试验", time: "10:00-15:30", lab: "高低温湿热一室", trays: [], sampleCount: 12 },
      { experimentType: "盐雾试验", time: "15:40-19:00", lab: "盐雾试验室", trays: ["TP-004"], sampleCount: 9 },
    ],
  },
  {
    taskCode: "SYLU-2026-0524-003",
    phase: "夜间",
    state: "待分盘",
    experiments: [
      { experimentType: "霉菌试验", time: "16:00-19:30", lab: "霉菌试验室", trays: [], sampleCount: 6 },
      { experimentType: "四综合试验", time: "19:40-23:00", lab: "四综合实验室", trays: ["TP-005"], sampleCount: 8 },
    ],
  },
];

const openSinglePreview = (screen) => {
  selectedScreen.value = screen;
};

const closeSinglePreview = () => {
  selectedScreen.value = null;
  closeLabPicker();
};

const openCombinedPreview = () => {
  combinedPreviewOpen.value = true;
};

const closeCombinedPreview = () => {
  combinedPreviewOpen.value = false;
};

const formatScreenIndex = (index) => String(index + 1).padStart(2, "0");
const openLabPicker = (position) => {
  labPickerPosition.value = position === "secondary" ? "secondary" : "primary";
};
const closeLabPicker = () => {
  labPickerPosition.value = "";
};
const selectLabFromPicker = (labName) => {
  const nextName = String(labName || "").trim();
  if (!nextName || nextName === excludedPickerLabName.value) {
    return;
  }
  const currentSelectedLabs = selectedLabs.value;
  manualLabSelection.value = true;
  selectedPrimaryLabName.value = currentSelectedLabs[0]?.name || "";
  selectedSecondaryLabName.value = currentSelectedLabs[1]?.name || "";
  if (labPickerPosition.value === "secondary") {
    selectedSecondaryLabName.value = nextName;
  } else {
    selectedPrimaryLabName.value = nextName;
  }
  closeLabPicker();
};

const shiftScheduleWindow = (direction) => {
  scheduleWindowOffsetDays.value += direction === "previous" ? -1 : 1;
};
const resetScheduleWindow = () => {
  scheduleWindowOffsetDays.value = 0;
};

const resolveScreenComponent = (screen) => {
  if (screen?.kind === "lab-process") {
    return LabProcessScreen;
  }
  if (screen?.kind === "schedule-three-day") {
    return LabScheduleScreen;
  }
  if (screen?.kind === "today-task-plan") {
    return TodayTaskPlanScreen;
  }
  if (screen?.kind === "staging-samples") {
    return StagingSamplesScreen;
  }
  if (screen?.kind === "analysis") {
    return AnalysisScreen;
  }
  return PlaceholderScreen;
};

const refreshSnapshot = async () => {
  rawSnapshot.value = await loadSnapshot();
};
useStorageSnapshotRefresh({
  keys: [
    STORAGE_KEYS.devices,
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.staging_events,
  ],
  refresh: refreshSnapshot,
  debounceMs: 100,
});
const refreshViewportSize = () => {
  if (typeof window === "undefined") {
    return;
  }
  viewportSize.value = {
    height: window.innerHeight || SCREEN_STAGE_HEIGHT,
    width: window.innerWidth || SCREEN_STAGE_WIDTH,
  };
};

const buildLabTaskOptions = (lab) => {
  const taskMap = new Map();
  (lab?.trays || []).forEach((tray) => {
    const taskCode = String(tray?.taskCode || "-").trim() || "-";
    if (!taskMap.has(taskCode)) {
      taskMap.set(taskCode, { sampleCount: 0, taskCode, trays: [] });
    }
    const task = taskMap.get(taskCode);
    task.trays.push(tray);
    task.sampleCount += tray.sampleCodes?.length || tray.quantity || 0;
  });
  return Array.from(taskMap.values());
};

const findSelectedLabTask = (tasks, selectedTaskCode) =>
  tasks.find((task) => task.taskCode === selectedTaskCode) || tasks[0] || null;

const findSelectedLabTray = (trays, selectedTrayCode) =>
  trays.find((tray) => tray.trayCode === selectedTrayCode) || trays[0] || null;

const compactFlowSteps = (steps) => {
  const list = Array.isArray(steps) ? steps : [];
  if (list.length <= 7) {
    return list;
  }
  const activeIndex = list.findIndex((step) => step.active);
  if (activeIndex < 0) {
    return [...list.slice(0, 3), ...list.slice(-4)];
  }
  const compact = [
    ...list.slice(0, 2),
    ...list.slice(Math.max(0, activeIndex - 3), Math.min(list.length, activeIndex + 4)),
  ];
  return compact.filter((step, index) => compact.findIndex((item) => item.key === step.key && item.label === step.label) === index);
};

const formatBeijingFlowTime = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text.replace(/T/g, " ").replace(/\+08:00$/i, "");
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

onMounted(() => {
  refreshViewportSize();
  refreshSnapshot();
  window.addEventListener("mes:samples-updated", refreshSnapshot);
  window.addEventListener("resize", refreshViewportSize);
});

onUnmounted(() => {
  window.removeEventListener("mes:samples-updated", refreshSnapshot);
  window.removeEventListener("resize", refreshViewportSize);
});

const LabProcessScreen = {
  name: "LabProcessScreen",
  props: {
    screen: { type: Object, required: false, default: null },
    labs: { type: Array, required: true },
    compact: { type: Boolean, default: false },
    interactive: { type: Boolean, default: false },
  },
  emits: ["open-lab-picker"],
  setup(props, { emit }) {
    const selectedTaskCodes = ref({});
    const selectedTrayCodes = ref({});
    const setSelectedTask = (labName, taskCode) => {
      selectedTaskCodes.value = { ...selectedTaskCodes.value, [labName]: taskCode };
      selectedTrayCodes.value = { ...selectedTrayCodes.value, [labName]: "" };
    };
    const setSelectedTray = (labName, trayCode) => {
      selectedTrayCodes.value = { ...selectedTrayCodes.value, [labName]: trayCode };
    };

    return () =>
      h("div", { class: ["visual-board", props.compact ? "is-compact" : "", props.interactive && !props.compact ? "is-layout-a" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "LAB PROCESS"),
            h("div", { class: "visual-board-title" }, "例行试验站智能控制中心"),
          ]),
          h("div", { class: "visual-board-state" }, [
            h("span", { class: "visual-board-live" }, "LIVE"),
            h("span", { class: "visual-board-time" }, "2026-05-22 14:00:00"),
          ]),
        ]),
        h("div", { class: "visual-board-main" }, [
          h("div", { class: "visual-board-metrics" }, [
            h("div", [h("span", "监控试验间"), h("strong", props.labs.length)]),
            h("div", [h("span", "样品合计"), h("strong", props.labs.reduce((total, lab) => total + lab.sampleCount, 0))]),
            h("div", [h("span", "托盘流程"), h("strong", props.labs.reduce((total, lab) => total + lab.trayCount, 0))]),
          ]),
          h("div", { class: "visual-lab-panels" }, [
            ...props.labs.map((lab, labIndex) => {
              const taskOptions = buildLabTaskOptions(lab);
              const selectedTask = findSelectedLabTask(taskOptions, selectedTaskCodes.value[lab.name]);
              const selectedTray = findSelectedLabTray(selectedTask?.trays || [], selectedTrayCodes.value[lab.name]);
              const displayedTrays = props.compact ? (lab.trays || []).slice(0, 1) : selectedTray ? [selectedTray] : [];
              const displayedFlowSteps = selectedTray ? compactFlowSteps(selectedTray.steps) : [];

              return h("div", { class: "visual-lab-panel", key: lab.name }, [
                h("div", { class: "visual-lab-panel-head" }, [
                  h("div", [
                    h("div", { class: "visual-lab-name" }, lab.name),
                    h("div", { class: "visual-task-code" }, selectedTask?.taskCode || lab.task),
                  ]),
                  h("div", { class: "visual-lab-head-actions" }, [
                    props.interactive
                      ? h(
                        "button",
                        {
                          class: "visual-lab-cycle",
                          "data-testid": labIndex === 0 ? "visual-lab-cycle-primary" : "visual-lab-cycle-secondary",
                          type: "button",
                          onClick: () => emit("open-lab-picker", labIndex === 0 ? "primary" : "secondary"),
                        },
                        "切换试验间",
                      )
                      : null,
                    h("div", { class: ["visual-lab-state", lab.alert ? "is-alert" : "is-ok"] }, lab.alert ? "复核" : "正常"),
                  ]),
                ]),
                props.interactive && !props.compact && taskOptions.length
                  ? h("div", { class: "visual-lab-switchboard" }, [
                    h("div", { class: "visual-lab-switch-group" }, [
                      h("span", "任务切换"),
                      h("div", { class: "visual-lab-switch-options" }, taskOptions.map((task) =>
                        h(
                          "button",
                          {
                            class: ["visual-lab-switch-option", task.taskCode === selectedTask?.taskCode ? "is-active" : ""],
                            "data-testid": "visual-lab-task-option",
                            type: "button",
                            onClick: () => setSelectedTask(lab.name, task.taskCode),
                          },
                          [h("strong", task.taskCode), h("small", `${task.trays.length} 托盘`)],
                        ),
                      )),
                    ]),
                    selectedTask?.trays?.length
                      ? h("div", { class: "visual-lab-switch-group" }, [
                        h("span", "托盘切换"),
                        h("div", { class: "visual-lab-switch-options" }, selectedTask.trays.map((tray) =>
                          h(
                            "button",
                            {
                              class: ["visual-lab-switch-option", tray.trayCode === selectedTray?.trayCode ? "is-active" : ""],
                              "data-testid": "visual-lab-tray-option",
                              type: "button",
                              onClick: () => setSelectedTray(lab.name, tray.trayCode),
                            },
                            [h("strong", tray.trayCode), h("small", tray.status || "-")],
                          ),
                        )),
                      ])
                      : null,
                  ])
                  : null,
                h("div", { class: "visual-tray-flow-list" }, [
                  ...(displayedTrays.length
                    ? displayedTrays.map((tray) =>
                      h("div", { class: "visual-tray-flow", key: tray.trayCode }, [
                        h("div", { class: "visual-tray-flow-head" }, [
                          h("strong", `任务编号：${tray.taskCode}`),
                          h("span", `托盘编号：${tray.trayCode}`),
                        ]),
                        h(
                          "div",
                          { class: "visual-flow-line" },
                          (props.compact ? tray.steps : tray.steps || displayedFlowSteps).map((step) =>
                            h("div", { class: ["visual-flow-step", stepClass(step)] }, [
                              h("span", { class: "visual-flow-dot" }),
                              h("strong", step.label),
                              h("small", formatBeijingFlowTime(step.time)),
                            ]),
                          ),
                        ),
                      ]),
                    )
                    : [h("div", { class: "visual-empty-tray-flow" }, "暂无托盘流程")]),
                ]),
                h("div", { class: "visual-lab-status-row" }, [
                  h("div", { class: "visual-side-metric" }, [h("span", "样品 / 托盘"), h("strong", `${selectedTask?.sampleCount ?? lab.sampleCount}/${selectedTask?.trays?.length ?? lab.trayCount}`)]),
                  h("div", { class: "visual-side-metric" }, [h("span", "当前状态"), h("strong", selectedTray?.status || lab.state)]),
                ]),
                lab.alert ? h("div", { class: "visual-alert-strip" }, lab.alert) : h("div", { class: "visual-ok-strip" }, lab.trayCount ? "运行正常" : "等待托盘"),
              ]);
            }),
          ]),
        ]),
      ]);
  },
};

const scheduleStateLabel = (state) => {
  const normalized = String(state || "").trim();
  if (normalized === "running") {
    return "进行中";
  }
  if (normalized === "conflict") {
    return "冲突";
  }
  if (normalized === "completed") {
    return "已完成";
  }
  if (normalized === "idle") {
    return "空闲";
  }
  if (normalized === "maintenance") {
    return "维护中";
  }
  if (normalized === "disabled") {
    return "停用";
  }
  return "已排程";
};

const compactTimeRange = (value) => {
  const matches = String(value || "").match(/\d{2}:\d{2}/g) || [];
  return matches.length >= 2 ? `${matches[0]}-${matches.at(-1)}` : String(value || "").trim();
};

const renderScheduleItem = (item, slot, compact) =>
  h("div", { class: "visual-schedule-task", style: item?.color ? { "--schedule-task-color": item.color } : null }, [
    h("strong", item?.taskCode || slot.label || "-"),
    compact ? null : h("span", item?.experimentLabel || "-"),
    h("small", compactTimeRange(item?.timeRange || slot.title)),
  ]);

const renderScheduleSlot = (slot, compact) => {
  const items = Array.isArray(slot?.items) ? slot.items : [];
  const visibleItems = items.length ? items.slice(0, compact ? 1 : 2) : [];
  const stateLabel = scheduleStateLabel(slot.state);
  const isPlainCell = stateLabel === "已排程" || stateLabel === "空闲";
  const isStatusOnlyCell = visibleItems.length === 0 && ["maintenance", "disabled"].includes(String(slot?.state || "").trim());
  return h("div", { class: ["visual-schedule-slot", `state-${slot.state || "idle"}`, stateLabel === "已排程" ? "is-planned" : "", stateLabel === "空闲" ? "is-idle" : "", slot.displayMode === "conflict" ? "is-conflict" : ""] }, [
    isPlainCell || isStatusOnlyCell ? null : h("div", { class: "visual-schedule-slot-state" }, stateLabel),
    ...(visibleItems.length
      ? visibleItems.map((item) => renderScheduleItem(item, slot, compact))
      : isStatusOnlyCell
        ? [h("div", { class: "visual-schedule-status-only" }, stateLabel)]
        : slot.state !== "idle"
        ? [h("div", { class: "visual-schedule-task" }, [h("strong", slot.label || "-"), h("small", compactTimeRange(slot.title))])]
        : [h("div", { class: "visual-schedule-idle" }, "空闲")]),
    slot.overflowCount > 0 ? h("div", { class: "visual-schedule-overflow" }, `+${slot.overflowCount}`) : null,
  ]);
};

const LabScheduleScreen = {
  name: "LabScheduleScreen",
  props: {
    compact: { type: Boolean, default: false },
    interactive: { type: Boolean, default: false },
    scheduleView: { type: Object, required: true },
    screen: { type: Object, required: false, default: null },
  },
  emits: ["schedule-today", "schedule-window"],
  setup(props, { emit }) {
    return () => {
      const view = props.scheduleView || { dayCounts: [], days: [], rows: [], summary: {} };
      const rows = Array.isArray(view.rows) ? view.rows.slice(0, props.compact ? 5 : 10) : [];
      return h("div", { class: ["visual-board", "visual-schedule-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "SCHEDULE MATRIX"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "三日实验室排期屏"),
          ]),
          h("div", { class: "visual-schedule-head-actions" }, [
            props.interactive && !props.compact
              ? h("div", { class: "visual-schedule-nav", "aria-label": "切换排期日期窗口" }, [
                h(
                  "button",
                  {
                    "aria-label": "回到今日排期",
                    "data-testid": "visual-schedule-today",
                    type: "button",
                    onClick: () => emit("schedule-today"),
                  },
                  "今",
                ),
                h(
                  "button",
                  {
                    "aria-label": "查看前三日排期",
                    "data-testid": "visual-schedule-prev",
                    type: "button",
                    onClick: () => emit("schedule-window", "previous"),
                  },
                  "‹",
                ),
                h(
                  "button",
                  {
                    "aria-label": "查看后三日排期",
                    "data-testid": "visual-schedule-next",
                    type: "button",
                    onClick: () => emit("schedule-window", "next"),
                  },
                  "›",
                ),
              ])
              : null,
            h("div", { class: ["visual-board-live", "tone-sync"] }, "三日窗口"),
          ]),
        ]),
        h("div", { class: "visual-schedule-main" }, [
          h("div", { class: "visual-board-metrics visual-schedule-metrics" }, [
            h("div", [h("span", "三日排程"), h("strong", view.summary?.total ?? 0)]),
            h("div", [h("span", "进行中"), h("strong", view.summary?.running ?? 0)]),
            h("div", [h("span", "冲突"), h("strong", view.summary?.conflicts ?? 0)]),
            props.compact ? null : h("div", [h("span", "空闲实验室"), h("strong", view.summary?.idleLabs ?? 0)]),
          ]),
          h("div", { class: "visual-schedule-days" }, (view.dayCounts || []).map((day) =>
            h("div", { class: "visual-schedule-day", key: day.key }, [
              h("strong", day.dateLabel || day.label),
              h("small", `${day.count} 项`),
            ]),
          )),
          h("div", { class: "visual-schedule-grid", style: { "--visual-schedule-row-count": String(Math.max(rows.length, 1)) } }, [
            h("div", { class: "visual-schedule-grid-head visual-schedule-lab-head" }, "实验室"),
            ...(view.days || []).flatMap((day) => [
              h("div", { class: "visual-schedule-grid-head", key: `${day.key}-am` }, `${day.dateLabel || day.label} 上午`),
              h("div", { class: "visual-schedule-grid-head", key: `${day.key}-pm` }, `${day.dateLabel || day.label} 下午`),
            ]),
            ...(rows.length
              ? rows.flatMap((row) => [
                h("div", { class: "visual-schedule-lab-name", key: `${row.device}-name` }, row.device),
                ...row.slots.map((slot) => h("div", { class: "visual-schedule-cell", key: slot.key }, renderScheduleSlot(slot, props.compact))),
              ])
              : [h("div", { class: "visual-schedule-empty" }, "暂无排期")]),
          ]),
        ]),
      ]);
    };
  },
};

const taskPlanTrayText = (entry) => (entry.trays?.length ? entry.trays.join(" / ") : "待分配托盘");
const flattenTaskPlanRows = (tasks) =>
  tasks.flatMap((task) =>
    (task.experiments || []).map((experiment) => ({
      ...experiment,
      taskCode: task.taskCode,
    })),
  );
const taskPlanSummary = (tasks) => ({
  assigned: flattenTaskPlanRows(tasks).filter((row) => row.trays?.length).length,
  pending: flattenTaskPlanRows(tasks).filter((row) => !row.trays?.length).length,
  experiments: tasks.reduce((total, task) => total + (task.experiments?.length || 0), 0),
  samples: tasks.reduce((total, task) => total + (task.experiments || []).reduce((sum, experiment) => sum + experiment.sampleCount, 0), 0),
  types: new Set(tasks.flatMap((task) => (task.experiments || []).map((experiment) => experiment.experimentType))).size,
});
const taskPlanExperimentText = (task) => (task.experiments || []).map((experiment) => experiment.experimentType).join(" / ");
const taskPlanCompactTrayText = (task) => {
  const trays = (task.experiments || []).flatMap((experiment) => experiment.trays || []);
  return trays.length ? trays.join(" / ") : "待分配托盘";
};

const TodayTaskPlanScreen = {
  name: "TodayTaskPlanScreen",
  props: {
    compact: { type: Boolean, default: false },
    screen: { type: Object, required: false, default: null },
  },
  setup(props) {
    return () => {
      const tasks = mockTodayTaskPlans;
      const taskRows = flattenTaskPlanRows(tasks);
      const summary = taskPlanSummary(tasks);
      const visibleTasks = props.compact ? tasks.slice(0, 3) : tasks;

      return h("div", { class: ["visual-board", "visual-task-plan-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "TODAY PLAN"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "今日任务计划总览屏"),
          ]),
          h("div", { class: ["visual-board-live", "tone-live"] }, props.compact ? "05" : "模拟数据"),
        ]),
        h("div", { class: "visual-task-plan-main" }, [
          h("div", { class: "visual-board-metrics visual-task-plan-metrics" }, [
            h("div", [h("span", "今日任务"), h("strong", tasks.length)]),
            h("div", [h("span", "实验计划"), h("strong", summary.experiments)]),
            h("div", [h("span", "已分配托盘"), h("strong", summary.assigned)]),
            props.compact ? null : h("div", [h("span", "样品总数"), h("strong", `${summary.samples}件`)]),
          ]),
          props.compact
            ? h("div", { class: "visual-task-plan-compact-list" }, visibleTasks.map((task) =>
              h("div", { class: "visual-task-plan-compact-row", key: task.taskCode }, [
                h("strong", task.taskCode),
                h("span", taskPlanExperimentText(task)),
                h("small", taskPlanCompactTrayText(task)),
              ]),
            ))
            : h("div", { class: "visual-task-plan-single" }, [
              h("section", { class: "visual-task-plan-variant is-table is-focused" }, [
                h("div", { class: "visual-task-plan-variant-head" }, [
                  h("strong", "方案A"),
                  h("span", "任务实验一行式总览"),
                ]),
                h("div", { class: "visual-task-plan-table" }, [
                  h("div", { class: "visual-task-plan-table-head is-flat" }, ["任务编号", "实验类型", "时间", "试验间", "托盘信息", "样品数"].map((label) => h("span", label))),
                  ...taskRows.map((row) =>
                    h("div", { class: "visual-task-plan-row is-flat", key: `${row.taskCode}-${row.experimentType}` }, [
                      h("strong", row.taskCode),
                      h("span", row.experimentType),
                      h("span", row.time),
                      h("span", row.lab),
                      h("span", { class: row.trays.length ? "has-tray" : "is-pending" }, taskPlanTrayText(row)),
                      h("span", `${row.sampleCount}件`),
                    ]),
                  ),
                ]),
              ]),
            ]),
        ]),
      ]);
    };
  },
};

const StagingSamplesScreen = {
  name: "StagingSamplesScreen",
  props: {
    compact: { type: Boolean, default: false },
    interactive: { type: Boolean, default: false },
    screen: { type: Object, required: false, default: null },
    stagingView: { type: Object, required: false, default: null },
  },
  setup(props) {
    const selectedTaskCode = ref("");
    const selectedTrayCode = ref("");
    const modalTray = ref(null);
    const selectTask = (taskCode) => {
      selectedTaskCode.value = taskCode;
      selectedTrayCode.value = "";
      modalTray.value = null;
    };
    const selectTray = (trayCode) => {
      selectedTrayCode.value = trayCode;
      modalTray.value = null;
    };
    const openSamplesModal = (tray) => {
      modalTray.value = tray;
    };
    const closeSamplesModal = () => {
      modalTray.value = null;
    };

    return () => {
      const view = props.stagingView || { summary: {}, tasks: [] };
      const tasks = Array.isArray(view.tasks) ? view.tasks : [];
      const selectedTask = findSelectedLabTask(tasks, selectedTaskCode.value);
      const selectedTray = findSelectedLabTray(selectedTask?.trays || [], selectedTrayCode.value);
      const visibleTasks = props.compact ? tasks.slice(0, 3) : tasks;
      const visibleTrays = props.compact ? (selectedTask?.trays || tasks.flatMap((task) => task.trays || [])).slice(0, 3) : (selectedTask?.trays || []);
      const summary = view.summary || {};
      const overviewMetrics = [
        { label: "当前任务", value: summary.totalTaskCount ?? 0 },
        { label: "暂存托盘", value: summary.totalTrayCount ?? 0 },
        { label: "样品总数", value: summary.totalSampleCount ?? 0 },
      ];
      const capacityMetrics = [
        { capacity: SYSTEM_TRAY_TOTAL, key: "tray", label: "托盘剩余", shortageLabel: "托盘库存不足", usedLabel: "已用托盘", value: summary.trayRemaining ?? SYSTEM_TRAY_TOTAL, used: summary.usedSystemTrayCount ?? 0 },
        { capacity: 100, key: "salt", label: "盐雾剩余", shortageLabel: "盐量库存不足", usedLabel: "已用盐量", value: summary.saltSprayRemaining ?? 100, used: summary.saltSprayTrayCount ?? 0 },
        { capacity: 100, key: "mold", label: "霉菌剩余", shortageLabel: "菌体库存不足", usedLabel: "已用菌体", value: summary.moldRemaining ?? 100, used: summary.moldTrayCount ?? 0 },
      ];

      return h("div", { class: ["visual-board", "visual-staging-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "STAGING BUFFER"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "暂存间样品信息屏"),
          ]),
          h("div", { class: "visual-board-state" }, [
            h("span", { class: ["visual-board-live", "tone-live"] }, props.compact ? "06" : "实时快照"),
            props.compact ? null : h("span", { class: "visual-board-time" }, `托盘基准 ${SYSTEM_TRAY_TOTAL}`),
          ]),
        ]),
        h("div", { class: "visual-staging-overview", "data-testid": "visual-staging-overview" }, overviewMetrics.map((metric) =>
          h("div", { class: "visual-staging-overview-item", key: metric.label }, [
            h("span", metric.label),
            h("strong", metric.value),
          ]),
        )),
        h("div", { class: "visual-staging-layout" }, [
          h("section", { class: "visual-staging-task-rail" }, [
            h("div", { class: "visual-staging-section-title" }, "任务切换"),
            visibleTasks.length
              ? h("div", { class: "visual-staging-task-list" }, visibleTasks.map((task) =>
                props.compact
                  ? h("div", { class: "visual-staging-task-option", key: task.taskCode }, [
                    h("strong", task.taskCode),
                    h("small", `${task.trayCount}托盘 / ${task.sampleCount}样品`),
                  ])
                  : h(
                    "button",
                    {
                      class: ["visual-staging-task-option", task.taskCode === selectedTask?.taskCode ? "is-active" : ""],
                      "data-testid": "visual-staging-task-option",
                      type: "button",
                      onClick: () => selectTask(task.taskCode),
                    },
                    [
                      h("strong", task.taskCode),
                      h("span", task.taskName || task.taskCode),
                      h("small", `${task.trayCount}托盘 / ${task.sampleCount}样品`),
                    ],
                  ),
              ))
              : h("div", { class: "visual-staging-empty" }, "暂无暂存间任务"),
          ]),
          h("section", { class: "visual-staging-main" }, [
            h("div", { class: "visual-staging-main-head" }, [
              h("div", [
                h("div", { class: "visual-staging-section-title" }, "托盘切换"),
                h("strong", selectedTask?.taskCode || "暂无任务"),
              ]),
              h("span", `${selectedTask?.trayCount || 0} 托盘 / ${selectedTask?.sampleCount || 0} 样品`),
            ]),
            h("div", { class: "visual-staging-tray-switch" }, visibleTrays.length
              ? visibleTrays.map((tray) =>
                props.compact
                  ? h("div", { class: "visual-staging-tray-option", key: tray.trayCode }, [
                    h("strong", tray.trayCode),
                    h("small", `${tray.sampleCount}样品`),
                  ])
                  : h(
                    "button",
                    {
                      class: ["visual-staging-tray-option", tray.trayCode === selectedTray?.trayCode ? "is-active" : ""],
                      "data-testid": "visual-staging-tray-option",
                      type: "button",
                      onClick: () => selectTray(tray.trayCode),
                    },
                    [
                      h("strong", tray.trayCode),
                      h("span", tray.experimentType),
                      h("small", tray.status),
                    ],
                  ),
              )
              : [h("div", { class: "visual-staging-empty" }, "暂无托盘")]),
            selectedTray
              ? h("div", { class: "visual-staging-tray-detail" }, [
                h("div", { class: "visual-staging-tray-detail-head" }, [
                  h("div", [
                    h("span", selectedTray.taskCode),
                    h("strong", selectedTray.trayCode),
                  ]),
                  h("div", { class: "visual-staging-tray-status" }, selectedTray.status),
                ]),
                h("div", { class: "visual-staging-tray-meta" }, [
                  h("div", [h("span", "实验类型"), h("strong", selectedTray.experimentType)]),
                  h("div", [h("span", "样品数量"), h("strong", `${selectedTray.sampleCount}件`)]),
                ]),
                h("div", { class: "visual-staging-sample-grid" }, [
                  ...(selectedTray.visibleSampleCodes || []).map((sampleCode) =>
                    h("span", { class: "visual-staging-sample-code", key: sampleCode }, sampleCode),
                  ),
                  selectedTray.overflowSampleCount > 0 && props.interactive && !props.compact
                    ? h(
                      "button",
                      {
                        class: "visual-staging-all-samples",
                        "data-testid": "visual-staging-all-samples",
                        type: "button",
                        onClick: () => openSamplesModal(selectedTray),
                      },
                      `全部样品 +${selectedTray.overflowSampleCount}`,
                    )
                    : null,
                ]),
              ])
              : h("div", { class: "visual-staging-empty is-detail" }, "暂无暂存间样品"),
          ]),
          h("aside", { class: "visual-staging-capacity" }, [
            h("div", { class: "visual-staging-section-title" }, "剩余容量"),
            ...capacityMetrics.map((metric) => {
              const percent = Math.max(0, Math.min(100, ((Number(metric.value) || 0) / metric.capacity) * 100));
              const activeTickCount = percent <= 0 ? 0 : Math.max(1, Math.ceil(percent / 10));
              const isLowStock = percent <= 10;
              return h("div", { class: ["visual-staging-capacity-card", isLowStock ? "is-low-stock" : ""], "data-testid": "visual-staging-capacity-card", key: metric.key }, [
                h("span", metric.label),
                h("strong", metric.value),
                h("small", `${metric.usedLabel} ${metric.used}`),
                h("div", { class: "visual-staging-capacity-ticks", "aria-label": `${metric.label} ${metric.value}` }, Array.from({ length: 10 }, (_, index) =>
                  h("span", {
                    class: ["visual-staging-capacity-tick", index < activeTickCount ? "is-active" : ""],
                    key: `${metric.key}-tick-${index}`,
                  }),
                )),
                isLowStock
                  ? h("div", { class: "visual-staging-low-stock" }, [
                    h("span", { class: "visual-staging-alert-icon", "data-testid": "visual-staging-capacity-alert" }, "!"),
                    h("b", metric.shortageLabel),
                  ])
                  : null,
              ]);
            }),
          ]),
        ]),
        modalTray.value && props.interactive && !props.compact
          ? h("div", { class: "visual-staging-modal", "data-testid": "visual-staging-sample-modal", role: "dialog", "aria-modal": "true", onClick: closeSamplesModal }, [
            h("section", { class: "visual-staging-modal-panel", onClick: (event) => event.stopPropagation() }, [
              h("div", { class: "visual-staging-modal-head" }, [
                h("div", [
                  h("span", modalTray.value.taskCode),
                  h("strong", modalTray.value.trayCode),
                ]),
                h("button", { "data-testid": "visual-staging-modal-close", type: "button", onClick: closeSamplesModal }, "关闭"),
              ]),
              h("div", { class: "visual-staging-modal-grid" }, (modalTray.value.sampleCodes || []).map((sampleCode) =>
                h("span", { key: sampleCode }, sampleCode),
              )),
            ]),
          ])
          : null,
      ]);
    };
  },
};

const ANALYSIS_PRODUCT_COUNTS = {
  "振动一室": 72,
  "高低温湿热一室": 46,
  "盐雾试验室": 58,
  "冲击一室": 34,
  "霉菌试验室": 63,
  "四综合实验室": 41,
  "冲击二室": 29,
  "温度冲击二室": 36,
  "温度冲击一室": 31,
  "振动二室": 39,
};
const ANALYSIS_COLORS = ["#2563eb", "#f97316", "#16a34a", "#ef4444", "#a855f7", "#eab308", "#0891b2", "#db2777", "#65a30d", "#dc2626"];
const analysisStatusRows = [
  { color: "#2dd4bf", count: 86, label: "正常", percent: 78.2 },
  { color: "#f59e0b", count: 15, label: "维护", percent: 13.6 },
  { color: "#ef4444", count: 9, label: "停用", percent: 8.2 },
  { color: "#64748b", count: 46, label: "占用", percent: 42 },
];
const analysisTimePresets = ["今日", "本周", "本月", "年初至今", "自定义"];
const analysisTimeConfigs = {
  今日: { label: "今日", granularity: "按小时", range: "今日 · 2026-05-28", scale: 0.12 },
  本周: { label: "本周", granularity: "按日", range: "本周 · 2026-05-25 至 2026-05-28", scale: 0.36 },
  本月: { label: "本月", granularity: "按日/周", range: "本月 · 2026-05-01 至 2026-05-28", scale: 0.68 },
  年初至今: { label: "年初至今", granularity: "按月", range: "年初至今 · 2026-01-01 至 2026-05-28", scale: 1 },
};
const analysisCustomModes = [
  { control: "date", granularity: "按小时", key: "day", label: "按天", range: "自定义 · 按天 · 2026-05-28", scale: 0.12, value: "2026-05-28" },
  { control: "month", granularity: "按日/周", key: "month", label: "按月", range: "自定义 · 按月 · 2026-05", scale: 0.68, value: "2026-05" },
  { control: "number", granularity: "按月", key: "year", label: "按年", range: "自定义 · 按年 · 2026", scale: 1, value: "2026" },
  { control: "range", granularity: "按日", key: "range", label: "时间段", range: "自定义 · 时间段 · 2026-05-01 至 2026-05-28", scale: 0.48, value: "2026-05-01" },
];
const padCalendarPart = (value) => String(value).padStart(2, "0");
const parseCalendarDate = (value, fallback = "2026-05-28") => {
  const [fallbackYear, fallbackMonth, fallbackDay] = fallback.split("-");
  const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return {
    day: matched?.[3] || fallbackDay,
    month: matched?.[2] || fallbackMonth,
    year: matched?.[1] || fallbackYear,
  };
};
const getCalendarMonthDayCount = (year, month) => new Date(Number(year), Number(month), 0).getDate();
const buildAnalysisCalendarDayOptions = (year, month) =>
  Array.from({ length: getCalendarMonthDayCount(year, month) }, (_, index) => {
    const day = padCalendarPart(index + 1);
    return { label: `${index + 1}日`, value: day };
  });
const clampCalendarDay = (year, month, day) => padCalendarPart(Math.min(Math.max(Number(day) || 1, 1), getCalendarMonthDayCount(year, month)));
const analysisCalendarMonths = Array.from({ length: 12 }, (_, index) => {
  const month = String(index + 1).padStart(2, "0");
  return { label: `${index + 1}月`, value: `2026-${month}` };
});
const analysisCalendarMonthOptions = Array.from({ length: 12 }, (_, index) => {
  const month = padCalendarPart(index + 1);
  return { label: `${index + 1}月`, value: month };
});
const analysisCalendarYears = Array.from({ length: 10 }, (_, index) => 2021 + index);
const ANALYSIS_CALENDAR_WHEEL_STEP_DELTA = 240;

const polarPoint = (centerX, centerY, radius, angle) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: centerX + Math.cos(radians) * radius,
    y: centerY + Math.sin(radians) * radius,
  };
};

const describePieSlice = (centerX, centerY, radius, startAngle, endAngle) => {
  const start = polarPoint(centerX, centerY, radius, startAngle);
  const end = polarPoint(centerX, centerY, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x.toFixed(1)} ${start.y.toFixed(1)}`,
    `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    "Z",
  ].join(" ");
};

const buildAnalysisLabRows = (labNames, scale = 1) => {
  const names = (Array.isArray(labNames) && labNames.length ? labNames : Object.keys(ANALYSIS_PRODUCT_COUNTS)).filter(Boolean);
  return names.map((name, index) => ({
    color: ANALYSIS_COLORS[index % ANALYSIS_COLORS.length],
    name,
    value: Math.max(1, Math.round((ANALYSIS_PRODUCT_COUNTS[name] || Math.max(18, 42 - index * 2)) * scale)),
  }));
};

const buildPieSegments = (rows) => {
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  let cursor = 0;
  return rows.map((row) => {
    const startAngle = cursor;
    const endAngle = cursor + (row.value / total) * 360;
    cursor = endAngle;
    const midAngle = (startAngle + endAngle) / 2;
    const guideStart = polarPoint(380, 278, 172, midAngle);
    const guideEnd = polarPoint(380, 278, 246, midAngle);
    const textX = Math.max(42, Math.min(718, guideEnd.x));
    const textY = Math.max(34, Math.min(522, guideEnd.y));
    return {
      ...row,
      anchor: textX < 380 ? "end" : "start",
      guide: `M ${guideStart.x.toFixed(1)} ${guideStart.y.toFixed(1)} L ${textX.toFixed(1)} ${textY.toFixed(1)}`,
      path: describePieSlice(380, 278, 158, startAngle, endAngle),
      textX,
      textY,
    };
  });
};

const AnalysisScreen = {
  name: "AnalysisScreen",
  props: {
    compact: { type: Boolean, default: false },
    interactive: { type: Boolean, default: false },
    labNames: { type: Array, required: false, default: () => [] },
    screen: { type: Object, required: false, default: null },
  },
  setup(props) {
    const customMenuOpen = ref(false);
    const activePicker = ref("day");
    const activeRangeSide = ref("start");
    const calendarCursor = ref({ day: "28", month: "05", year: "2026" });
    const customValues = ref({
      day: "2026-05-28",
      month: "2026-05",
      rangeEnd: "2026-05-28",
      rangeStart: "2026-05-01",
      year: "2026",
    });
    const calendarWheelDelta = ref({ day: 0, month: 0, year: 0 });
    const selectedCustomMode = ref(null);
    const selectedTimePreset = ref("年初至今");
    const syncCalendarCursor = (value) => {
      const parsed = parseCalendarDate(value, customValues.value.day);
      calendarCursor.value = {
        month: parsed.month,
        day: parsed.day,
        year: parsed.year,
      };
    };
    const getCalendarCursorDate = (cursor = calendarCursor.value) =>
      `${cursor.year}-${cursor.month}-${clampCalendarDay(cursor.year, cursor.month, cursor.day)}`;
    const commitCalendarCursorDate = (cursor = calendarCursor.value) => {
      const value = getCalendarCursorDate(cursor);
      if (activePicker.value === "range") {
        customValues.value[activeRangeSide.value === "end" ? "rangeEnd" : "rangeStart"] = value;
        selectedCustomMode.value = resolveCustomMode("range");
        return;
      }
      if (activePicker.value === "day") {
        customValues.value.day = value;
        selectedCustomMode.value = resolveCustomMode("day");
      }
    };
    const updateCalendarCursor = (partial, shouldCommit = true) => {
      const nextCursor = {
        ...calendarCursor.value,
        ...partial,
      };
      nextCursor.day = clampCalendarDay(nextCursor.year, nextCursor.month, nextCursor.day);
      calendarCursor.value = nextCursor;
      if (shouldCommit) {
        commitCalendarCursorDate(nextCursor);
      }
    };
    const resolveCustomMode = (modeOrKey) => {
      const key = typeof modeOrKey === "string" ? modeOrKey : modeOrKey?.key;
      const baseMode = analysisCustomModes.find((mode) => mode.key === key) || analysisCustomModes[0];
      const values = customValues.value;
      if (baseMode.key === "range") {
        return {
          ...baseMode,
          range: `自定义 · 时间段 · ${values.rangeStart} 至 ${values.rangeEnd}`,
          value: values.rangeStart,
        };
      }
      if (baseMode.key === "day") {
        return { ...baseMode, range: `自定义 · 按天 · ${values.day}`, value: values.day };
      }
      if (baseMode.key === "month") {
        return { ...baseMode, range: `自定义 · 按月 · ${values.month}`, value: values.month };
      }
      return { ...baseMode, range: `自定义 · 按年 · ${values.year}`, value: values.year };
    };
    const selectPreset = (preset) => {
      if (preset === "自定义") {
        selectedTimePreset.value = "自定义";
        customMenuOpen.value = true;
        activePicker.value = selectedCustomMode.value?.key || "day";
        return;
      }
      selectedTimePreset.value = preset;
      selectedCustomMode.value = null;
      customMenuOpen.value = false;
    };
    const selectCustomMode = (modeOrKey) => {
      const mode = resolveCustomMode(modeOrKey);
      selectedTimePreset.value = "自定义";
      selectedCustomMode.value = mode;
      activePicker.value = mode.key;
    };
    const openCustomPicker = (mode, rangeSide = "start") => {
      if (mode.key === "range") {
        activeRangeSide.value = rangeSide;
        syncCalendarCursor(customValues.value[rangeSide === "end" ? "rangeEnd" : "rangeStart"]);
      }
      if (mode.key === "day") {
        syncCalendarCursor(customValues.value.day);
      }
      selectCustomMode(mode);
    };
    const chooseCalendarYear = (year) => {
      updateCalendarCursor({ year: String(year) });
    };
    const chooseCalendarMonth = (month) => {
      updateCalendarCursor({ month });
    };
    const chooseCalendarDay = (day) => {
      updateCalendarCursor({ day });
    };
    const stepCalendarYear = (direction) => {
      const years = analysisCalendarYears.map(String);
      const currentIndex = years.indexOf(calendarCursor.value.year);
      const nextIndex = Math.min(Math.max((currentIndex >= 0 ? currentIndex : 0) + direction, 0), years.length - 1);
      chooseCalendarYear(years[nextIndex]);
    };
    const stepCalendarMonth = (direction) => {
      const currentMonth = Number(calendarCursor.value.month) || 1;
      const nextMonth = Math.min(Math.max(currentMonth + direction, 1), 12);
      chooseCalendarMonth(padCalendarPart(nextMonth));
    };
    const stepCalendarDay = (direction) => {
      const currentDay = Number(calendarCursor.value.day) || 1;
      const nextDay = Math.min(Math.max(currentDay + direction, 1), getCalendarMonthDayCount(calendarCursor.value.year, calendarCursor.value.month));
      chooseCalendarDay(padCalendarPart(nextDay));
    };
    const handleCalendarWheel = (type, event) => {
      event.preventDefault();
      event.stopPropagation();
      const deltaY = Number(event.deltaY) || 0;
      if (deltaY === 0) {
        return;
      }
      const currentDelta = calendarWheelDelta.value[type] || 0;
      const nextDelta = currentDelta && Math.sign(currentDelta) !== Math.sign(deltaY) ? deltaY : currentDelta + deltaY;
      if (Math.abs(nextDelta) < ANALYSIS_CALENDAR_WHEEL_STEP_DELTA) {
        calendarWheelDelta.value = { ...calendarWheelDelta.value, [type]: nextDelta };
        return;
      }
      const direction = nextDelta >= 0 ? 1 : -1;
      const remainingDelta = nextDelta - direction * ANALYSIS_CALENDAR_WHEEL_STEP_DELTA;
      calendarWheelDelta.value = {
        ...calendarWheelDelta.value,
        [type]: Math.sign(remainingDelta) === direction ? remainingDelta : 0,
      };
      if (type === "year") {
        stepCalendarYear(direction);
        return;
      }
      if (type === "month") {
        stepCalendarMonth(direction);
        return;
      }
      stepCalendarDay(direction);
    };
    const stepCalendarByType = (type, direction) => {
      calendarWheelDelta.value = { ...calendarWheelDelta.value, [type]: 0 };
      if (type === "year") {
        stepCalendarYear(direction);
        return;
      }
      if (type === "month") {
        stepCalendarMonth(direction);
        return;
      }
      stepCalendarDay(direction);
    };
    const chooseMonth = (value) => {
      customValues.value.month = value;
      selectCustomMode("month");
    };
    const chooseYear = (value) => {
      customValues.value.year = String(value);
      selectCustomMode("year");
    };
    const toggleCustomMenu = () => {
      if (!props.compact) {
        selectedTimePreset.value = "自定义";
        activePicker.value = selectedCustomMode.value?.key || "day";
        customMenuOpen.value = !customMenuOpen.value;
      }
    };
    const closeCustomMenu = () => {
      customMenuOpen.value = false;
    };
    const renderCalendarWheel = (label, testId, options, activeValue, onSelect, wheelType) =>
      {
        const activeIndex = Math.max(options.findIndex((option) => option.value === activeValue), 0);
        return h("div", { class: "visual-analysis-calendar-wheel", "data-testid": testId, onWheel: (event) => handleCalendarWheel(wheelType, event) }, [
          h("span", label),
          h(
            "button",
            {
              "aria-label": `${label}上一项`,
              class: "visual-analysis-calendar-arrow is-up",
              disabled: activeIndex === 0,
              "data-testid": `visual-analysis-calendar-${wheelType}-up`,
              type: "button",
              onClick: () => stepCalendarByType(wheelType, -1),
            },
            "▲",
          ),
          h("div", { class: "visual-analysis-calendar-wheel-options", onWheel: (event) => handleCalendarWheel(wheelType, event) }, [
            h("div", { class: "visual-analysis-calendar-wheel-track", style: { "--visual-wheel-index": activeIndex } }, options.map((option) =>
              h(
                "button",
                {
                  class: activeValue === option.value ? "is-active" : "",
                  "data-testid": `visual-analysis-calendar-${wheelType}-${option.value}`,
                  key: option.value,
                  type: "button",
                  onClick: () => onSelect(option.value),
                },
                option.label,
              ),
            )),
          ]),
          h(
            "button",
            {
              "aria-label": `${label}下一项`,
              class: "visual-analysis-calendar-arrow is-down",
              disabled: activeIndex >= options.length - 1,
              "data-testid": `visual-analysis-calendar-${wheelType}-down`,
              type: "button",
              onClick: () => stepCalendarByType(wheelType, 1),
            },
            "▼",
          ),
        ]);
      };
    const renderCalendarDateWheelPicker = () =>
      h("div", { class: "visual-analysis-calendar-wheel-panel", "data-testid": "visual-analysis-calendar-date-wheel" }, [
        renderCalendarWheel(
          "年份",
          "visual-analysis-calendar-year-wheel",
          analysisCalendarYears.map((year) => ({ label: String(year), value: String(year) })),
          calendarCursor.value.year,
          chooseCalendarYear,
          "year",
        ),
        renderCalendarWheel(
          "月份",
          "visual-analysis-calendar-month-wheel",
          analysisCalendarMonthOptions,
          calendarCursor.value.month,
          chooseCalendarMonth,
          "month",
        ),
        renderCalendarWheel(
          "日期",
          "visual-analysis-calendar-day-wheel",
          buildAnalysisCalendarDayOptions(calendarCursor.value.year, calendarCursor.value.month),
          calendarCursor.value.day,
          chooseCalendarDay,
          "day",
        ),
      ]);
    const renderDateField = (mode) => {
      if (mode.key === "range") {
        const renderRangeButton = (side, label) =>
          h(
            "button",
            {
              class: ["visual-analysis-date-field", activeRangeSide.value === side ? "is-active" : ""],
              "data-testid": "visual-analysis-calendar-range",
              type: "button",
              onClick: (event) => {
                event.stopPropagation();
                openCustomPicker(mode, side);
              },
            },
            label,
          );
        return h("span", { class: "visual-analysis-range" }, [
          renderRangeButton("start", customValues.value.rangeStart),
          renderRangeButton("end", customValues.value.rangeEnd),
        ]);
      }
      const fieldValue = mode.key === "day" ? customValues.value.day : mode.key === "month" ? customValues.value.month : customValues.value.year;
      return h(
        "button",
        {
          class: "visual-analysis-date-field",
          "data-testid": `visual-analysis-calendar-${mode.key}`,
          type: "button",
          onClick: (event) => {
            event.stopPropagation();
            openCustomPicker(mode);
          },
        },
        fieldValue,
      );
    };
    const renderPickerPanel = () => {
      if (activePicker.value === "month") {
        return h("div", { class: "visual-analysis-picker-panel", "data-testid": "visual-analysis-month-grid" }, analysisCalendarMonths.map((month) =>
          h(
            "button",
            {
              class: customValues.value.month === month.value ? "is-active" : "",
              key: month.value,
              type: "button",
              onClick: () => chooseMonth(month.value),
            },
            month.label,
          ),
        ));
      }
      if (activePicker.value === "year") {
        return h("div", { class: "visual-analysis-picker-panel visual-analysis-year-grid", "data-testid": "visual-analysis-year-grid" }, analysisCalendarYears.map((year) =>
          h("button", { class: customValues.value.year === String(year) ? "is-active" : "", key: year, type: "button", onClick: () => chooseYear(year) }, String(year)),
        ));
      }
      if (activePicker.value === "range") {
        const rangeMode = analysisCustomModes.find((mode) => mode.key === "range");
        return h("div", { class: "visual-analysis-picker-panel is-range", "data-testid": "visual-analysis-range-grid" }, [
          h("div", { class: "visual-analysis-range-pick-head" }, [
            h("span", "选择起止日期"),
            renderDateField(rangeMode),
          ]),
          renderCalendarDateWheelPicker(),
        ]);
      }
      return h("div", { class: "visual-analysis-picker-panel is-calendar", "data-testid": "visual-analysis-day-picker" }, [
        renderCalendarDateWheelPicker(),
      ]);
    };

    return () => {
      const activeConfig =
        selectedTimePreset.value === "自定义"
          ? selectedCustomMode.value || analysisCustomModes[0]
          : analysisTimeConfigs[selectedTimePreset.value] || analysisTimeConfigs["年初至今"];
      const rows = buildAnalysisLabRows(props.labNames, activeConfig.scale);
      const total = rows.reduce((sum, row) => sum + row.value, 0);
      const pieSegments = buildPieSegments(rows);
      const topRows = rows.slice().sort((left, right) => right.value - left.value);
      const visibleRows = props.compact ? topRows.slice(0, 5) : topRows;

      return h("div", { class: ["visual-board", "visual-analysis-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top visual-analysis-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "EQUIPMENT / PRODUCT"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "设备状态与产品统计屏"),
          ]),
          h("div", { class: "visual-analysis-filterbar" }, [
            h("select", { class: "visual-analysis-select", "aria-label": "试验间筛选" }, [
              h("option", "综合"),
              ...rows.map((row) => h("option", { key: row.name }, row.name)),
            ]),
            h("div", { class: "visual-analysis-time-card" }, [
              h("span", `统计时间 · 自动粒度：${activeConfig.granularity}`),
              h("strong", activeConfig.range),
            ]),
            h("div", { class: "visual-analysis-filter-row", "data-testid": "visual-analysis-filter-row" }, analysisTimePresets.map((preset) => {
              if (preset === "自定义" && !props.compact) {
                return h("div", { class: ["visual-analysis-custom", customMenuOpen.value ? "is-open" : ""], key: preset }, [
                  h(
                    "button",
                    {
                      class: ["visual-analysis-time-chip", selectedTimePreset.value === "自定义" ? "is-active" : ""],
                      "aria-expanded": String(customMenuOpen.value),
                      "aria-haspopup": "menu",
                      "data-testid": "visual-analysis-custom-trigger",
                      type: "button",
                      onClick: (event) => {
                        event.stopPropagation();
                        toggleCustomMenu();
                      },
                    },
                    preset,
                  ),
                  customMenuOpen.value
                    ? h("div", { class: "visual-analysis-custom-menu", "data-testid": "visual-analysis-custom-menu", role: "menu" }, [
                      ...analysisCustomModes.map((mode) =>
                        h("div", {
                          class: ["visual-analysis-custom-row", (selectedCustomMode.value?.key || activePicker.value) === mode.key ? "is-active" : ""],
                          "data-testid": "visual-analysis-custom-mode",
                          key: mode.label,
                          role: "menuitem",
                          tabindex: 0,
                          onClick: () => openCustomPicker(mode),
                          onKeydown: (event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openCustomPicker(mode);
                            }
                          },
                        }, [
                          h("strong", mode.label),
                          renderDateField(mode),
                        ]),
                      ),
                      renderPickerPanel(),
                      h("button", { class: "visual-analysis-menu-close", type: "button", onClick: closeCustomMenu }, "确认"),
                    ])
                    : null,
                ]);
              }
              return props.compact
                ? h("span", { class: ["visual-analysis-time-chip", selectedTimePreset.value === preset ? "is-active" : ""], key: preset }, preset)
                : h("button", { class: ["visual-analysis-time-chip", selectedTimePreset.value === preset ? "is-active" : ""], key: preset, type: "button", onClick: () => selectPreset(preset) }, preset);
            })),
          ]),
        ]),
        h("div", { class: "visual-analysis-layout" }, [
          h("section", { class: "visual-analysis-panel visual-analysis-health" }, [
            h("div", { class: "visual-analysis-panel-head" }, [
              h("strong", "年度设备健康状态"),
              h("span", "综合 · 2026年截至05-28 · 当前快照"),
            ]),
            h("div", { class: "visual-analysis-health-metrics" }, [
              h("div", [h("span", "设备总数"), h("strong", "110")]),
              h("div", [h("span", "正常率"), h("strong", "78.2%")]),
              h("div", [h("span", "异常设备"), h("strong", "24")]),
            ]),
            h("div", { class: "visual-analysis-health-body" }, [
              h("div", { class: "visual-analysis-health-ring" }, [
                h("span", "综合状态"),
                h("strong", "78.2%"),
              ]),
              h("div", { class: "visual-analysis-status-list" }, analysisStatusRows.map((row) =>
                h("div", { class: "visual-analysis-status-row", key: row.label, style: { "--visual-status-color": row.color } }, [
                  h("span", row.label),
                  h("div", [h("i", { style: { width: `${row.percent}%` } })]),
                  h("b", row.count),
                ]),
              )),
            ]),
            h("div", { class: "visual-analysis-trend" }, [
              h("div", [h("span", "近 6 个月正常率"), h("b", "按月快照")]),
              h("div", { class: "visual-analysis-trend-bars" }, [62, 54, 68, 59, 73, 66].map((height, index) =>
                h("span", { key: index, style: { "--visual-trend-height": `${height}%` } }),
              )),
            ]),
          ]),
          h("section", { class: "visual-analysis-panel visual-analysis-product-panel" }, [
            h("div", { class: "visual-analysis-panel-head" }, [
              h("strong", "试验间实验产品数分布"),
              h("span", `${activeConfig.label || "自定义"} · 全部试验间 · 模拟临时数据`),
            ]),
            h("div", { class: "visual-analysis-product-main" }, [
              h("svg", { class: "visual-analysis-pie", role: "img", viewBox: "0 0 760 560", "aria-label": "全部试验间实验产品数饼图" }, [
                h("g", pieSegments.map((segment) => h("path", { class: "visual-analysis-pie-slice", d: segment.path, fill: segment.color, key: `${segment.name}-path` }))),
                h("circle", { cx: "380", cy: "278", fill: "#05070a", r: "62", stroke: "rgba(238,253,249,.14)", "stroke-width": "18" }),
                h("text", { class: "visual-analysis-pie-total", "dominant-baseline": "central", "text-anchor": "middle", x: "380", y: "278" }, total),
                h("g", pieSegments.map((segment) => h("path", { class: "visual-analysis-pie-guide", d: segment.guide, key: `${segment.name}-guide` }))),
                h("g", { class: "visual-analysis-pie-labels" }, pieSegments.map((segment) =>
                  h("text", { key: `${segment.name}-label`, "text-anchor": segment.anchor, x: segment.textX.toFixed(0), y: segment.textY.toFixed(0) }, `${segment.name} ${segment.value}`),
                )),
              ]),
              h("div", { class: "visual-analysis-ranking" }, [
                h("div", { class: "visual-analysis-total" }, [h("span", "当前筛选范围产品总数"), h("strong", total)]),
                ...visibleRows.map((row) =>
                  h("div", { class: "visual-analysis-rank-row", key: row.name, style: { "--visual-rank-color": row.color } }, [
                    h("i"),
                    h("span", row.name),
                    h("strong", row.value),
                    h("b", `${((row.value / total) * 100).toFixed(1)}%`),
                  ]),
                ),
              ]),
            ]),
          ]),
          h("section", { class: "visual-analysis-panel visual-analysis-rules" }, [
            h("div", [h("strong", "快捷筛选"), h("span", "今日按小时；本周按日；本月按日/周；年初至今按月。")]),
            h("div", [h("strong", "自定义菜单"), h("span", "按天、按月、按年、时间段集中在同一按钮下弹出选择。")]),
            h("div", [h("strong", "数据口径"), h("span", "产品数暂用临时模拟数据，后续接入 schedule.device + samples 去重统计。")]),
            h("div", [h("strong", "完整显示"), h("span", "饼图与排行同步列出全部试验间名称和数量。")]),
          ]),
        ]),
      ]);
    };
  },
};

const PlaceholderScreen = {
  name: "PlaceholderScreen",
  props: {
    screen: { type: Object, required: true },
    labs: { type: Array, required: false, default: () => [] },
    compact: { type: Boolean, default: false },
  },
  setup(props) {
    return () =>
      h("div", { class: ["visual-board", "visual-placeholder-board", `accent-${props.screen.accent || "cyan"}`, props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "SCREEN"),
            h("div", { class: "visual-board-title" }, props.screen.name),
          ]),
          h("div", { class: ["visual-board-live", `tone-${props.screen.tone || "live"}`] }, props.screen.status),
        ]),
        h("div", { class: "visual-placeholder-content" }, [
          h("div", { class: "visual-placeholder-left" }, [
            h("div", { class: "visual-placeholder-chart" }, [
              h("span"),
              h("span"),
              h("span"),
              h("span"),
              h("span"),
              h("span"),
              h("i"),
            ]),
            h(
              "div",
              { class: "visual-placeholder-kpis" },
              (props.screen.indicators || []).map(([label, value]) =>
                h("div", { class: "visual-placeholder-kpi", key: label }, [h("span", label), h("strong", value)]),
              ),
            ),
          ]),
          h("div", { class: "visual-placeholder-copy" }, [
            h("span", "核心指标"),
            h("strong", props.screen.metric),
            h("span", props.screen.status),
            h("div", { class: "visual-placeholder-pulse" }, [
              h("b"),
              h("b"),
              h("b"),
              h("b"),
            ]),
          ]),
        ]),
      ]);
  },
};

const stepClass = (step) => ({
  "is-done": Boolean(step?.reached),
  "is-active": Boolean(step?.active),
  "is-waiting": !step?.reached && !step?.active,
});
</script>
