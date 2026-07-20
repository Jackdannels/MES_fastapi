import { h } from "vue";

const renderTaskPlanTrayCell = (entry) => {
  const trays = Array.isArray(entry.trays) ? entry.trays : [];
  if (!trays.length) {
    return h("span", { class: "is-pending" }, "待分配托盘");
  }
  return h("div", { class: "visual-task-plan-tray-list has-tray" }, trays.map((tray, index) =>
    h("span", { class: "visual-task-plan-tray-chip", "data-testid": "visual-task-plan-tray-chip", key: `${tray}-${index}` }, tray),
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

export const TodayTaskPlanScreen = {
  name: "TodayTaskPlanScreen",
  props: {
    compact: { type: Boolean, default: false },
    screen: { type: Object, required: false, default: null },
    todayTaskPlanView: { type: Object, required: false, default: null },
  },
  setup(props) {
    return () => {
      const view = props.todayTaskPlanView || { tasks: [], summary: {} };
      const tasks = Array.isArray(view.tasks) ? view.tasks : [];
      const taskRows = flattenTaskPlanRows(tasks);
      const summary = { ...taskPlanSummary(tasks), ...(view.summary || {}) };
      const visibleTasks = props.compact ? tasks.slice(0, 3) : tasks;

      return h("div", { class: ["visual-board", "visual-task-plan-board", props.compact ? "is-compact" : ""] }, [
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
                  h("span", view.date || "实时快照"),
                ]),
                h("div", { class: ["visual-task-plan-table", taskRows.length ? "" : "is-empty"] }, [
                  h("div", { class: "visual-task-plan-table-head is-flat" }, ["任务编号", "实验类型", "时间", "试验间", "托盘信息", "样品数"].map((label) => h("span", label))),
                  ...(taskRows.length
                    ? taskRows.map((row) =>
                      h("div", { class: ["visual-task-plan-row", "is-flat", row.taskToneClass], key: `${row.taskCode}-${row.experimentCode || row.experimentType}` }, [
                        h("strong", row.taskCode),
                        h("span", row.experimentType),
                        h("span", row.time),
                        h("span", row.lab),
                        renderTaskPlanTrayCell(row),
                        h("span", `${row.sampleCount}件`),
                      ]),
                    )
                    : [h("div", { class: "visual-task-plan-empty is-table-empty" }, view.emptyText || "今日暂无实验排程")]),
                ]),
              ]),
            ]),
        ]),
      ]);
    };
  },
};
