import { h, ref } from "vue";
import { formatLocalDateTime } from "@/lib/dateTime";
import { resolveVisualFlowStepTitle, visualFlowStepClass } from "../flowStepState";
import { findSelectedLabTask, findSelectedLabTray } from "./helpers";

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
  const formatted = formatLocalDateTime(text) || text;
  return formatted.length >= 19 ? formatted.slice(5, 19) : formatted;
};

export const LabProcessScreen = {
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
            h("div", { class: "visual-board-title" }, props.screen?.group === "secondary" ? props.screen.name : "例行试验站智能控制中心"),
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
              const flowLayoutColumns = props.compact ? FLOW_LAYOUT_COLUMNS.compact : FLOW_LAYOUT_COLUMNS.layoutA;

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
                    h(
                      "div",
                      { class: ["visual-lab-state", lab.alert ? "is-alert" : "is-ok", lab.healthState ? `is-${lab.healthState}` : ""] },
                      lab.healthLabel || (lab.alert ? "复核" : "正常"),
                    ),
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
                          (props.compact ? compactFlowSteps(tray.steps) : tray.steps || displayedFlowSteps).map((step, stepIndex) =>
                            h("div", {
                              class: ["visual-flow-step", stepClass(step), flowStepConnectorClass(stepIndex, flowLayoutColumns)],
                              title: resolveVisualFlowStepTitle(step, formatBeijingFlowTime),
                            }, [
                              h("span", { class: "visual-flow-dot" }),
                              h("strong", step.label),
                              h("small", { "aria-hidden": "true" }, ""),
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






const stepClass = (step) => visualFlowStepClass(step);

const FLOW_LAYOUT_COLUMNS = {
  layoutA: 4,
  compact: 4,
};

const flowStepConnectorClass = (index, columnCount = FLOW_LAYOUT_COLUMNS.layoutA) => {
  if (index === 0) {
    return "is-connector-none";
  }
  const safeColumnCount = Math.max(1, Number(columnCount) || FLOW_LAYOUT_COLUMNS.layoutA);
  const row = Math.floor(index / safeColumnCount);
  const column = index % safeColumnCount;
  if (column === 0) {
    return "is-connector-turn";
  }
  return row % 2 === 0 ? "is-connector-forward" : "is-connector-backward";
};

