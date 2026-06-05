import { describe, expect, test } from "vitest";

import { buildLaboratoryWorkbenchView } from "@/modules/laboratory/model";
import { buildTrayOverviewRows } from "@/modules/task-overview/model";
import { buildLabProcessPanels } from "@/modules/visualization/model";
import { buildTrayFlowView } from "./samplesFlowModel";

describe("tray flow consistency", () => {
  const activeLabel = (flow) => flow?.steps?.find((step) => step.active)?.label || "";
  const trayCodesForPanel = (panels, labName) =>
    panels.find((panel) => panel.name === labName)?.trays.map((tray) => tray.trayCode) || [];

  const buildCrossBatchSnapshot = () => {
    const taskCode = "SYLU-2026-06-001";
    const tray001 = "SYLU-2026-06-001-TP-001";
    const tray002 = "SYLU-2026-06-001-TP-002";
    const tray003 = "SYLU-2026-06-001-TP-003";
    const experiments = [
      { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "盐雾试验", required_device: "盐雾试验室", status: "实验进行中" },
      { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "振动试验", required_device: "振动一室", status: "实验进行中" },
      { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "四综合试验", required_device: "四综合实验室", status: "实验进行中" },
    ];
    const schedules = [
      { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "盐雾试验室", status: "实验进行中", start_at: "2026-06-05 08:00:00" },
      { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "振动一室", status: "实验进行中", start_at: "2026-06-05 08:00:00" },
      { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "四综合实验室", status: "实验进行中", start_at: "2026-06-05 08:00:00" },
    ];
    const experimentTrays = experiments.flatMap((experiment) =>
      [tray001, tray002, tray003].map((trayCode) => ({
        task_code: taskCode,
        experiment_code: experiment.experiment_code,
        tray_code: trayCode,
      })),
    );
    const completedRunTrays = [
      [`${taskCode}-A`, tray001, "2026-06-05 00:29:16"],
      [`${taskCode}-A`, tray002, "2026-06-05 08:50:46"],
      [`${taskCode}-B`, tray003, "2026-06-05 08:52:03"],
      [`${taskCode}-C`, tray001, "2026-06-05 00:34:38"],
      [`${taskCode}-C`, tray002, "2026-06-05 00:34:38"],
    ].map(([experimentCode, trayCode, endedAt], index) => ({
      run_no: `run-${index}`,
      task_code: taskCode,
      experiment_code: experimentCode,
      tray_code: trayCode,
      run_tray_status: "实验已完成",
      ended_at: endedAt,
    }));
    const completedHistory = (trayCode, items) => items.flatMap(([experimentName, labName, time]) => [
      { detail: `${taskCode} / ${experimentName} / 实验进行中 / 托盘：${trayCode}`, status: "实验进行中", location: labName, time },
      { detail: `${taskCode} / ${experimentName} / 实验已完成`, status: "实验已完成", location: labName, time },
    ]);
    const sample = (trayCode, location, completedItems) => ({
      task_code: taskCode,
      code: trayCode.replace("TP", "SP"),
      location,
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [{ tray_code: trayCode, quantity: 1, status: "实验已完成", target_lab: "", target_experiment_code: "" }],
      history: completedHistory(trayCode, completedItems),
    });
    return {
      taskCode,
      tray001,
      tray002,
      tray003,
      tasks: [{ code: taskCode, test_type: "盐雾试验 / 振动试验 / 四综合试验", status: "任务进行中" }],
      experiments,
      experimentRunTrays: completedRunTrays,
      experimentRuns: completedRunTrays.map((relation) => ({
        run_no: relation.run_no,
        task_code: relation.task_code,
        experiment_code: relation.experiment_code,
        status: "实验已完成",
        ended_at: relation.ended_at,
        tray_codes: [relation.tray_code],
      })),
      experimentTrays,
      samples: [
        sample(tray001, "四综合实验室", [["盐雾试验", "盐雾试验室", "2026-06-05 00:29:16"], ["四综合试验", "四综合实验室", "2026-06-05 00:34:38"]]),
        sample(tray002, "四综合实验室", [["盐雾试验", "盐雾试验室", "2026-06-05 08:50:46"], ["四综合试验", "四综合实验室", "2026-06-05 00:34:38"]]),
        sample(tray003, "振动一室", [["振动试验", "振动一室", "2026-06-05 08:52:03"]]),
      ],
      schedules,
    };
  };

  test("keeps cross-batch tray experiment states scoped by task tray and experiment", () => {
    const snapshot = buildCrossBatchSnapshot();
    const directVibrationFlow = buildTrayFlowView({
      ...snapshot,
      currentExperimentCode: `${snapshot.taskCode}-B`,
      location: "四综合实验室",
      status: "实验已完成",
      taskCode: snapshot.taskCode,
      trayCode: snapshot.tray001,
    });
    const directSaltFlow = buildTrayFlowView({
      ...snapshot,
      currentExperimentCode: `${snapshot.taskCode}-A`,
      location: "振动一室",
      status: "实验已完成",
      taskCode: snapshot.taskCode,
      trayCode: snapshot.tray003,
    });
    const overviewRows = buildTrayOverviewRows({
      ...snapshot,
      totalSlots: 3,
      unassignedExperimentLabel: "未分配",
    });
    const vibrationView = buildLaboratoryWorkbenchView({
      ...snapshot,
      labName: "振动一室",
      selectedTrayCode: snapshot.tray003,
    });
    const panels = buildLabProcessPanels({
      ...snapshot,
      labNames: ["盐雾试验室", "振动一室", "四综合实验室"],
    });

    expect(directVibrationFlow.status).not.toBe("振动试验进行中");
    expect(directSaltFlow.status).not.toBe("盐雾试验进行中");
    expect(overviewRows.find((row) => row.trayCode === snapshot.tray003)?.currentStatus).not.toMatch(/盐雾试验进行中|四综合试验进行中/);
    expect(vibrationView.currentExperimentTrayRows.map((row) => row.trayCode)).toEqual([snapshot.tray001, snapshot.tray002]);
    expect(vibrationView.selectedTrayRow?.trayCode).toBe(snapshot.tray001);
    expect(vibrationView.currentExperimentTrayRows.find((row) => row.trayCode === snapshot.tray001)?.trayStatus).not.toBe("实验进行中");
    expect(activeLabel(vibrationView.selectedTrayFlow)).not.toBe("振动试验进行中");
    expect(trayCodesForPanel(panels, "盐雾试验室")).toEqual([snapshot.tray003]);
    expect(trayCodesForPanel(panels, "振动一室")).toEqual([snapshot.tray001, snapshot.tray002]);
    expect(trayCodesForPanel(panels, "四综合实验室")).toEqual([snapshot.tray003]);
    expect(panels.find((panel) => panel.name === "振动一室")?.trays[0]?.status).not.toBe("振动试验进行中");
  });

  test("visualization filtering uses tray scoped run completion without task tray cross-talk", () => {
    const panels = buildLabProcessPanels({
      labNames: ["盐雾试验室", "振动一室"],
      experiments: [
        { task_code: "TASK-A", experiment_code: "TASK-A-SALT", experiment_name: "盐雾试验", required_device: "盐雾试验室", status: "实验进行中" },
        { task_code: "TASK-B", experiment_code: "TASK-B-VIB", experiment_name: "振动试验", required_device: "振动一室", status: "实验进行中" },
      ],
      experimentRuns: [
        {
          run_no: "RUN-A-SALT-001",
          task_code: "TASK-A",
          experiment_code: "TASK-A-SALT",
          status: "实验已完成",
          tray_codes: ["TP-001"],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-A-SALT-001",
          task_code: "TASK-A",
          experiment_code: "TASK-A-SALT",
          tray_code: "TP-001",
          run_tray_status: "实验已完成",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-A", experiment_code: "TASK-A-SALT", tray_code: "TP-001" },
        { task_code: "TASK-B", experiment_code: "TASK-B-VIB", tray_code: "TP-001" },
      ],
      schedules: [
        { task_code: "TASK-A", experiment_code: "TASK-A-SALT", device: "盐雾试验室", status: "实验进行中" },
        { task_code: "TASK-B", experiment_code: "TASK-B-VIB", device: "振动一室", status: "实验进行中" },
      ],
      samples: [
        {
          code: "TASK-A-SP-001",
          task_code: "TASK-A",
          location: "盐雾试验室",
          status: "实验已完成",
          trays: [{ tray_code: "TP-001", status: "实验已完成", quantity: 1 }],
          history: [],
        },
        {
          code: "TASK-B-SP-001",
          task_code: "TASK-B",
          location: "",
          status: "运输中",
          trays: [{ tray_code: "TP-001", status: "运输中", quantity: 1 }],
          history: [],
        },
      ],
    });

    expect(trayCodesForPanel(panels, "盐雾试验室")).toEqual([]);
    expect(trayCodesForPanel(panels, "振动一室")).toEqual(["TP-001"]);
    expect(panels.find((panel) => panel.name === "振动一室")?.trays[0]?.taskCode).toBe("TASK-B");
  });

  test("does not treat generic running history as tray scoped running evidence", () => {
    const view = buildTrayFlowView({
      currentExperimentCode: "TASK-GENERIC-A",
      experiments: [
        { task_code: "TASK-GENERIC", experiment_code: "TASK-GENERIC-A", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-GENERIC", experiment_code: "TASK-GENERIC-B", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-GENERIC", experiment_code: "TASK-GENERIC-A", tray_code: "TP-002" },
        { task_code: "TASK-GENERIC", experiment_code: "TASK-GENERIC-B", tray_code: "TP-002" },
      ],
      samples: [
        {
          code: "SP-002",
          task_code: "TASK-GENERIC",
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [{ tray_code: "TP-002", status: "已到达实验室", quantity: 1 }],
          history: [
            { detail: "TASK-GENERIC / 盐雾试验 / 实验进行中", status: "实验进行中", time: "2026-06-05 10:00:00" },
          ],
        },
      ],
      schedules: [
        { task_code: "TASK-GENERIC", experiment_code: "TASK-GENERIC-A", device: "盐雾试验室", status: "实验进行中" },
        { task_code: "TASK-GENERIC", experiment_code: "TASK-GENERIC-B", device: "振动一室", status: "已排程" },
      ],
      status: "已到达实验室",
      taskCode: "TASK-GENERIC",
      trayCode: "TP-002",
    });

    expect(view.status).not.toBe("盐雾试验进行中");
    expect(activeLabel(view)).toBe("已到达实验室");
  });

  test("does not let later generic running history inherit earlier tray scoped evidence", () => {
    const view = buildTrayFlowView({
      currentExperimentCode: "TASK-SCOPED-A",
      experiments: [
        { task_code: "TASK-SCOPED", experiment_code: "TASK-SCOPED-A", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-SCOPED", experiment_code: "TASK-SCOPED-B", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-SCOPED", experiment_code: "TASK-SCOPED-A", tray_code: "TP-001" },
        { task_code: "TASK-SCOPED", experiment_code: "TASK-SCOPED-B", tray_code: "TP-001" },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-SCOPED",
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [{ tray_code: "TP-001", status: "已到达实验室", quantity: 1 }],
          history: [
            { detail: "TASK-SCOPED / 盐雾试验 / 实验进行中", status: "实验进行中", time: "2026-06-05 10:10:00" },
            { detail: "TASK-SCOPED / 盐雾试验 / 实验准备就绪 / 托盘：TP-001", status: "实验准备就绪", time: "2026-06-05 10:00:00" },
          ],
        },
      ],
      schedules: [
        { task_code: "TASK-SCOPED", experiment_code: "TASK-SCOPED-A", device: "盐雾试验室", status: "实验进行中" },
        { task_code: "TASK-SCOPED", experiment_code: "TASK-SCOPED-B", device: "振动一室", status: "已排程" },
      ],
      status: "已到达实验室",
      taskCode: "TASK-SCOPED",
      trayCode: "TP-001",
    });

    expect(view.status).not.toBe("盐雾试验进行中");
    expect(activeLabel(view)).toBe("已到达实验室");
  });

  test("does not treat a tray code prefix as tray scoped running history", () => {
    const view = buildTrayFlowView({
      currentExperimentCode: "TASK-PREFIX-A",
      experiments: [
        { task_code: "TASK-PREFIX", experiment_code: "TASK-PREFIX-A", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: "TASK-PREFIX", experiment_code: "TASK-PREFIX-B", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-PREFIX", experiment_code: "TASK-PREFIX-A", tray_code: "TP-001" },
        { task_code: "TASK-PREFIX", experiment_code: "TASK-PREFIX-A", tray_code: "TP-0010" },
        { task_code: "TASK-PREFIX", experiment_code: "TASK-PREFIX-B", tray_code: "TP-001" },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-PREFIX",
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [{ tray_code: "TP-001", status: "已到达实验室", quantity: 1 }],
          history: [
            { detail: "TASK-PREFIX / 盐雾试验 / 实验进行中 / 托盘：TP-0010", status: "实验进行中", time: "2026-06-05 10:00:00" },
          ],
        },
      ],
      schedules: [
        { task_code: "TASK-PREFIX", experiment_code: "TASK-PREFIX-A", device: "盐雾试验室", status: "实验进行中" },
        { task_code: "TASK-PREFIX", experiment_code: "TASK-PREFIX-B", device: "振动一室", status: "已排程" },
      ],
      status: "已到达实验室",
      taskCode: "TASK-PREFIX",
      trayCode: "TP-001",
    });

    expect(view.status).not.toBe("盐雾试验进行中");
    expect(activeLabel(view)).toBe("已到达实验室");
  });

  test("keeps TP-002 on the salt-spray arrival flow after completing four-comprehensive across pages", () => {
    const taskCode = "SYLU-2026-06-001";
    const trayCode = "SYLU-2026-06-001-TP-002";
    const snapshot = {
      tasks: [{ code: taskCode, test_type: "盐雾试验 / 振动试验 / 四综合试验", status: "实验进行中" }],
      experiments: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-A", experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-B", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-C", experiment_name: "四综合试验", required_device: "四综合实验室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-A", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-B", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-C", tray_code: trayCode },
      ],
      samples: [
        {
          task_code: taskCode,
          code: "SYLU-2026-06-001-SP-005",
          location: "盐雾试验室",
          status: "已到达实验室",
          trays: [
            {
              tray_code: trayCode,
              quantity: 1,
              status: "已到达实验室",
              target_lab: "四综合实验室",
            },
          ],
          history: [
            { detail: `${taskCode} / 四综合试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 00:34:38" },
            { detail: `${trayCode} -> 盐雾试验室`, status: "送至实验室", location: "盐雾试验室", time: "2026-06-05 00:43:40" },
            { detail: `${taskCode} / 盐雾试验 / 已到达实验室`, status: "已到达实验室", location: "盐雾试验室", time: "2026-06-05 00:43:50" },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-A", device: "盐雾试验室", start_at: "2026-06-05 08:00:00" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-B", device: "振动一室", start_at: "2026-06-05 09:00:00" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-C", device: "四综合实验室", start_at: "2026-06-05 10:00:00" },
      ],
    };
    const activeLabel = (flow) => flow?.steps?.find((step) => step.active)?.label;
    const stepState = (flow) => flow?.steps?.map((step) => [step.label, step.active, step.reached]);

    const directFlow = buildTrayFlowView({
      ...snapshot,
      currentExperimentCode: "SYLU-2026-06-001-A",
      dispatchTargetLab: "四综合实验室",
      location: "盐雾试验室",
      status: "已到达实验室",
      taskCode,
      trayCode,
    });
    const overviewRows = buildTrayOverviewRows({
      ...snapshot,
      totalSlots: 1,
      unassignedExperimentLabel: "未分配",
    });
    const laboratoryView = buildLaboratoryWorkbenchView({
      ...snapshot,
      labName: "盐雾试验室",
      selectedTrayCode: trayCode,
    });
    const visualizationPanels = buildLabProcessPanels({
      ...snapshot,
      labNames: ["盐雾试验室", "四综合实验室", "振动一室"],
    });
    const saltTray = visualizationPanels
      .find((panel) => panel.name === "盐雾试验室")
      ?.trays.find((tray) => tray.trayCode === trayCode);
    const comprehensiveTray = visualizationPanels
      .find((panel) => panel.name === "四综合实验室")
      ?.trays.find((tray) => tray.trayCode === trayCode);

    expect(activeLabel(directFlow)).toBe("已到达实验室");
    expect(directFlow.steps.map((step) => step.label)).toContain("送至盐雾试验室");
    expect(directFlow.steps.map((step) => step.label)).not.toContain("送至四综合实验室");
    expect(directFlow.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(directFlow.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ reached: true }),
    );
    expect(overviewRows[0]).toEqual(expect.objectContaining({
      canonicalStatus: "已到达实验室",
      currentLocation: "盐雾试验室",
      currentStatus: "已到达实验室",
      taskCode,
      trayCode,
    }));
    expect(activeLabel(laboratoryView.selectedTrayFlow)).toBe("已到达实验室");
    expect(saltTray).toEqual(expect.objectContaining({
      canonicalStatus: "已到达实验室",
      status: "已到达实验室",
      taskCode,
      trayCode,
    }));
    expect(activeLabel(saltTray)).toBe("已到达实验室");
    expect(stepState(saltTray)).toEqual(stepState(directFlow));
    expect(comprehensiveTray).toBeUndefined();
  });

  test("uses the same tray-scoped running flow across overview laboratory and visualization", () => {
    const taskCode = "TASK-CONSISTENT-FLOW";
    const trayCode = "TP-001";
    const snapshot = {
      tasks: [{ code: taskCode, test_type: "冲击试验 / 温度冲击试验 / 振动试验", status: "实验进行中" }],
      experiments: [
        { task_code: taskCode, experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "实验进行中" },
        { task_code: taskCode, experiment_code: "EXP-TEMP", experiment_name: "温度冲击试验", status: "已排程" },
        { task_code: taskCode, experiment_code: "EXP-VIBRATION", experiment_name: "振动试验", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "EXP-IMPACT", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "EXP-TEMP", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "EXP-VIBRATION", tray_code: trayCode },
      ],
      experimentRuns: [
        {
          task_code: taskCode,
          experiment_code: "EXP-IMPACT",
          run_no: "RUN-IMPACT-001",
          status: "实验进行中",
          started_at: "2026-06-04 10:10:00",
          tray_codes: [trayCode],
        },
      ],
      samples: [
        {
          task_code: taskCode,
          code: "SP-001",
          location: "冲击一室",
          status: "实验进行中",
          trays: [
            {
              tray_code: trayCode,
              quantity: 1,
              status: "实验进行中",
              target_lab: "冲击一室",
              target_experiment_code: "EXP-IMPACT",
            },
          ],
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验准备就绪`, status: "实验准备就绪", time: "2026-06-04 10:00:00" },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: "EXP-IMPACT", device: "冲击一室", start_at: "2026-06-04 10:00:00" },
        { task_code: taskCode, experiment_code: "EXP-TEMP", device: "温度冲击一室", start_at: "2026-06-04 12:00:00" },
        { task_code: taskCode, experiment_code: "EXP-VIBRATION", device: "振动一室", start_at: "2026-06-04 14:00:00" },
      ],
    };

    const directFlow = buildTrayFlowView({
      ...snapshot,
      currentExperimentCode: "EXP-IMPACT",
      location: "冲击一室",
      status: "实验进行中",
      taskCode,
      trayCode,
    });
    const overviewRows = buildTrayOverviewRows({
      ...snapshot,
      totalSlots: 1,
      unassignedExperimentLabel: "未分配",
    });
    const laboratoryView = buildLaboratoryWorkbenchView({
      ...snapshot,
      labName: "冲击一室",
      selectedTrayCode: trayCode,
    });
    const visualizationPanel = buildLabProcessPanels({
      ...snapshot,
      labNames: ["冲击一室", "温度冲击一室", "振动一室"],
    }).find((panel) => panel.name === "冲击一室");

    expect(directFlow.status).toBe("冲击试验进行中");
    expect(directFlow.canonicalStatus).toBe("冲击试验进行中");
    expect(overviewRows[0].currentStatus).toBe("冲击试验进行中");
    expect(overviewRows[0].canonicalStatus).toBe("冲击试验进行中");
    expect(laboratoryView.selectedTrayFlow.status).toBe("冲击试验进行中");
    expect(laboratoryView.selectedTrayFlow.canonicalStatus).toBe("冲击试验进行中");
    expect(visualizationPanel?.trays[0]?.status).toBe("冲击试验进行中");
    expect(visualizationPanel?.trays[0]?.canonicalStatus).toBe("冲击试验进行中");
    expect(visualizationPanel?.trays[0]?.steps.find((step) => step.active)?.label).toBe("冲击试验进行中");
  });
});
