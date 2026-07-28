import { h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { resolveTaskColor } from "@/modules/schedule/scheduleLifecycleModel";

const taskPlanRowKey = (entry, index) => `${entry.taskCode || "task"}::${entry.experimentCode || entry.experimentType || index}`;
const renderTaskPlanTrayCell = (entry, isClone = false) => {
  const trays = Array.isArray(entry.trays) ? entry.trays : [];
  if (!trays.length) {
    return h("span", { class: "is-pending" }, "待分配托盘");
  }
  return h("div", { class: "visual-task-plan-tray-list has-tray" }, trays.map((tray, trayIndex) =>
    h("span", {
      class: "visual-task-plan-tray-chip",
      "data-testid": isClone ? undefined : "visual-task-plan-tray-chip",
      key: `${tray}-${trayIndex}`,
    }, tray),
  ));
};
const taskPlanRowToneClass = (taskIndex) => `visual-task-plan-row-tone is-tone-${taskIndex % 2 === 0 ? "a" : "b"}`;
const flattenTaskPlanRows = (tasks) =>
  tasks.flatMap((task, taskIndex) =>
    (task.experiments || []).map((experiment) => ({
      ...experiment,
      taskCode: task.taskCode,
      taskToneClass: taskPlanRowToneClass(taskIndex),
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
const taskPlanTrayLayoutSignature = (view) => (Array.isArray(view?.tasks) ? view.tasks : [])
  .flatMap((task) => (task.experiments || []).map((experiment) => [
    task.taskCode,
    experiment.experimentCode || experiment.experimentType,
    ...(experiment.trays || []),
  ].join("::")))
  .join("||");

export const TodayTaskPlanScreen = {
  name: "TodayTaskPlanScreen",
  props: {
    compact: { type: Boolean, default: false },
    screen: { type: Object, required: false, default: null },
    todayTaskPlanView: { type: Object, required: false, default: null },
  },
  setup(props) {
    const taskPlanRoot = ref(null);
    const shouldLoopTaskRows = ref(false);
    let refreshQueued = false;
    let resizeObserver = null;

    const refreshTaskRowLoop = () => {
      const root = taskPlanRoot.value;
      if (!root) {
        return;
      }
      const viewport = root.querySelector(".visual-task-plan-row-viewport");
      const list = root.querySelector(".visual-task-plan-row-list");
      if (!viewport || !list) {
        shouldLoopTaskRows.value = false;
        return;
      }
      const singleCycleHeight = list.scrollHeight / (shouldLoopTaskRows.value ? 2 : 1);
      const nextShouldLoop = singleCycleHeight > viewport.clientHeight + 1;
      if (nextShouldLoop !== shouldLoopTaskRows.value) {
        shouldLoopTaskRows.value = nextShouldLoop;
      }
    };

    const queueRefreshTaskRowLoop = () => {
      if (typeof window === "undefined" || refreshQueued) {
        return;
      }
      refreshQueued = true;
      nextTick(() => {
        window.requestAnimationFrame(() => {
          refreshQueued = false;
          refreshTaskRowLoop();
        });
      });
    };

    onMounted(() => {
      queueRefreshTaskRowLoop();
      if (typeof ResizeObserver !== "undefined" && taskPlanRoot.value) {
        resizeObserver = new ResizeObserver(queueRefreshTaskRowLoop);
        resizeObserver.observe(taskPlanRoot.value);
      } else if (typeof window !== "undefined") {
        window.addEventListener("resize", queueRefreshTaskRowLoop);
      }
    });

    onUnmounted(() => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      } else if (typeof window !== "undefined") {
        window.removeEventListener("resize", queueRefreshTaskRowLoop);
      }
    });

    watch(() => taskPlanTrayLayoutSignature(props.todayTaskPlanView), queueRefreshTaskRowLoop, { flush: "post" });

    return () => {
      const view = props.todayTaskPlanView || { tasks: [], summary: {} };
      const tasks = Array.isArray(view.tasks) ? view.tasks : [];
      const taskRows = flattenTaskPlanRows(tasks);
      const summary = { ...taskPlanSummary(tasks), ...(view.summary || {}) };
      const visibleTasks = props.compact ? tasks.slice(0, 3) : tasks;
      const taskRowCycles = shouldLoopTaskRows.value ? 2 : 1;
      const renderTaskRow = (row, rowIndex, cycleIndex) => {
        const rowKey = taskPlanRowKey(row, rowIndex);
        return h("div", {
          "aria-hidden": cycleIndex > 0 ? "true" : undefined,
          class: ["visual-task-plan-row", "is-flat", row.taskToneClass],
          key: `${cycleIndex}-${rowKey}`,
          style: { "--task-plan-row-color": resolveTaskColor(row.taskCode) },
        }, [
          h("strong", row.taskCode),
          h("span", row.experimentType),
          h("span", row.time),
          h("span", row.lab),
          renderTaskPlanTrayCell(row, cycleIndex > 0),
          h("span", `${row.sampleCount}件`),
        ]);
      };

      return h("div", { ref: taskPlanRoot, class: ["visual-board", "visual-task-plan-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "TODAY PLAN"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "今日任务计划总览屏"),
          ]),
          h("div", { class: ["visual-board-live", "tone-live"] }, "真实数据"),
        ]),
        h("div", { class: "visual-task-plan-main" }, [
          h("div", { class: "visual-board-metrics visual-task-plan-metrics" }, [
            h("div", [h("span", "今日任务"), h("strong", tasks.length)]),
            h("div", [h("span", "实验数量"), h("strong", summary.experiments)]),
            h("div", [h("span", "已分配托盘"), h("strong", summary.assigned)]),
            props.compact ? null : h("div", [h("span", "样品总数"), h("strong", `${summary.samples}件`)]),
          ]),
          props.compact
            ? h("div", { class: "visual-task-plan-compact-list" }, visibleTasks.length
              ? visibleTasks.map((task) =>
                h("div", { class: "visual-task-plan-compact-row", key: task.taskCode }, [
                  h("strong", task.taskCode),
                  h("span", taskPlanExperimentText(task)),
                  h("small", taskPlanCompactTrayText(task)),
                ]),
              )
              : [h("div", { class: "visual-task-plan-empty" }, view.emptyText || "今日暂无实验排程")])
            : h("div", { class: "visual-task-plan-single" }, [
              h("section", { class: "visual-task-plan-variant is-table is-focused" }, [
                h("div", { class: "visual-task-plan-variant-head" }, [
                  h("strong", "今日计划"),
                  h("span", shouldLoopTaskRows.value ? `${view.date || "实时快照"} · 任务循环播放` : view.date || "实时快照"),
                ]),
                h("div", { class: ["visual-task-plan-table", taskRows.length ? "" : "is-empty"] }, [
                  h("div", { class: "visual-task-plan-table-head is-flat" }, ["任务编号", "实验类型", "时间", "试验间", "托盘信息", "样品数"].map((label) => h("span", label))),
                  ...(taskRows.length
                    ? [h("div", { class: ["visual-task-plan-row-viewport", shouldLoopTaskRows.value ? "is-scrollable" : ""] }, [
                      h("div", {
                        class: ["visual-task-plan-row-list", shouldLoopTaskRows.value ? "is-looping" : ""],
                        style: shouldLoopTaskRows.value ? { "--task-plan-row-loop-duration": `${Math.max(24, taskRows.length * 4.5)}s` } : null,
                      }, Array.from({ length: taskRowCycles }, (_, cycleIndex) =>
                        h("div", { class: "visual-task-plan-row-cycle", key: cycleIndex }, taskRows.map((row, rowIndex) =>
                          renderTaskRow(row, rowIndex, cycleIndex),
                        )),
                      )),
                    ])]
                    : [h("div", { class: "visual-task-plan-empty is-table-empty" }, view.emptyText || "今日暂无实验排程")]),
                ]),
              ]),
            ]),
        ]),
      ]);
    };
  },
};
