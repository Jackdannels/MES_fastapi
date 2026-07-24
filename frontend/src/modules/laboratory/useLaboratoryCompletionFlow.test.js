import { describe, expect, test, vi } from "vitest";

import { useLaboratoryCompletionFlow } from "./useLaboratoryCompletionFlow";

const ref = (value) => ({ value });

describe("useLaboratoryCompletionFlow MQTT completion", () => {
  test("requests the upper computer to end the run without using hostless persistence", async () => {
    const requestMqttExperimentEnd = vi.fn().mockResolvedValue(true);
    const persistRunningExperimentCompletion = vi.fn();
    const completePromptVisible = ref(true);
    const runningModalVisible = ref(true);
    const openAttendanceLogoutPrompt = vi.fn();
    const flushPendingRealtimeRefresh = vi.fn();
    const flow = useLaboratoryCompletionFlow({
      axisContinuation: ref({}),
      clearRunningModalRestoreTimer: vi.fn(),
      completePromptVisible,
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
      openAttendanceLogoutPrompt,
      persistRunningExperimentCompletion,
      requestMqttExperimentEnd,
      runWithAttendance: (operation) => operation(),
      runningExperiment: ref({
        active: true,
        runNo: "RUN-SALT-001",
        subExperimentCode: "SYLU-2026-07-001-B-SALT",
        trayCodes: ["SYLU-2026-07-001-TP-001"],
      }),
      runningModalVisible,
      samples: ref([]),
      scheduleCompletedRunningModalAutoClose: vi.fn(),
      schedules: ref([]),
      usesMqttCompletion: () => true,
    });

    await flow.confirmCompleteExperiment();

    expect(requestMqttExperimentEnd).toHaveBeenCalledWith({
      axis_code: "",
      experiment_code: "SYLU-2026-07-001-B",
      lab_code: "LAB_SALT",
      next_axis_code: "",
      run_no: "RUN-SALT-001",
      sub_experiment_code: "SYLU-2026-07-001-B-SALT",
      task_code: "SYLU-2026-07-001",
    });
    expect(persistRunningExperimentCompletion).not.toHaveBeenCalled();
    expect(completePromptVisible.value).toBe(false);
    expect(runningModalVisible.value).toBe(true);
    expect(openAttendanceLogoutPrompt).not.toHaveBeenCalled();
    expect(flushPendingRealtimeRefresh).toHaveBeenCalledOnce();
  });

  test("keeps high-temperature humid laboratory two on local hostless completion", async () => {
    const requestMqttExperimentEnd = vi.fn();
    const persistRunningExperimentCompletion = vi.fn().mockResolvedValue({
      experimentRuns: [],
      experiments: [{
        experiment_code: "EXP-HH2",
        status: "实验已完成",
        task_code: "TASK-HH2",
      }],
      samples: [],
      schedules: [],
    });
    const flow = useLaboratoryCompletionFlow({
      axisContinuation: ref({}),
      clearRunningModalRestoreTimer: vi.fn(),
      completePromptVisible: ref(true),
      completedRunningExperiment: ref(null),
      currentTask: ref({ experimentCode: "EXP-HH2", taskCode: "TASK-HH2" }),
      experimentRunSteps: ref([]),
      experimentRunTrays: ref([]),
      experimentRuns: ref([]),
      experiments: ref([]),
      flushPendingRealtimeRefresh: vi.fn(),
      laboratoryConfig: ref({ labCode: "LAB_HOT_HUMID_2" }),
      load: vi.fn(),
      openAttendanceLogoutPrompt: vi.fn(),
      persistRunningExperimentCompletion,
      requestMqttExperimentEnd,
      runWithAttendance: (operation) => operation(),
      runningExperiment: ref({ active: true, runNo: "RUN-HH2", trayCodes: ["TP-HH2"] }),
      runningModalVisible: ref(true),
      samples: ref([]),
      scheduleCompletedRunningModalAutoClose: vi.fn(),
      schedules: ref([]),
      usesMqttCompletion: () => false,
    });

    await flow.confirmCompleteExperiment();

    expect(persistRunningExperimentCompletion).toHaveBeenCalledOnce();
    expect(requestMqttExperimentEnd).not.toHaveBeenCalled();
  });
});
