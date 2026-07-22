import { describe, expect, test } from "vitest";

import { buildLaboratoryWorkbenchView } from "@/modules/laboratory/model";
import {
  buildZancunInventorySections,
  buildZancunRowsFromSnapshot,
} from "@/modules/staging-management/model";
import { buildTrayOverviewRows } from "@/modules/task-overview/model";
import { buildLabProcessPanels } from "@/modules/visualization/model";
import { STORAGE_KEYS } from "@/lib/storageKeys";
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

  test("laboratory tray flow keeps unfinished experiment hints after a later completed experiment", () => {
    const taskCode = "SYLU-2026-07-023";
    const trayCode = `${taskCode}-TP-001`;
    const experiments = [
      { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击二室", status: "实验已完成", axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"] },
      { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击二室", status: "实验进行中" },
      { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "振动试验", required_device: "振动二室", status: "实验进行中", axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"] },
      { task_code: taskCode, experiment_code: `${taskCode}-D`, experiment_name: "霉菌试验", required_device: "霉菌试验室", status: "实验进行中" },
      { task_code: taskCode, experiment_code: `${taskCode}-E`, experiment_name: "高低温湿热试验", required_device: "高低温湿热二室", status: "实验进行中" },
      { task_code: taskCode, experiment_code: `${taskCode}-F`, experiment_name: "盐雾试验", required_device: "盐雾试验室", status: "实验进行中" },
    ];
    const schedules = [
      { id: "schedule-vibration-done", task_code: taskCode, experiment_code: `${taskCode}-C`, device: "振动二室", lab_code: "LAB_VIBRATION_2", status: "实验进行中", start_at: "2026-07-04 08:00:00", sub_experiment_code: `${taskCode}-C-AXIS-001`, axis_codes: ["x+", "y+", "z+"] },
      { id: "schedule-vibration-next", task_code: taskCode, experiment_code: `${taskCode}-C`, device: "振动二室", lab_code: "LAB_VIBRATION_2", status: "已排程", start_at: "2026-07-05 08:00:00", sub_experiment_code: `${taskCode}-C-AXIS-002`, axis_codes: ["x-", "y-", "z-"] },
      { id: "schedule-temp", task_code: taskCode, experiment_code: `${taskCode}-B`, device: "温度冲击二室", status: "实验进行中", start_at: "2026-07-06 08:00:00" },
      { id: "schedule-mold", task_code: taskCode, experiment_code: `${taskCode}-D`, device: "霉菌试验室", status: "实验进行中", start_at: "2026-07-07 08:00:00" },
      { id: "schedule-humid", task_code: taskCode, experiment_code: `${taskCode}-E`, device: "高低温湿热二室", status: "实验进行中", start_at: "2026-07-08 08:00:00" },
      { id: "schedule-salt", task_code: taskCode, experiment_code: `${taskCode}-F`, device: "盐雾试验室", status: "实验进行中", start_at: "2026-07-09 08:00:00" },
    ];
    const experimentTrays = experiments.map((experiment) => ({
      task_code: taskCode,
      experiment_code: experiment.experiment_code,
      tray_code: trayCode,
    }));
    const experimentRuns = [
      {
        run_no: "run-vibration-partial",
        schedule_id: "schedule-vibration-done",
        task_code: taskCode,
        experiment_code: `${taskCode}-C`,
        device: "振动二室",
        status: "实验已完成",
        started_at: "2026-07-02 10:00:00",
        ended_at: "2026-07-02 10:10:00",
        tray_codes: [trayCode],
        sub_experiment_code: `${taskCode}-C-AXIS-001`,
        axis_codes: ["x+", "y+", "z+"],
      },
      {
        run_no: "run-impact-minus",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        device: "冲击二室",
        status: "实验已完成",
        started_at: "2026-07-02 10:30:00",
        ended_at: "2026-07-02 10:40:00",
        tray_codes: [trayCode],
        sub_experiment_code: `${taskCode}-A-AXIS-001`,
        axis_codes: ["x-", "y-", "z-"],
      },
      {
        run_no: "run-impact-plus",
        task_code: taskCode,
        experiment_code: `${taskCode}-A`,
        device: "冲击二室",
        status: "实验已完成",
        started_at: "2026-07-02 11:00:00",
        ended_at: "2026-07-02 11:10:00",
        tray_codes: [trayCode],
        sub_experiment_code: `${taskCode}-A-AXIS-002`,
        axis_codes: ["x+", "y+", "z+"],
      },
    ];
    const experimentRunTrays = experimentRuns.map((run) => ({
      run_no: run.run_no,
      task_code: run.task_code,
      experiment_code: run.experiment_code,
      tray_code: trayCode,
      run_tray_status: "实验已完成",
      status: "实验已完成",
      started_at: run.started_at,
      ended_at: run.ended_at,
      sub_experiment_code: run.sub_experiment_code,
    }));
    const axisSteps = (runNo, experimentCode, subExperimentCode, axisCodes, startedAt) =>
      axisCodes.map((axisCode, index) => ({
        run_no: runNo,
        task_code: taskCode,
        experiment_code: experimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
        started_at: startedAt,
        ended_at: startedAt.replace(":00:00", `:0${index + 1}:00`),
        sub_experiment_code: subExperimentCode,
      }));
    const experimentRunSteps = [
      ...axisSteps("run-vibration-partial", `${taskCode}-C`, `${taskCode}-C-AXIS-001`, ["x+", "y+", "z+"], "2026-07-02 10:00:00"),
      ...axisSteps("run-impact-minus", `${taskCode}-A`, `${taskCode}-A-AXIS-001`, ["x-", "y-", "z-"], "2026-07-02 10:30:00"),
      ...axisSteps("run-impact-plus", `${taskCode}-A`, `${taskCode}-A-AXIS-002`, ["x+", "y+", "z+"], "2026-07-02 11:00:00"),
    ];
    const input = {
      tasks: [{ code: taskCode, test_type: "冲击试验 / 温度冲击试验 / 振动试验 / 霉菌试验 / 高低温湿热试验 / 盐雾试验", status: "任务进行中" }],
      experiments,
      experimentRuns,
      experimentRunSteps,
      experimentRunTrays,
      experimentTrays,
      samples: [
        {
          task_code: taskCode,
          code: `${taskCode}-SP-001`,
          location: "冲击二室",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [{ tray_code: trayCode, quantity: 1, status: "实验已完成", target_lab: "", target_experiment_code: "" }],
          history: [
            { time: "2026-07-02 10:10:00", status: "振动试验部分完成 3/6轴", location: "振动二室", detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴` },
            { time: "2026-07-02 11:10:00", status: "实验已完成", location: "冲击二室", detail: `${taskCode} / 冲击试验 / 实验已完成` },
          ],
        },
      ],
      schedules,
    };

    const centralFlow = buildTrayFlowView({
      ...input,
      taskCode,
      trayCode,
      status: "实验已完成",
    });
    const laboratoryView = buildLaboratoryWorkbenchView({
      ...input,
      labName: "振动二室",
      labCode: "LAB_VIBRATION_2",
      selectedTaskCode: "schedule-vibration-next",
      selectedTrayCode: trayCode,
    });
    const centralLabels = centralFlow.steps.map((step) => step.label);
    const laboratoryLabels = laboratoryView.selectedTrayFlow.steps.map((step) => step.label);
    ["温度冲击试验未完成", "霉菌试验未完成", "高低温湿热试验未完成", "盐雾试验未完成", "待继续振动试验：剩余 3/6轴"].forEach((label) => {
      expect(centralLabels).toContain(label);
      expect(laboratoryLabels).toContain(label);
    });
  });

  test("keeps partial axis history before later comprehensive completion and staging across pages", () => {
    const taskCode = "SYLU-2026-08-002";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const comprehensiveExperimentCode = `${taskCode}-B`;
    const snapshot = {
      tasks: [{ code: taskCode, test_type: "冲击试验 / 四综合试验", status: "任务进行中" }],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          task_code: taskCode,
        },
        {
          experiment_code: comprehensiveExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: comprehensiveExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-07-03 14:18:10",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-07-03 14:19:59",
          experiment_code: comprehensiveExperimentCode,
          run_no: "RUN-COMPREHENSIVE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-03 14:18:10",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-03 14:19:59",
          experiment_code: comprehensiveExperimentCode,
          run_no: "RUN-COMPREHENSIVE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: ["x+", "x-", "y+"].map((axisCode, index) => ({
        axis_code: axisCode,
        ended_at: `2026-07-03 14:18:1${index}`,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        task_code: taskCode,
      })),
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "已到达暂存间",
          history: [
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-07-03 14:21:05",
              tray_code: trayCode,
            },
            {
              action: "送至暂存间",
              detail: `${trayCode} 送至 恒温恒湿间（暂存间）`,
              location: "恒温恒湿间（暂存间）",
              status: "送至暂存间",
              time: "2026-07-03 14:20:30",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-07-03 14:19:59",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击二室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-03 14:18:10",
              tray_code: trayCode,
            },
          ],
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达暂存间",
              target_experiment_code: "",
              target_lab: "",
              tray_code: trayCode,
              updated_at: "2026-07-03 14:21:05",
            },
          ],
          updated_at: "2026-07-03 14:21:05",
        },
      ],
      schedules: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          device: "冲击二室",
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_2",
          start_at: "2026-07-03 14:00:00",
          task_code: taskCode,
        },
        {
          device: "四综合实验室",
          experiment_code: comprehensiveExperimentCode,
          lab_code: "LAB_COMPREHENSIVE",
          start_at: "2026-07-03 14:10:00",
          task_code: taskCode,
        },
      ],
    };

    const centralFlow = buildTrayFlowView({
      ...snapshot,
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      taskCode,
      trayCode,
    });
    const stalePartialSnapshot = {
      ...snapshot,
      samples: snapshot.samples.map((sample) => ({
        ...sample,
        flow_status: "冲击试验部分完成 3/6轴",
        location: "冲击二室",
        status: "冲击试验部分完成 3/6轴",
        trays: sample.trays.map((tray) => ({
          ...tray,
          status: "冲击试验部分完成 3/6轴",
          target_experiment_code: impactExperimentCode,
          target_lab: "冲击二室",
          updated_at: "2026-07-03 14:18:10",
        })),
      })),
    };
    const stalePartialFlow = buildTrayFlowView({
      ...stalePartialSnapshot,
      location: "冲击二室",
      status: "冲击试验部分完成 3/6轴",
      taskCode,
      trayCode,
    });
    const laboratoryView = buildLaboratoryWorkbenchView({
      ...snapshot,
      labCode: "LAB_IMPACT_2",
      labName: "冲击二室",
      selectedTrayCode: trayCode,
    });
    const panels = buildLabProcessPanels({
      ...snapshot,
      labNames: ["冲击二室"],
    });
    const visualTray = panels[0]?.trays.find((tray) => tray.trayCode === trayCode);

    [
      ["central", centralFlow],
      ["stale partial central", stalePartialFlow],
      ["laboratory", laboratoryView.selectedTrayFlow],
      ["visualization", visualTray],
    ].forEach(([viewName, flow]) => {
      const labels = flow.steps.map((step) => step.label);
      expect(flow.status, viewName).toBe("已到达暂存间");
      expect(activeLabel(flow), viewName).toBe("已到达暂存间");
      expect(labels.indexOf("冲击试验部分完成 3/6轴"), viewName).toBeLessThan(labels.indexOf("四综合试验已完成"));
      expect(labels.indexOf("四综合试验已完成"), viewName).toBeLessThan(labels.indexOf("送至暂存间"));
      expect(labels.indexOf("送至暂存间"), viewName).toBeLessThan(labels.indexOf("已到达暂存间"));
    });
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
            { detail: "TASK-SCOPED / 盐雾试验 / 实验准备就绪 / 托盘：TP-001", status: "实验准备就绪", time: "2026-06-05 10:00:00", tray_code: "TP-001" },
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
    expect(activeLabel(view)).toBe("实验准备就绪");
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
            { detail: `${taskCode} / 四综合试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 00:34:38", tray_code: trayCode },
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
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: "EXP-IMPACT",
          run_no: "RUN-IMPACT-001",
          tray_code: trayCode,
          run_tray_status: "实验进行中",
          started_at: "2026-06-04 10:10:00",
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

  test("keeps appearance inspection storage as the stable state after a lab reset across views", () => {
    const taskCode = "SYLU-2026-06-022";
    const trayCode = "SYLU-2026-06-022-TP-001";
    const snapshot = {
      tasks: [{ code: taskCode, test_type: "霉菌试验 / 盐雾试验 / 四综合试验 / 高低温湿热试验", status: "任务进行中" }],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "霉菌试验", required_device: "霉菌试验室", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "高低温湿热试验", required_device: "高低温湿热一室", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      samples: [
        {
          task_code: taskCode,
          code: "SYLU-2026-06-022-SP-001",
          location: "外观检测间",
          status: "实验后外观检测间存放",
          flow_status: "实验后外观检测间存放",
          trays: [{ tray_code: trayCode, quantity: 1, status: "实验后外观检测间存放" }],
          history: [
            { action: "任务切换撤回", detail: `${taskCode} / 高低温湿热试验 / 撤回至实验后外观检测间存放`, status: "实验后外观检测间存放", location: "外观检测间", time: "2026-06-06 22:10:00" },
            { detail: `${taskCode} / 霉菌试验 / 实验已完成`, status: "实验已完成", location: "霉菌试验室", time: "2026-06-06 21:49:03" },
            { detail: `${trayCode} 实验后外观检测间存放`, status: "实验后外观检测间存放", location: "外观检测间", time: "2026-06-06 21:49:30" },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "霉菌试验室", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "高低温湿热一室", status: "已排程" },
      ],
    };

    const directFlow = buildTrayFlowView({
      ...snapshot,
      currentExperimentCode: `${taskCode}-B`,
      location: "外观检测间",
      status: "实验后外观检测间存放",
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
      labName: "高低温湿热一室",
      selectedTrayCode: trayCode,
    });
    const visualizationPanels = buildLabProcessPanels({
      ...snapshot,
      labNames: ["高低温湿热一室"],
    });

    expect(directFlow.status).toBe("实验后外观检测间存放");
    expect(activeLabel(directFlow)).toBe("实验后外观检测间存放");
    expect(overviewRows[0]).toEqual(expect.objectContaining({
      canonicalStatus: "实验后外观检测间存放",
      currentLocation: "外观检测间",
      currentStatus: "实验后外观检测间存放",
      taskCode,
      trayCode,
    }));
    expect(laboratoryView.selectedTrayFlow.status).toBe("实验后外观检测间存放");
    expect(activeLabel(laboratoryView.selectedTrayFlow)).toBe("实验后外观检测间存放");
    const visualTray = visualizationPanels[0]?.trays.find((tray) => tray.trayCode === trayCode);
    expect(visualTray).toEqual(expect.objectContaining({
      canonicalStatus: "实验后外观检测间存放",
      status: "实验后外观检测间存放",
      taskCode,
      trayCode,
    }));
    expect(activeLabel(visualTray)).toBe("实验后外观检测间存放");
  });

  test("keeps SYLU-2026-07-029 partial impact history while post-experiment appearance remains current across views", () => {
    const taskCode = "SYLU-2026-07-029";
    const trayCode = `${taskCode}-TP-001`;
    const experimentCode = `${taskCode}-F`;
    const runNo = "run-20260722122547582807";
    const hotHumidExperimentCode = `${taskCode}-A`;
    const hotHumidRunNo = "run-1784694613820-323";
    const snapshot = {
      tasks: [{ code: taskCode, name: "029真实流程回归", test_type: "高低温湿热试验 / 四综合试验 / 盐雾试验 / 温度冲击试验 / 霉菌试验 / 冲击试验 / 振动试验", status: "任务进行中" }],
      experiments: [
        { experiment_code: hotHumidExperimentCode, experiment_name: "高低温湿热试验", required_device: "高低温湿热试验", status: "实验进行中", task_code: taskCode },
        { experiment_code: `${taskCode}-B`, experiment_name: "四综合试验", required_device: "四综合试验", status: "待排程", task_code: taskCode },
        { experiment_code: `${taskCode}-C`, experiment_name: "盐雾试验", required_device: "盐雾试验", status: "实验进行中", task_code: taskCode },
        { experiment_code: `${taskCode}-D`, experiment_name: "温度冲击试验", required_device: "温度冲击试验", status: "待排程", task_code: taskCode },
        { experiment_code: `${taskCode}-E`, experiment_name: "霉菌试验", required_device: "霉菌试验", status: "已排程", task_code: taskCode },
        { axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"], experiment_code: experimentCode, experiment_name: "冲击试验", required_device: "冲击试验", status: "实验进行中", task_code: taskCode },
        { axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"], experiment_code: `${taskCode}-G`, experiment_name: "振动试验", required_device: "振动试验", status: "待排程", task_code: taskCode },
      ],
      experimentTrays: ["A", "B", "C", "D", "E", "F", "G"].map((suffix) => ({ experiment_code: `${taskCode}-${suffix}`, task_code: taskCode, tray_code: trayCode })),
      experimentRuns: [
        { ended_at: "2026-07-22 12:30:43", experiment_code: hotHumidExperimentCode, run_no: hotHumidRunNo, status: "实验已完成", task_code: taskCode, tray_codes: [trayCode] },
        { axis_codes: ["y-", "z+", "z-"], ended_at: "2026-07-22 12:25:57", experiment_code: experimentCode, run_no: runNo, status: "实验已完成", sub_experiment_code: `${experimentCode}-AXIS-001`, task_code: taskCode, tray_codes: [trayCode] },
      ],
      experimentRunTrays: [
        { ended_at: "2026-07-22 12:30:43", experiment_code: hotHumidExperimentCode, run_no: hotHumidRunNo, run_tray_status: "实验已完成", task_code: taskCode, tray_code: trayCode },
        { ended_at: "2026-07-22 12:25:57", experiment_code: experimentCode, run_no: runNo, run_tray_status: "实验已完成", sub_experiment_code: `${experimentCode}-AXIS-001`, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRunSteps: ["y-", "z+", "z-"].map((axisCode) => ({
        axis_code: axisCode,
        ended_at: "2026-07-22 12:25:57",
        experiment_code: experimentCode,
        run_no: runNo,
        status: "实验已完成",
        sub_experiment_code: `${experimentCode}-AXIS-001`,
        task_code: taskCode,
      })),
      samples: [{
        code: `${taskCode}-SP-001`,
        flow_status: "实验后外观检测间存放",
        history: [
          { action: "实验任务撤回", detail: `${taskCode} / 冲击试验 / 撤回至实验后外观检测间存放（试验间内撤回当前实验任务）`, location: "外观检测间", status: "实验后外观检测间存放", time: "2026-07-22 12:32:46", tray_code: trayCode },
          { action: "任务比对", detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`, location: "冲击二室", status: "已到达实验室", time: "2026-07-22 12:31:49", tray_code: trayCode },
          { action: "外观检测间扫码出库", detail: `${trayCode} 送至 冲击二室`, location: "冲击二室", status: "送至实验室", time: "2026-07-22 12:31:23", tray_code: trayCode },
          { action: "外观检测间扫码入库", detail: `${trayCode} 实验后外观检测间存放`, location: "外观检测间", status: "实验后外观检测间存放", time: "2026-07-22 12:31:15", tray_code: trayCode },
          { action: "实验完成", detail: `${taskCode} / 高低温湿热试验 / 实验已完成`, location: "高低温湿热二室", status: "实验已完成", time: "2026-07-22 12:30:43", tray_code: trayCode },
          { action: "实验完成", detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`, location: "冲击二室", status: "冲击试验部分完成 3/6轴", time: "2026-07-22 12:25:57", tray_code: trayCode },
        ],
        location: "外观检测间",
        status: "实验后外观检测间存放",
        task_code: taskCode,
        trays: [{
          quantity: 1,
          status: "实验后外观检测间存放",
          target_experiment_code: experimentCode,
          target_lab: "冲击二室",
          tray_code: trayCode,
          updated_at: "2026-07-22 12:32:46",
        }],
      }],
      schedules: [
        { device: "高低温湿热二室", experiment_code: hotHumidExperimentCode, id: "schedule-hot-humid", lab_code: "LAB_HOT_HUMID_2", status: "实验进行中", task_code: taskCode },
        { axis_codes: ["y-", "z+", "z-"], device: "冲击二室", experiment_code: experimentCode, id: "schedule-impact-finished-axes", lab_code: "LAB_IMPACT_2", status: "实验进行中", sub_experiment_code: `${experimentCode}-AXIS-001`, task_code: taskCode },
        { axis_codes: ["x-", "y+"], device: "冲击二室", experiment_code: experimentCode, id: "schedule-impact-remaining-axes", lab_code: "LAB_IMPACT_2", status: "已排程", sub_experiment_code: `${experimentCode}-AXIS-002`, task_code: taskCode },
      ],
      stagingEvents: [
        { action: "stock_in", appearance_phase: "post_experiment", location: "外观检测间", room: "appearance", status: "实验后外观检测间存放", task_code: taskCode, time: "2026-07-22 12:31:15", tray_code: trayCode },
        { action: "stock_out", appearance_phase: "post_experiment", room: "appearance", target_experiment_code: experimentCode, target_lab: "冲击二室", task_code: taskCode, time: "2026-07-22 12:31:23", tray_code: trayCode },
        { action: "stock_out_withdraw", room: "appearance", target_experiment_code: experimentCode, target_lab: "冲击二室", task_code: taskCode, time: "2026-07-22 12:32:46", tray_code: trayCode },
      ],
    };

    const directFlow = buildTrayFlowView({
      ...snapshot,
      currentExperimentCode: experimentCode,
      location: "外观检测间",
      status: "实验后外观检测间存放",
      taskCode,
      trayCode,
    });
    const laboratoryFlow = buildLaboratoryWorkbenchView({
      ...snapshot,
      labCode: "LAB_IMPACT_2",
      labName: "冲击二室",
      selectedTrayCode: trayCode,
    }).selectedTrayFlow;
    const overviewRow = buildTrayOverviewRows({
      ...snapshot,
      totalSlots: 1,
      unassignedExperimentLabel: "未分配",
    })[0];
    const visualizationFlow = buildLabProcessPanels({
      ...snapshot,
      labNames: ["冲击二室"],
    })[0]?.trays.find((tray) => tray.trayCode === trayCode);

    [directFlow, laboratoryFlow, visualizationFlow].forEach((flow) => {
      expect(flow.status).toBe("实验后外观检测间存放");
      expect(flow.canonicalStatus).toBe("实验后外观检测间存放");
      expect(activeLabel(flow)).toBe("实验后外观检测间存放");
      expect(flow.steps.find((step) => step.label === "实验后外观检测间存放")).toEqual(
        expect.objectContaining({ active: true, time: "2026-07-22 12:32:46" }),
      );
      expect(flow.steps.find((step) => step.label === "高低温湿热试验已完成")).toEqual(
        expect.objectContaining({ active: false, reached: true, time: "2026-07-22 12:30:43" }),
      );
      expect(flow.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
        expect.objectContaining({ active: false, reached: true, time: "2026-07-22 12:25:57" }),
      );
    });
    [directFlow, laboratoryFlow].forEach((flow) => {
      expect(flow.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验后外观检测间存放`);
    });
    expect(overviewRow).toEqual(expect.objectContaining({
      canonicalStatus: "实验后外观检测间存放",
      currentLocation: "外观检测间",
      currentStatus: "实验后外观检测间存放",
      taskCode,
      trayCode,
    }));
  });

  test("treats high-low temperature humidity as requiring pre-experiment appearance inspection in tray flow", () => {
    const taskCode = "SYLU-2026-06-023";
    const trayCode = "SYLU-2026-06-023-TP-001";
    const snapshot = {
      tasks: [{ code: taskCode, test_type: "振动试验 / 高低温湿热试验", status: "任务进行中" }],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "振动试验", required_device: "振动一室", status: "已排程" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "高低温湿热试验", required_device: "高低温湿热一室", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      samples: [
        {
          task_code: taskCode,
          code: "SYLU-2026-06-023-SP-001",
          location: "外观检测间",
          status: "实验前外观检测间存放",
          flow_status: "实验前外观检测间存放",
          trays: [{ tray_code: trayCode, quantity: 1, status: "实验前外观检测间存放" }],
          history: [
            { detail: `${trayCode} 实验前外观检测间存放`, status: "实验前外观检测间存放", location: "外观检测间", time: "2026-06-07 10:00:00" },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "振动一室", status: "已排程", start_at: "2026-06-08 08:00:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "高低温湿热一室", status: "已排程", start_at: "2026-06-08 10:00:00" },
      ],
    };

    const directFlow = buildTrayFlowView({
      ...snapshot,
      location: "外观检测间",
      status: "实验前外观检测间存放",
      taskCode,
      trayCode,
    });

    expect(activeLabel(directFlow)).toBe("实验前外观检测间存放");
    expect(directFlow.steps).toContainEqual(expect.objectContaining({
      label: "送至高低温湿热一室",
    }));
    expect(directFlow.steps).not.toContainEqual(expect.objectContaining({
      label: "送至振动一室",
    }));
  });

  test("uses central tray state after appearance to staging restore instead of stale sibling sample status", () => {
    const taskCode = "SYLU-2026-06-099";
    const trayCode = "SYLU-2026-06-099-TP-001";
    const snapshot = {
      [STORAGE_KEYS.tasks]: [{ code: taskCode, test_type: "盐雾试验 / 振动试验", status: "任务进行中" }],
      [STORAGE_KEYS.experiments]: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "盐雾试验", required_device: "盐雾试验室", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "振动试验", required_device: "振动一室", status: "已排程" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      [STORAGE_KEYS.experiment_run_trays]: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_no: "RUN-SALT-001",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-08 10:00:00",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          task_code: taskCode,
          code: "SYLU-2026-06-099-SP-001",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          flow_status: "已到达暂存间",
          updated_at: "2026-06-08 10:45:00",
          trays: [
            {
              tray_code: trayCode,
              quantity: 1,
              status: "已到达暂存间",
              target_lab: "振动一室",
              target_experiment_code: `${taskCode}-B`,
              updated_at: "2026-06-08 10:45:00",
            },
          ],
          history: [
            { action: "实验任务撤回", detail: `${taskCode} / 振动试验 / 撤回至已到达暂存间`, location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-06-08 10:45:00", tray_code: trayCode },
            { action: "暂存间扫码入库", detail: `${trayCode} 已到达暂存间`, location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-06-08 10:20:00", tray_code: trayCode },
            { action: "外观检测间扫码出库", detail: `${trayCode} 送至 恒温恒湿间（暂存间）`, location: "恒温恒湿间（暂存间）", status: "送至暂存间", time: "2026-06-08 10:15:00", tray_code: trayCode },
            { action: "外观检测间扫码入库", detail: `${trayCode} 实验后外观检测间存放`, location: "外观检测间", status: "实验后外观检测间存放", time: "2026-06-08 10:10:00", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 盐雾试验 / 实验已完成`, location: "盐雾试验室", status: "实验已完成", time: "2026-06-08 10:00:00", tray_code: trayCode },
          ],
        },
        {
          task_code: taskCode,
          code: "SYLU-2026-06-099-SP-002",
          location: "盐雾试验室",
          status: "实验已完成",
          flow_status: "实验已完成",
          updated_at: "2026-06-08 10:45:00",
          trays: [{ tray_code: trayCode, quantity: 1, status: "实验已完成", updated_at: "2026-06-08 10:45:00" }],
          history: [
            { action: "实验任务撤回", detail: `${taskCode} / 振动试验 / 撤回至盐雾试验已完成`, location: "盐雾试验室", status: "实验已完成", time: "2026-06-08 10:45:00", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 盐雾试验 / 实验已完成`, location: "盐雾试验室", status: "实验已完成", time: "2026-06-08 10:00:00", tray_code: trayCode },
            { action: "送检", detail: `${trayCode} 送至外观检测间`, location: "外观检测间", status: "送至外观检测间", time: "2026-06-08 10:05:00", tray_code: trayCode },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "盐雾试验室", status: "实验已完成", start_at: "2026-06-08 09:00:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "振动一室", status: "已排程", start_at: "2026-06-08 11:00:00" },
      ],
      [STORAGE_KEYS.staging_events]: [
        { action: "stock_out", room: "appearance", task_code: taskCode, tray_code: trayCode, target_lab: "恒温恒湿间（暂存间）", time: "2026-06-08 10:15:00" },
        { action: "stock_in", room: "staging", task_code: taskCode, tray_code: trayCode, time: "2026-06-08 10:20:00" },
        { action: "stock_out", room: "staging", task_code: taskCode, tray_code: trayCode, target_lab: "振动一室", time: "2026-06-08 10:40:00" },
        { action: "stock_out_withdraw", room: "staging", task_code: taskCode, tray_code: trayCode, target_lab: "振动一室", time: "2026-06-08 10:45:00" },
      ],
    };
    const input = {
      tasks: snapshot[STORAGE_KEYS.tasks],
      experiments: snapshot[STORAGE_KEYS.experiments],
      experimentRunTrays: snapshot[STORAGE_KEYS.experiment_run_trays],
      experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
      samples: snapshot[STORAGE_KEYS.samples],
      schedules: snapshot[STORAGE_KEYS.schedules],
    };

    const centralFlow = buildTrayFlowView({
      ...input,
      currentExperimentCode: `${taskCode}-B`,
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      taskCode,
      trayCode,
    });
    const laboratoryView = buildLaboratoryWorkbenchView({
      ...input,
      labName: "振动一室",
      selectedTrayCode: trayCode,
    });
    const visualizationPanels = buildLabProcessPanels({
      ...input,
      labNames: ["振动一室"],
      stagingEvents: snapshot[STORAGE_KEYS.staging_events],
    });
    const visualTray = visualizationPanels[0]?.trays.find((tray) => tray.trayCode === trayCode);
    const stagingRows = buildZancunRowsFromSnapshot(snapshot, { now: "2026-06-08 10:50:00", room: "staging" });
    const stagingSections = buildZancunInventorySections(stagingRows, { room: "staging" });
    const stagingRow = stagingSections.currentStagingRows.find((row) => row.trayCode === trayCode);

    expect(centralFlow.status).toBe("已到达暂存间");
    expect(activeLabel(centralFlow)).toBe("已到达暂存间");
    expect(laboratoryView.selectedTrayFlow.status).toBe(centralFlow.status);
    expect(activeLabel(laboratoryView.selectedTrayFlow)).toBe(activeLabel(centralFlow));
    expect(laboratoryView.selectedTrayRow).toEqual(expect.objectContaining({
      lifecycleLocation: "恒温恒湿间（暂存间）",
      lifecycleStatus: "已到达暂存间",
      trayCode,
    }));
    expect(visualTray).toEqual(expect.objectContaining({
      canonicalStatus: centralFlow.canonicalStatus,
      status: centralFlow.status,
      taskCode,
      trayCode,
    }));
    expect(activeLabel(visualTray)).toBe(activeLabel(centralFlow));
    expect(stagingRow).toEqual(expect.objectContaining({
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      trayCode,
    }));
  });

  test("keeps visualization on the withdrawn staging state when sibling completed sample still points to appearance", () => {
    const taskCode = "SYLU-2026-06-028";
    const trayCode = "SYLU-2026-06-028-TP-001";
    const snapshot = {
      [STORAGE_KEYS.tasks]: [{ code: taskCode, test_type: "霉菌试验 / 盐雾试验" }],
      [STORAGE_KEYS.experiments]: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "霉菌试验", required_device: "霉菌试验室", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "盐雾试验", required_device: "盐雾试验室", status: "已排程" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      [STORAGE_KEYS.experiment_run_trays]: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-11 16:30:35",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          task_code: taskCode,
          code: `${taskCode}-SP-002`,
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          flow_status: "已到达暂存间",
          updated_at: "2026-06-11 16:50:08",
          trays: [{
            tray_code: trayCode,
            quantity: 1,
            status: "已到达暂存间",
            target_lab: "盐雾试验室",
            target_experiment_code: `${taskCode}-B`,
            updated_at: "2026-06-11 16:45:53",
          }],
          history: [
            { action: "实验任务撤回", detail: `${taskCode} / 盐雾试验 / 撤回至已到达暂存间（试验间内撤回当前实验任务）`, location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-06-11 16:45:53", tray_code: trayCode },
            { action: "样品安装", detail: `${taskCode} / 盐雾试验 / 工装夹具安装`, location: "盐雾试验室", status: "工装夹具安装", time: "2026-06-11 16:45:47", tray_code: trayCode },
            { action: "任务比对", detail: `${taskCode} / 盐雾试验 / 已到达实验室`, location: "盐雾试验室", status: "已到达实验室", time: "2026-06-11 16:45:45", tray_code: trayCode },
            { action: "暂存间扫码出库", detail: `${trayCode} 送至 盐雾试验室`, location: "盐雾试验室", status: "送至实验室", time: "2026-06-11 16:45:34" },
            { action: "暂存间扫码入库", detail: `${trayCode} 已到达暂存间`, location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-06-11 16:45:30" },
            { action: "外观检测间扫码出库", detail: `${trayCode} 送至 恒温恒湿间（暂存间）`, location: "恒温恒湿间（暂存间）", status: "送至暂存间", time: "2026-06-11 16:45:24" },
            { action: "外观检测间扫码入库", detail: `${trayCode} 实验后外观检测间存放`, location: "外观检测间", status: "实验后外观检测间存放", time: "2026-06-11 16:44:48" },
            { action: "实验完成", detail: `${taskCode} / 霉菌试验 / 实验已完成`, location: "霉菌试验室", status: "实验已完成", time: "2026-06-11 16:30:35", tray_code: trayCode },
          ],
        },
        {
          task_code: taskCode,
          code: `${taskCode}-SP-001`,
          location: "霉菌试验室",
          status: "实验已完成",
          flow_status: "实验已完成",
          updated_at: "2026-06-11 16:50:08",
          trays: [{ tray_code: trayCode, quantity: 1, status: "实验已完成", updated_at: "2026-06-11 16:45:53" }],
          history: [
            { action: "实验任务撤回", detail: `${taskCode} / 盐雾试验 / 撤回至霉菌试验已完成（试验间内撤回当前实验任务）`, location: "霉菌试验室", status: "实验已完成", time: "2026-06-11 16:45:53", tray_code: trayCode },
            { action: "暂存间扫码出库", detail: `${trayCode} 送至 盐雾试验室`, location: "盐雾试验室", status: "送至实验室", time: "2026-06-11 16:45:34" },
            { action: "外观检测间扫码入库", detail: `${trayCode} 实验后外观检测间存放`, location: "外观检测间", status: "实验后外观检测间存放", time: "2026-06-11 16:44:48" },
            { action: "实验完成", detail: `${taskCode} / 霉菌试验 / 实验已完成`, location: "霉菌试验室", status: "实验已完成", time: "2026-06-11 16:30:35", tray_code: trayCode },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "霉菌试验室", status: "实验已完成", start_at: "2026-06-11 16:00:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "盐雾试验室", status: "已排程", start_at: "2026-06-27 12:00:00" },
      ],
      [STORAGE_KEYS.staging_events]: [
        { action: "stock_in", room: "appearance", task_code: taskCode, tray_code: trayCode, time: "2026-06-11 16:44:48" },
        { action: "stock_out", room: "appearance", task_code: taskCode, tray_code: trayCode, target_lab: "恒温恒湿间（暂存间）", target_type: "staging", time: "2026-06-11 16:45:24" },
        { action: "stock_in", room: "staging", task_code: taskCode, tray_code: trayCode, time: "2026-06-11 16:45:30" },
        { action: "stock_out", room: "staging", task_code: taskCode, tray_code: trayCode, target_lab: "盐雾试验室", target_experiment_code: `${taskCode}-B`, target_type: "lab", time: "2026-06-11 16:45:34" },
        { action: "stock_out_withdraw", room: "staging", task_code: taskCode, tray_code: trayCode, target_lab: "盐雾试验室", target_experiment_code: `${taskCode}-B`, time: "2026-06-11 16:45:53" },
      ],
    };

    const centralFlow = buildTrayFlowView({
      tasks: snapshot[STORAGE_KEYS.tasks],
      experiments: snapshot[STORAGE_KEYS.experiments],
      experimentRunTrays: snapshot[STORAGE_KEYS.experiment_run_trays],
      experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
      samples: snapshot[STORAGE_KEYS.samples],
      schedules: snapshot[STORAGE_KEYS.schedules],
      currentExperimentCode: `${taskCode}-B`,
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      taskCode,
      trayCode,
    });
    const visualizationPanels = buildLabProcessPanels({
      tasks: snapshot[STORAGE_KEYS.tasks],
      experiments: snapshot[STORAGE_KEYS.experiments],
      experimentRunTrays: snapshot[STORAGE_KEYS.experiment_run_trays],
      experimentTrays: snapshot[STORAGE_KEYS.experiment_trays],
      labNames: ["盐雾试验室"],
      samples: snapshot[STORAGE_KEYS.samples],
      schedules: snapshot[STORAGE_KEYS.schedules],
      stagingEvents: snapshot[STORAGE_KEYS.staging_events],
    });
    const visualTray = visualizationPanels[0]?.trays.find((tray) => tray.trayCode === trayCode);

    expect(centralFlow.status).toBe("已到达暂存间");
    expect(activeLabel(centralFlow)).toBe("已到达暂存间");
    expect(visualTray).toEqual(expect.objectContaining({
      canonicalStatus: centralFlow.canonicalStatus,
      status: centralFlow.status,
      taskCode,
      trayCode,
    }));
    expect(activeLabel(visualTray)).toBe(activeLabel(centralFlow));
  });
});
