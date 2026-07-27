import { describe, expect, test } from "vitest";

import { buildLaboratoryAxisContinuation } from "./laboratoryAxisContinuation";

const buildState = (targetStatus) => buildLaboratoryAxisContinuation({
  currentTask: {
    axisCodes: ["x+", "x-"],
    experimentCode: "EXP-AXIS",
    id: "SCHEDULE-AXIS",
    taskCode: "TASK-AXIS",
  },
  experimentRuns: [{
    axis_codes: ["x+", "x-"],
    experiment_code: "EXP-AXIS",
    run_no: "RUN-AXIS",
    schedule_id: "SCHEDULE-AXIS",
    sub_experiment_code: "SUB-AXIS",
    task_code: "TASK-AXIS",
  }],
  experimentRunSteps: [
    { axis_code: "x+", run_no: "RUN-AXIS", status: "实验已完成", step_no: 1 },
    { axis_code: "x-", run_no: "RUN-AXIS", status: targetStatus, step_no: 2 },
  ],
  runningExperiment: { runNo: "RUN-AXIS" },
  schedules: [{
    axis_codes: ["x+", "x-"],
    id: "SCHEDULE-AXIS",
    sub_experiment_code: "SUB-AXIS",
  }],
});

describe("buildLaboratoryAxisContinuation axis transition", () => {
  test("exposes the target axis while fixture adjustment is pending", () => {
    expect(buildState("轴向调整中")).toEqual(expect.objectContaining({
      canContinue: true,
      completedAxisCodes: ["x+"],
      currentAxisCode: "x-",
      currentStepStatus: "轴向调整中",
      isAdjusting: true,
      isWaitingForStart: false,
      runAxisCodes: ["x+", "x-"],
      runNo: "RUN-AXIS",
      scheduleId: "SCHEDULE-AXIS",
      subExperimentCode: "SUB-AXIS",
    }));
  });

  test("restores the disabled waiting stage from the persisted step status", () => {
    expect(buildState("等待上位机启动")).toEqual(expect.objectContaining({
      currentAxisCode: "x-",
      isAdjusting: false,
      isWaitingForStart: true,
      statusLabel: "等待上位机启动 1/2轴",
    }));
  });
});
