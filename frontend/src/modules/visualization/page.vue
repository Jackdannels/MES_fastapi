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
            :labs="labsForScreen(screen)"
            :lab-names="labNames"
            :current-lab-task-view="currentLabTaskView"
            :attendance-sessions="attendanceSessions"
            :devices="deviceItems"
            :schedule-view="scheduleView"
            :staging-view="stagingSamplesView"
            :today-task-plan-view="todayTaskPlanView"
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
          aria-label="关闭"
          type="button"
          @click="closeSinglePreview"
        >
          ×
        </button>
        <div class="visual-expanded-screen is-screen-only" :class="{ 'is-lab-process': selectedScreen.kind === 'lab-process' }">
          <component
            :is="resolveScreenComponent(selectedScreen)"
            :screen="selectedScreen"
            :labs="labsForScreen(selectedScreen)"
            :lab-names="labNames"
            :current-lab-task-view="currentLabTaskView"
            :attendance-sessions="attendanceSessions"
            :devices="deviceItems"
            :schedule-view="scheduleView"
            :staging-view="stagingSamplesView"
            :today-task-plan-view="todayTaskPlanView"
            :interactive="selectedScreen.kind === 'lab-process' || selectedScreen.kind === 'schedule-three-day' || selectedScreen.kind === 'staging-samples' || selectedScreen.kind === 'analysis'"
            @open-lab-picker="(position) => openLabPicker(position, selectedScreen)"
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
                  :labs="labsForScreen(screen)"
                  :lab-names="labNames"
                  :current-lab-task-view="currentLabTaskView"
                  :attendance-sessions="attendanceSessions"
                  :devices="deviceItems"
                  :schedule-view="scheduleView"
                  :staging-view="stagingSamplesView"
                  :today-task-plan-view="todayTaskPlanView"
                  :interactive="screen.kind === 'lab-process' || screen.kind === 'schedule-three-day' || screen.kind === 'staging-samples' || screen.kind === 'analysis'"
                  @open-lab-picker="(position) => openLabPicker(position, screen)"
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

import { computed, onMounted, onUnmounted, ref } from "vue";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { listLaboratoryAttendanceSessions } from "@/lib/attendanceApi";
import { serverNowDate } from "@/lib/serverClock";
import { readStorageSnapshot } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import { buildLabCurrentTaskMatrixView, buildLabProcessPanels, buildLabScheduleThreeDayView, buildStagingSamplesView, buildTodayTaskPlanView, getVisualizationLabNames } from "./model";
import { LabStatusScreen, PlaceholderScreen } from "./screens/statusScreens";
import { AnalysisScreen } from "./screens/analysisScreen";
import { CurrentLabTasksScreen } from "./screens/currentLabTasksScreen";
import { LabProcessScreen } from "./screens/labProcessScreen";
import { LabScheduleScreen } from "./screens/labScheduleScreen";
import { StagingSamplesScreen } from "./screens/stagingSamplesScreen";
import { TodayTaskPlanScreen } from "./screens/taskPlanScreen";

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
    key: "today-task-plan-overview",
    name: "今日任务计划总览屏",
    kind: "today-task-plan",
    status: "真实数据",
    metric: "实验数量",
    accent: "cyan",
    tone: "live",
    indicators: [
      ["已分盘", "4"],
      ["待分盘", "2"],
      ["样品", "48"],
    ],
  },
  {
    key: "current-lab-tasks",
    name: "试验间当前任务状态屏",
    kind: "current-lab-tasks",
    status: "实时同步",
    metric: "当前任务",
    accent: "cyan",
    tone: "sync",
    indicators: [
      ["已排程", "蓝"],
      ["维修", "红"],
      ["运行", "绿"],
      ["临近", "橙"],
    ],
  },
  {
    key: "lab-process-secondary",
    name: "实验室流程监控屏B组",
    kind: "lab-process",
    group: "secondary",
    status: "运行中",
    metric: "后续试验间",
    accent: "cyan",
    tone: "live",
    indicators: [
      ["试验间", "2"],
      ["优先", "有托盘"],
      ["去重", "开启"],
    ],
  },
  {
    key: "staging-samples",
    name: "暂存间/外观检测间样品信息屏",
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
    key: "lab-status",
    name: "试验间状态监测屏",
    kind: "lab-status",
    status: "实时监测",
    metric: "11 个试验间",
    accent: "cyan",
    tone: "live",
    indicators: [
      ["室温", "实时"],
      ["设备", "在线"],
      ["搬运", "10 间"],
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
      ["产品数", "487"],
      ["试验间", "11"],
    ],
  },
];

