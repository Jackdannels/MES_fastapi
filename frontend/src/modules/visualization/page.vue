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
            :is="screen.kind === 'lab-process' ? LabProcessScreen : PlaceholderScreen"
            :screen="screen"
            :labs="defaultLabs"
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
            :is="selectedScreen.kind === 'lab-process' ? LabProcessScreen : PlaceholderScreen"
            :screen="selectedScreen"
            :labs="selectedLabs"
            :interactive="selectedScreen.kind === 'lab-process'"
            @open-lab-picker="openLabPicker"
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
    >
      <section class="visual-combined-shell">
        <div class="visual-preview-header">
          <div>
            <div class="visualization-eyebrow">全屏预览</div>
            <h3>八屏拼接展示</h3>
          </div>
          <button class="action-btn secondary" type="button" @click="closeCombinedPreview">关闭</button>
        </div>
        <div class="visual-combined-grid">
          <div
            v-for="screen in screenCards"
            :key="screen.key"
            class="visual-combined-screen"
            data-testid="visual-combined-screen"
          >
            <component
              :is="screen.kind === 'lab-process' ? LabProcessScreen : PlaceholderScreen"
              :screen="screen"
              :labs="defaultLabs"
              compact
            />
          </div>
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
import { buildLabProcessPanels, getVisualizationLabNames } from "./model";

const screenCards = [
  { key: "lab-process", name: "实验室流程监控屏", kind: "lab-process", status: "运行中", tone: "live" },
  {
    key: "device-status",
    name: "设备状态监控屏",
    kind: "placeholder",
    status: "在线",
    metric: "12 台设备",
    accent: "cyan",
    tone: "live",
    indicators: [
      ["运行", "10"],
      ["待机", "2"],
      ["故障", "0"],
    ],
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
    key: "quality-trend",
    name: "合格率趋势屏",
    kind: "placeholder",
    status: "在线",
    metric: "97.3%",
    accent: "green",
    tone: "live",
    indicators: [
      ["通过", "142"],
      ["复核", "4"],
      ["异常", "2"],
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
const labPickerPosition = ref("");
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
const operationsSummary = computed(() => [
  { label: "在线屏幕", value: "8/8" },
  { label: "监控试验间", value: labScreens.value.length },
  { label: "运行任务", value: labScreens.value.reduce((total, lab) => total + lab.taskCount, 0) },
  { label: "托盘流程", value: labScreens.value.reduce((total, lab) => total + lab.trayCount, 0) },
]);
const defaultLabs = computed(() => [labScreens.value[0], labScreens.value[1]].filter(Boolean));
const selectedLabs = computed(() => [
  labScreens.value.find((lab) => lab.name === selectedPrimaryLabName.value) || labScreens.value[0],
  labScreens.value.find((lab) => lab.name === selectedSecondaryLabName.value) || labScreens.value[1],
]);
const activePickerLabName = computed(() => (labPickerPosition.value === "secondary" ? selectedSecondaryLabName.value : selectedPrimaryLabName.value));
const excludedPickerLabName = computed(() => (labPickerPosition.value === "secondary" ? selectedPrimaryLabName.value : selectedSecondaryLabName.value));
const labPickerTitle = computed(() => (labPickerPosition.value === "secondary" ? "选择下方试验间" : "选择上方试验间"));
const labPickerOptions = computed(() => labScreens.value.filter((lab) => lab.name !== excludedPickerLabName.value));

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
  if (labPickerPosition.value === "secondary") {
    selectedSecondaryLabName.value = nextName;
  } else {
    selectedPrimaryLabName.value = nextName;
  }
  closeLabPicker();
};

const refreshSnapshot = async () => {
  rawSnapshot.value = await loadSnapshot();
};

onMounted(() => {
  refreshSnapshot();
  window.addEventListener("mes:samples-updated", refreshSnapshot);
  window.addEventListener("storage", refreshSnapshot);
});

onUnmounted(() => {
  window.removeEventListener("mes:samples-updated", refreshSnapshot);
  window.removeEventListener("storage", refreshSnapshot);
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
