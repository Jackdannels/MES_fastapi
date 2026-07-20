import { h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { SYSTEM_TRAY_TOTAL } from "@/lib/trayCapacity";
import { findSelectedLabTask, findSelectedLabTray } from "./helpers";

export const StagingSamplesScreen = {
  name: "StagingSamplesScreen",
  props: {
    compact: { type: Boolean, default: false },
    interactive: { type: Boolean, default: false },
    screen: { type: Object, required: false, default: null },
    stagingView: { type: Object, required: false, default: null },
  },
  setup(props) {
    const stagingRoot = ref(null);
    const selectedTaskCode = ref("");
    const selectedTrayCode = ref("");
    const scrollingSampleKey = ref("");
    let resizeObserver = null;
    let refreshQueued = false;

    const refreshSampleLoop = () => {
      const root = stagingRoot.value;
      if (!root) {
        return;
      }
      const sampleWrap = root.querySelector(".visual-staging-sample-wrap[data-sample-key]");
      if (!sampleWrap) {
        scrollingSampleKey.value = "";
        return;
      }
      const sampleKey = sampleWrap.dataset.sampleKey || "";
      const sampleCount = Number(sampleWrap.dataset.sampleCount || 0);
      const viewport = sampleWrap.querySelector(".visual-staging-sample-viewport");
      const grid = sampleWrap.querySelector(".visual-staging-sample-grid");
      if (!sampleKey || !viewport || !grid || sampleCount <= 0) {
        scrollingSampleKey.value = "";
        return;
      }
      const isCurrentlyLooping = sampleWrap.classList.contains("is-scrollable");
      const singleCycleHeight = grid.scrollHeight / (isCurrentlyLooping ? 2 : 1);
      const nextSampleKey = singleCycleHeight > viewport.clientHeight + 1 ? sampleKey : "";
      if (scrollingSampleKey.value !== nextSampleKey) {
        scrollingSampleKey.value = nextSampleKey;
      }
    };

    const queueRefreshSampleLoop = () => {
      if (typeof window === "undefined" || refreshQueued) {
        return;
      }
      refreshQueued = true;
      nextTick(() => {
        window.requestAnimationFrame(() => {
          refreshQueued = false;
          refreshSampleLoop();
        });
      });
    };

    const selectTask = (taskCode) => {
      selectedTaskCode.value = taskCode;
      selectedTrayCode.value = "";
      scrollingSampleKey.value = "";
      queueRefreshSampleLoop();
    };
    const selectTray = (trayCode) => {
      selectedTrayCode.value = trayCode;
      scrollingSampleKey.value = "";
      queueRefreshSampleLoop();
    };

    onMounted(() => {
      queueRefreshSampleLoop();
      if (typeof ResizeObserver !== "undefined" && stagingRoot.value) {
        resizeObserver = new ResizeObserver(queueRefreshSampleLoop);
        resizeObserver.observe(stagingRoot.value);
      } else if (typeof window !== "undefined") {
        window.addEventListener("resize", queueRefreshSampleLoop);
      }
    });

    onUnmounted(() => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      } else if (typeof window !== "undefined") {
        window.removeEventListener("resize", queueRefreshSampleLoop);
      }
    });

    watch(() => props.stagingView, queueRefreshSampleLoop, { deep: true, flush: "post" });

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

      const selectedSampleKey = selectedTray ? `${selectedTray.taskCode}::${selectedTray.trayCode}` : "";
      const sampleCodes = selectedTray ? (Array.isArray(selectedTray.sampleCodes) ? selectedTray.sampleCodes : selectedTray.visibleSampleCodes || []) : [];
      const shouldLoopSamples = Boolean(selectedSampleKey && scrollingSampleKey.value === selectedSampleKey);
      const displayedSampleCodes = shouldLoopSamples ? [...sampleCodes, ...sampleCodes] : sampleCodes;

      return h("div", { ref: stagingRoot, class: ["visual-board", "visual-staging-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "STAGING BUFFER"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "暂存间/外观检测间样品信息屏"),
          ]),
          h("div", { class: "visual-board-state" }, [
            h("span", { class: ["visual-board-live", "tone-live"] }, props.compact ? "06" : "实时快照"),
            props.compact ? null : h("span", { class: "visual-board-time" }, `托盘基准 ${SYSTEM_TRAY_TOTAL}`),
          ]),
        ]),
        h("div", { class: "visual-staging-overview", "data-testid": "visual-staging-overview" }, [
          ...overviewMetrics.map((metric) => h("div", { class: "visual-staging-overview-item", key: metric.label }, [
            h("span", metric.label),
            h("strong", metric.value),
          ])),
          h("div", { class: ["visual-staging-overview-item", "visual-staging-kind-summary"], "data-testid": "visual-staging-kind-summary" }, [
            h("span", "暂存间存放/计划暂存/实验后暂存间存放/外观检测间存放"),
            h("strong", [
              h("b", { class: "kind-current" }, String(summary.currentTrayCount ?? 0)),
              h("i", "/"),
              h("b", { class: "kind-planned" }, String(summary.plannedTrayCount ?? 0)),
              h("i", "/"),
              h("b", { class: "kind-post-test" }, String(summary.postTestTrayCount ?? 0)),
              h("i", "/"),
              h("b", { class: "kind-appearance" }, String(summary.appearanceTrayCount ?? 0)),
            ]),
          ]),
        ]),
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
                      class: [
                        "visual-staging-tray-option",
                        tray.trayCode === selectedTray?.trayCode ? "is-active" : "",
                        tray.stagingKind ? `kind-${tray.stagingKind}` : "",
                      ],
                      "data-testid": "visual-staging-tray-option",
                      type: "button",
                      onClick: () => selectTray(tray.trayCode),
                    },
                    [
                      h("strong", tray.trayCode),
                      h("span", tray.experimentType),
                      h("small", `${tray.stagingKindLabel || ""} ${tray.status}`.trim()),
                    ],
                  ),
              )
              : [h("div", { class: "visual-staging-empty" }, "暂无托盘")]),
            selectedTray
              ? h("div", { class: ["visual-staging-tray-detail", selectedTray.stagingKind ? `kind-${selectedTray.stagingKind}` : ""] }, [
                h("div", { class: "visual-staging-tray-detail-head" }, [
                  h("div", [
                    h("span", selectedTray.taskCode),
                    h("strong", selectedTray.trayCode),
                  ]),
                  h("div", { class: "visual-staging-tray-status" }, selectedTray.stagingKindLabel || selectedTray.status),
                ]),
                h("div", { class: "visual-staging-tray-meta" }, [
                  h("div", [h("span", "实验类型"), h("strong", selectedTray.experimentType)]),
                  h("div", [h("span", "样品数量"), h("strong", `${selectedTray.sampleCount}件`)]),
                ]),
                h("div", {
                  class: ["visual-staging-sample-wrap", shouldLoopSamples ? "is-scrollable" : ""],
                  "data-sample-count": String(sampleCodes.length),
                  "data-sample-key": selectedSampleKey,
                }, [
                  h("div", { class: "visual-staging-sample-head" }, [
                    h("span", "当前托盘样品编号"),
                    shouldLoopSamples ? h("span", { class: "visual-staging-scroll-hint" }, "自动循环播放") : null,
                  ]),
                  h("div", { class: ["visual-staging-sample-viewport", shouldLoopSamples ? "is-scrollable" : ""] }, [
                    h(
                      "div",
                      {
                        class: ["visual-staging-sample-grid", shouldLoopSamples ? "is-looping" : ""],
                        style: shouldLoopSamples ? { "--visual-staging-sample-loop-duration": `${Math.max(18, sampleCodes.length * 1.35)}s` } : {},
                      },
                      displayedSampleCodes.map((sampleCode, index) =>
                        h("span", {
                          class: ["visual-staging-sample-code", selectedTray.stagingKind ? `kind-${selectedTray.stagingKind}` : ""],
                          key: `${sampleCode}-${index}`,
                        }, sampleCode),
                      ),
                    ),
                  ]),
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
      ]);
    };
  },
};