const VISUALIZATION_SNAPSHOT_KEYS = [
  STORAGE_KEYS.devices,
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.experiment_run_steps,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.staging_events,
];
const { loadSnapshot: loadInitialSnapshot } = useStorageSnapshot(VISUALIZATION_SNAPSHOT_KEYS);
const rawSnapshot = ref({});
const attendanceSessions = ref([]);
const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

const readRawStorageSnapshot = () =>
  readStorageSnapshot(VISUALIZATION_SNAPSHOT_KEYS, { normalizeMissing: false });

const mergeArraySnapshot = (previousSnapshot, nextSnapshot, keys) => {
  const source = nextSnapshot && typeof nextSnapshot === "object" ? nextSnapshot : {};
  const merged = { ...(previousSnapshot || {}) };
  keys.forEach((key) => {
    if (hasOwn(source, key) && Array.isArray(source[key])) {
      merged[key] = source[key];
    }
  });
  return merged;
};

const deviceItems = computed(() => {
  const devices = rawSnapshot.value?.[STORAGE_KEYS.devices];
  return Array.isArray(devices) ? devices : [];
});
const labNames = computed(() => getVisualizationLabNames(deviceItems.value));

const selectedScreen = ref(null);
const selectedLabSlots = ref({
  primary: ["", ""],
  secondary: ["", ""],
});
const combinedPreviewOpen = ref(false);
const viewportSize = ref({ height: 1080, width: 1920 });
const labPickerPosition = ref("");
const labPickerGroup = ref("");
const manualLabSelection = ref(false);
const labRandomSeed = ref(Math.random());
const scheduleWindowOffsetDays = ref(0);
let attendanceRefreshTimer = null;
const SCREEN_STAGE_WIDTH = 1920;
const SCREEN_STAGE_HEIGHT = 1080;
const ATTENDANCE_REFRESH_MS = 10_000;
const COMBINED_COLUMNS = 4;
const COMBINED_ROWS = 2;
const COMBINED_GAP = 6;
const COMBINED_PADDING = 8;
const labScreens = computed(() => {
  const snapshot = rawSnapshot.value || {};
  return buildLabProcessPanels({
    labNames: labNames.value,
    tasks: snapshot[STORAGE_KEYS.tasks],
    samples: snapshot[STORAGE_KEYS.samples],
    experiments: snapshot[STORAGE_KEYS.experiments],
    experimentRuns: snapshot[STORAGE_KEYS.experiment_runs],
    experimentRunTrays: snapshot[STORAGE_KEYS.experiment_run_trays],
    experimentRunSteps: snapshot[STORAGE_KEYS.experiment_run_steps],
    experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
    schedules: snapshot[STORAGE_KEYS.schedules],
    stagingEvents: snapshot[STORAGE_KEYS.staging_events],
    devices: snapshot[STORAGE_KEYS.devices],
  });
});
const scheduleView = computed(() => {
  const snapshot = rawSnapshot.value || {};
  const anchorDate = serverNowDate();
  anchorDate.setDate(anchorDate.getDate() + scheduleWindowOffsetDays.value);
  return buildLabScheduleThreeDayView({
    labNames: labNames.value,
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
    experimentRunSteps: snapshot[STORAGE_KEYS.experiment_run_steps],
    experimentRunTrays: snapshot[STORAGE_KEYS.experiment_run_trays],
    experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
    schedules: snapshot[STORAGE_KEYS.schedules],
    stagingEvents: snapshot[STORAGE_KEYS.staging_events],
  });
});
const currentLabTaskView = computed(() => {
  const snapshot = rawSnapshot.value || {};
  return buildLabCurrentTaskMatrixView({
    labNames: labNames.value,
    now: serverNowDate(),
    tasks: snapshot[STORAGE_KEYS.tasks],
    samples: snapshot[STORAGE_KEYS.samples],
    devices: snapshot[STORAGE_KEYS.devices],
    experiments: snapshot[STORAGE_KEYS.experiments],
    experimentRuns: snapshot[STORAGE_KEYS.experiment_runs],
    experimentRunTrays: snapshot[STORAGE_KEYS.experiment_run_trays],
    experimentRunSteps: snapshot[STORAGE_KEYS.experiment_run_steps],
    experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
    schedules: snapshot[STORAGE_KEYS.schedules],
  });
});
const todayTaskPlanView = computed(() => {
  const snapshot = rawSnapshot.value || {};
  return buildTodayTaskPlanView({
    now: serverNowDate(),
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
    return labNames.value.indexOf(left.name) - labNames.value.indexOf(right.name);
  });
});
const LAB_PROCESS_GROUPS = ["primary", "secondary"];
const LAB_PROCESS_SLOT_COUNT = 2;
const normalizeLabProcessGroup = (group) => (group === "secondary" ? "secondary" : "primary");
const resolveScreenLabGroup = (screen) => normalizeLabProcessGroup(screen?.group);
const findLabScreenByName = (name) => labScreens.value.find((lab) => lab.name === name);
const defaultLabGroups = computed(() => ({
  primary: labDisplayOrder.value.slice(0, LAB_PROCESS_SLOT_COUNT).filter(Boolean),
  secondary: labDisplayOrder.value.slice(LAB_PROCESS_SLOT_COUNT, LAB_PROCESS_SLOT_COUNT * 2).filter(Boolean),
}));
const displayedLabGroups = computed(() => {
  const usedLabNames = new Set();
  const groups = {};
  LAB_PROCESS_GROUPS.forEach((group) => {
    const defaults = defaultLabGroups.value[group] || [];
    const selectedNames = selectedLabSlots.value[group] || [];
    groups[group] = Array.from({ length: LAB_PROCESS_SLOT_COUNT }, (_, slotIndex) => {
      const selectedLab = manualLabSelection.value ? findLabScreenByName(selectedNames[slotIndex]) : null;
      if (selectedLab && !usedLabNames.has(selectedLab.name)) {
        usedLabNames.add(selectedLab.name);
        return selectedLab;
      }
      const defaultSlotLab = defaults[slotIndex];
      if (defaultSlotLab && !usedLabNames.has(defaultSlotLab.name)) {
        usedLabNames.add(defaultSlotLab.name);
        return defaultSlotLab;
      }
      const defaultGroupLab = defaults.find((lab) => lab && !usedLabNames.has(lab.name));
      if (defaultGroupLab) {
        usedLabNames.add(defaultGroupLab.name);
        return defaultGroupLab;
      }
      const fallbackLab = labDisplayOrder.value.find((lab) => lab && !usedLabNames.has(lab.name));
      if (fallbackLab) {
        usedLabNames.add(fallbackLab.name);
        return fallbackLab;
      }
      return null;
    }).filter(Boolean);
  });
  return groups;
});
const labsForScreen = (screen) => {
  if (screen?.kind !== "lab-process") {
    return [];
  }
  const group = resolveScreenLabGroup(screen);
  return displayedLabGroups.value[group] || [];
};
const activePickerSlotIndex = computed(() => (labPickerPosition.value === "secondary" ? 1 : 0));
const activePickerLabName = computed(() => {
  const group = normalizeLabProcessGroup(labPickerGroup.value);
  return (displayedLabGroups.value[group] || [])[activePickerSlotIndex.value]?.name || "";
});
const occupiedPickerLabNames = computed(() => {
  const activeGroup = normalizeLabProcessGroup(labPickerGroup.value);
  const names = new Set();
  LAB_PROCESS_GROUPS.forEach((group) => {
    (displayedLabGroups.value[group] || []).forEach((lab, slotIndex) => {
      if (group === activeGroup && slotIndex === activePickerSlotIndex.value) {
        return;
      }
      if (lab?.name) {
        names.add(lab.name);
      }
    });
  });
  return names;
});
const labPickerTitle = computed(() => (labPickerPosition.value === "secondary" ? "选择下方试验间" : "选择上方试验间"));
const labPickerOptions = computed(() => labScreens.value.filter((lab) => lab.name === activePickerLabName.value || !occupiedPickerLabNames.value.has(lab.name)));
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
const openLabPicker = (position, screen = null) => {
  labPickerGroup.value = resolveScreenLabGroup(screen);
  labPickerPosition.value = position === "secondary" ? "secondary" : "primary";
};
const closeLabPicker = () => {
  labPickerPosition.value = "";
  labPickerGroup.value = "";
};
const persistDisplayedLabSlots = () => {
  selectedLabSlots.value = {
    primary: Array.from({ length: LAB_PROCESS_SLOT_COUNT }, (_, index) => (displayedLabGroups.value.primary || [])[index]?.name || ""),
    secondary: Array.from({ length: LAB_PROCESS_SLOT_COUNT }, (_, index) => (displayedLabGroups.value.secondary || [])[index]?.name || ""),
  };
};
const selectLabFromPicker = (labName) => {
  const nextName = String(labName || "").trim();
  if (!nextName || occupiedPickerLabNames.value.has(nextName)) {
    return;
  }
  const group = normalizeLabProcessGroup(labPickerGroup.value);
  const slotIndex = activePickerSlotIndex.value;
  persistDisplayedLabSlots();
  manualLabSelection.value = true;
  const nextGroupSlots = Array.from({ length: LAB_PROCESS_SLOT_COUNT }, (_, index) => (selectedLabSlots.value[group] || [])[index] || "");
  selectedLabSlots.value = {
    ...selectedLabSlots.value,
    [group]: nextGroupSlots.map((name, index) => (index === slotIndex ? nextName : name)),
  };
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
  if (screen?.kind === "current-lab-tasks") {
    return CurrentLabTasksScreen;
  }
  if (screen?.kind === "staging-samples") {
    return StagingSamplesScreen;
  }
  if (screen?.kind === "analysis") {
    return AnalysisScreen;
  }
  if (screen?.kind === "lab-status") {
    return LabStatusScreen;
  }
  return PlaceholderScreen;
};

