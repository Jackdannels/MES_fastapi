import { describe, expect, test, vi } from "vitest";

import { completionConfirmationMatches, useLaboratoryCompletionFlow } from "./useLaboratoryCompletionFlow";

const ref = (value) => ({ value });

describe("useLaboratoryCompletionFlow completion action", () => {
  test("clicking experiment complete immediately requests the upper computer end command", async () => {
    let resolveEndRequest;
    const requestMqttExperimentEnd = vi.fn(() => new Promise((resolve) => {
      resolveEndRequest = resolve;
    }));
    const persistRunningExperimentCompletion = vi.fn();
    const completionAwaitingConfirmation = ref(null);
    const completionConfirmationError = ref("old confirmation error");
    const completionSubmitting = ref(false);
    const runningModalVisible = ref(true);
    const flushPendingRealtimeRefresh = vi.fn();
    const runWithAttendance = vi.fn((operation) => operation());
    const flow = useLaboratoryCompletionFlow({
      axisContinuation: ref({}),
      clearRunningModalRestoreTimer: vi.fn(),
      completionAwaitingConfirmation,
      completionConfirmationError,
      completionSubmitting,
      completedRunningExperiment: ref(null),
      currentTask: ref({
        experimentCode: "SYLU-2026-07-001-B",
        subExperimentCode: "SYLU-2026-07-001-B-SALT",
        taskCode: "SYLU-2026-07-001",
      }),
      experimentRunSteps: ref([]),
      experimentRunTrays: ref([]),
      experimentRuns: ref([]),
      experiments: ref([]),
      flushPendingRealtimeRefresh,
      laboratoryConfig: ref({ labCode: "LAB_SALT" }),
      load: vi.fn(),
      persistRunningExperimentCompletion,
      requestMqttExperimentEnd,
      runWithAttendance,
      runningExperiment: ref({
        active: true,
        runNo: "RUN-SALT-001",
        subExperimentCode: "SYLU-2026-07-001-B-SALT",
        trayCodes: ["SYLU-2026-07-001-TP-001"],
      }),
      runningModalVisible,
      samples: ref([]),
      schedules: ref([]),
      usesMqttCompletion: () => true,
    });

    const completionAction = flow.completeExperimentNow();

    expect(runWithAttendance).toHaveBeenCalledOnce();
    expect(completionSubmitting.value).toBe(true);
    expect(completionConfirmationError.value).toBe("");
    expect(requestMqttExperimentEnd).toHaveBeenCalledWith({
      axis_code: "",
      experiment_code: "SYLU-2026-07-001-B",
      lab_code: "LAB_SALT",
      next_axis_code: "",
      run_no: "RUN-SALT-001",
      sub_experiment_code: "SYLU-2026-07-001-B-SALT",
      task_code: "SYLU-2026-07-001",
    });
    resolveEndRequest(true);
    await completionAction;
    expect(persistRunningExperimentCompletion).not.toHaveBeenCalled();
    expect(runningModalVisible.value).toBe(true);
    expect(completionSubmitting.value).toBe(false);
    expect(completionAwaitingConfirmation.value).toMatchObject({
      axisCode: "",
      experimentCode: "SYLU-2026-07-001-B",
      nextAxisCode: "",
      runNo: "RUN-SALT-001",
      taskCode: "SYLU-2026-07-001",
    });
    expect(completionAwaitingConfirmation.value.requestedAt).toEqual(expect.any(Number));
    expect(flushPendingRealtimeRefresh).toHaveBeenCalledOnce();

    await flow.completeExperimentNow();
    expect(requestMqttExperimentEnd).toHaveBeenCalledOnce();
  });

  test("routes hot humid laboratory two completion through the upper computer", async () => {
    const requestMqttExperimentEnd = vi.fn().mockResolvedValue(true);
    const persistRunningExperimentCompletion = vi.fn();
    const runningModalVisible = ref(true);
    const flow = useLaboratoryCompletionFlow({
      axisContinuation: ref({}),
      clearRunningModalRestoreTimer: vi.fn(),
      completionSubmitting: ref(false),
      completedRunningExperiment: ref(null),
      currentTask: ref({ experimentCode: "EXP-HH2", taskCode: "TASK-HH2" }),
      experimentRunSteps: ref([]),
      experimentRunTrays: ref([]),
      experimentRuns: ref([]),
      experiments: ref([]),
      flushPendingRealtimeRefresh: vi.fn(),
      laboratoryConfig: ref({ labCode: "LAB_HOT_HUMID_2" }),
      load: vi.fn(),
      persistRunningExperimentCompletion,
      requestMqttExperimentEnd,
      runWithAttendance: (operation) => operation(),
      runningExperiment: ref({ active: true, runNo: "RUN-HH2", trayCodes: ["TP-HH2"] }),
      runningModalVisible,
      samples: ref([]),
      schedules: ref([]),
      usesMqttCompletion: () => true,
    });

    await flow.completeExperimentNow();

    expect(requestMqttExperimentEnd).toHaveBeenCalledWith({
      axis_code: "",
      experiment_code: "EXP-HH2",
      lab_code: "LAB_HOT_HUMID_2",
      next_axis_code: "",
      run_no: "RUN-HH2",
      sub_experiment_code: "",
      task_code: "TASK-HH2",
    });
    expect(persistRunningExperimentCompletion).not.toHaveBeenCalled();
    expect(runningModalVisible.value).toBe(true);
  });
});

describe("completionConfirmationMatches", () => {
  const pending = {
    axisCode: "",
    experimentCode: "EXP-001",
    runNo: "RUN-001",
    taskCode: "TASK-001",
  };

  test("matches the completed experiment run by run number", () => {
    expect(completionConfirmationMatches(pending, [
      { run_no: "RUN-001", status: "实验已完成" },
    ], [])).toBe(true);
  });

  test("matches the completed axis step by run number and axis", () => {
    expect(completionConfirmationMatches(
      { ...pending, axisCode: "X" },
      [{ run_no: "RUN-001", status: "实验中" }],
      [{ axis_code: "X", run_no: "RUN-001", status: "实验已完成" }],
    )).toBe(true);
  });

  test("does not accept a completion from an unrelated run", () => {
    expect(completionConfirmationMatches(pending, [
      { run_no: "RUN-002", status: "实验已完成" },
    ], [])).toBe(false);
  });
});
