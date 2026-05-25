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
            :schedule-view="scheduleView"
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
      <section class="visual-preview-shell" :class="{ 'is-screen-only': selectedScreen.kind === 'lab-process' }">
        <div v-if="selectedScreen.kind !== 'lab-process'" class="visual-preview-header">
          <div>
            <div class="visualization-eyebrow">单屏放大</div>
            <h3>{{ selectedScreen.name }}</h3>
          </div>
          <div class="visual-preview-actions">
            <button class="action-btn secondary" type="button" @click="closeSinglePreview">关闭</button>
          </div>
        </div>
        <button
          v-if="selectedScreen.kind === 'lab-process'"
          class="visual-screen-close"
          type="button"
          @click="closeSinglePreview"
        >
          关闭
        </button>
        <div class="visual-expanded-screen" :class="{ 'is-lab-process': selectedScreen.kind === 'lab-process' }">
          <component
            :is="resolveScreenComponent(selectedScreen)"
            :screen="selectedScreen"
            :labs="selectedLabs"
            :schedule-view="scheduleView"
            :interactive="selectedScreen.kind === 'lab-process' || selectedScreen.kind === 'schedule-three-day'"
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
                  :schedule-view="scheduleView"
                  :interactive="screen.kind === 'lab-process' || screen.kind === 'schedule-three-day'"
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
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { buildLabProcessPanels, buildLabScheduleThreeDayView, getVisualizationLabNames } from "./model";

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
    key: "environment",
    name: "环境数据监控屏",
    kind: "placeholder",
    status: "在线",
    metric: "温湿压照",
    accent: "blue",
    tone: "live",
    indicators: [
      ["温度", "23.8"],
      ["湿度", "48%"],
      ["气压", "101"],
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
    name: "历史任务归档屏",
    kind: "placeholder",
    status: "同步中",
    metric: "厂家回收",
    accent: "violet",
    tone: "sync",
    indicators: [
      ["归档", "284"],
      ["回收", "12"],
      ["留样", "36"],
    ],
  },
];

const { loadSnapshot } = useStorageSnapshot([
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.schedules,
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
    experiments: snapshot[STORAGE_KEYS.experiments],
    experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
    schedules: snapshot[STORAGE_KEYS.schedules],
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
  manualLabSelection.value = true;
  selectedPrimaryLabName.value = selectedLabs.value[0]?.name || "";
  selectedSecondaryLabName.value = selectedLabs.value[1]?.name || "";
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
  return PlaceholderScreen;
};

const refreshSnapshot = async () => {
  rawSnapshot.value = await loadSnapshot();
};
const refreshViewportSize = () => {
  if (typeof window === "undefined") {
    return;
  }
  viewportSize.value = {
    height: window.innerHeight || SCREEN_STAGE_HEIGHT,
    width: window.innerWidth || SCREEN_STAGE_WIDTH,
  };
};

onMounted(() => {
  refreshViewportSize();
  refreshSnapshot();
  window.addEventListener("mes:samples-updated", refreshSnapshot);
  window.addEventListener("storage", refreshSnapshot);
  window.addEventListener("resize", refreshViewportSize);
});

onUnmounted(() => {
  window.removeEventListener("mes:samples-updated", refreshSnapshot);
  window.removeEventListener("storage", refreshSnapshot);
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
    return () =>
      h("div", { class: ["visual-board", props.compact ? "is-compact" : ""] }, [
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
            ...props.labs.map((lab, labIndex) =>
              h("div", { class: "visual-lab-panel", key: lab.name }, [
                h("div", { class: "visual-lab-panel-head" }, [
                  h("div", [
                    h("div", { class: "visual-lab-name" }, lab.name),
                    h("div", { class: "visual-task-code" }, lab.task),
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
                h("div", { class: "visual-tray-flow-list" }, [
                  ...(lab.trays.length
                    ? lab.trays.slice(0, props.compact ? 1 : 3).map((tray) =>
                      h("div", { class: "visual-tray-flow", key: tray.trayCode }, [
                        h("div", { class: "visual-tray-flow-head" }, [
                          h("strong", tray.trayCode),
                          h("span", tray.taskCode),
                        ]),
                        h(
                          "div",
                          { class: "visual-flow-line" },
                          tray.steps.map((step) =>
                            h("div", { class: ["visual-flow-step", stepClass(step)] }, [
                              h("span", { class: "visual-flow-dot" }),
                              h("strong", step.label),
                              h("small", step.time),
                            ]),
                          ),
                        ),
                      ]),
                    )
                    : [h("div", { class: "visual-empty-tray-flow" }, "暂无托盘流程")]),
                ]),
                h("div", { class: "visual-lab-status-row" }, [
                  h("div", { class: "visual-side-metric" }, [h("span", "样品 / 托盘"), h("strong", `${lab.sampleCount}/${lab.trayCount}`)]),
                  h("div", { class: "visual-side-metric" }, [h("span", "当前状态"), h("strong", lab.state)]),
                ]),
                lab.alert ? h("div", { class: "visual-alert-strip" }, lab.alert) : h("div", { class: "visual-ok-strip" }, lab.trayCount ? "运行正常" : "等待托盘"),
              ]),
            ),
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
  return h("div", { class: ["visual-schedule-slot", `state-${slot.state || "idle"}`, slot.displayMode === "conflict" ? "is-conflict" : ""] }, [
    h("div", { class: "visual-schedule-slot-state" }, scheduleStateLabel(slot.state)),
    ...(visibleItems.length
      ? visibleItems.map((item) => renderScheduleItem(item, slot, compact))
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
              h("span", day.label),
              h("strong", day.dateLabel),
              h("small", `${day.count} 项`),
            ]),
          )),
          h("div", { class: "visual-schedule-grid" }, [
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