const refreshSnapshot = async () => {
  const snapshot = await readRawStorageSnapshot();
  rawSnapshot.value = mergeArraySnapshot(rawSnapshot.value, snapshot, VISUALIZATION_SNAPSHOT_KEYS);
};
const initializeSnapshot = async () => {
  const snapshot = loadInitialSnapshot();
  const resolvedSnapshot = snapshot && typeof snapshot.then === "function" ? await snapshot : snapshot;
  rawSnapshot.value = mergeArraySnapshot(rawSnapshot.value, resolvedSnapshot, VISUALIZATION_SNAPSHOT_KEYS);
};
const refreshAttendanceSessions = async () => {
  try {
    const sessions = await listLaboratoryAttendanceSessions();
    attendanceSessions.value = Array.isArray(sessions) ? sessions : [];
  } catch {
    // Keep the last visible login state during transient network failures.
  }
};
useStorageSnapshotRefresh({
  keys: VISUALIZATION_SNAPSHOT_KEYS,
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
onMounted(() => {
  refreshViewportSize();
  initializeSnapshot();
  refreshAttendanceSessions();
  window.addEventListener("resize", refreshViewportSize);
  attendanceRefreshTimer = window.setInterval(refreshAttendanceSessions, ATTENDANCE_REFRESH_MS);
});

onUnmounted(() => {
  window.removeEventListener("resize", refreshViewportSize);
  if (attendanceRefreshTimer) {
    window.clearInterval(attendanceRefreshTimer);
    attendanceRefreshTimer = null;
  }
});

</script>
