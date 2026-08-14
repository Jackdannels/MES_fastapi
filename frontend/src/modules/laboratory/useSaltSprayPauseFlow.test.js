import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useSaltSprayPauseFlow } from "./useSaltSprayPauseFlow";

const mountFlow = ({ labCode = "LAB_SALT", paused = false } = {}) => {
  const run = {
    experiment_code: "EXP-SALT",
    run_no: "RUN-SALT",
    status: paused ? "实验暂停" : "实验进行中",
    task_code: "TASK-SALT",
  };
  const experimentRuns = ref([run]);
  const experimentRunPauses = ref(paused ? [{
    inspection_tray_codes: ["TRAY-1"],
    pause_no: "PAUSE-1",
    paused_at: "2026-08-12T10:00:00+08:00",
    run_no: "RUN-SALT",
    status: "实验暂停",
  }] : []);
  const samples = ref([]);
  const stagingEvents = ref([]);
  const requestPause = vi.fn(async () => true);
  const requestResume = vi.fn(async () => true);
  const requestStop = vi.fn(async () => true);
  let flow;
  const wrapper = mount(defineComponent({
    setup() {
      flow = useSaltSprayPauseFlow({
        currentTask: ref({ activeRun: run, experimentCode: "EXP-SALT", taskCode: "TASK-SALT" }),
        experimentRunPauses,
        experimentRuns,
        laboratoryConfig: ref({ labCode }),
        refreshAuthoritativeState: vi.fn(async () => {}),
        requestPause,
        requestResume,
        requestStop,
        runWithAttendance: async (callback) => callback(),
        runningExperiment: ref({ active: true, experimentCode: "EXP-SALT", runNo: "RUN-SALT", taskCode: "TASK-SALT", trayCodes: ["TRAY-1"] }),
        samples,
        stagingEvents,
      });
      return () => null;
    },
  }));
  return { experimentRunPauses, experimentRuns, flow, requestPause, requestResume, requestStop, samples, stagingEvents, wrapper };
};

describe("useSaltSprayPauseFlow", () => {
  afterEach(() => vi.useRealTimers());

  test("is scoped to LAB_SALT and sends pause_reason without locally changing run status", async () => {
    vi.useFakeTimers();
    const salt = mountFlow();
    const other = mountFlow({ labCode: "LAB_IMPACT" });

    expect(salt.flow.isSaltSprayLaboratory.value).toBe(true);
    expect(other.flow.isSaltSprayLaboratory.value).toBe(false);
    other.flow.openPauseModal();
    expect(other.flow.pauseModalOpen.value).toBe(false);

    salt.flow.openPauseModal();
    await salt.flow.confirmPause();

    expect(salt.requestPause).toHaveBeenCalledWith(expect.objectContaining({
      inspection_tray_codes: ["TRAY-1"],
      pause_reason: "中途外观检查",
      run_no: "RUN-SALT",
    }));
    expect(salt.flow.isPaused.value).toBe(false);
    expect(salt.flow.controlAwaitingConfirmation.value?.action).toBe("pause");
    salt.wrapper.unmount();
    other.wrapper.unmount();
  });

  test("simulates pause confirmation only with the pause_no returned by the preceding command", async () => {
    vi.useFakeTimers();
    const mounted = mountFlow();
    mounted.requestPause.mockResolvedValue({ pauseNo: "PAUSE-COMMAND-1", published: true });
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal("fetch", fetch);

    mounted.flow.openPauseModal();
    await mounted.flow.confirmPause();
    expect(mounted.flow.canSimulatePauseConfirmation.value).toBe(true);
    await mounted.flow.simulatePauseConfirmation();

    expect(fetch).toHaveBeenCalledWith("/api/mq/laboratory/events/experiment-paused", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"pause_no":"PAUSE-COMMAND-1"'),
    }));
    mounted.wrapper.unmount();
    vi.unstubAllGlobals();
  });

  test("opens retry only after the backend 15-second command lock has expired", async () => {
    vi.useFakeTimers();
    const mounted = mountFlow();

    mounted.flow.openPauseModal();
    await mounted.flow.confirmPause();
    vi.advanceTimersByTime(15_999);
    expect(mounted.flow.controlAwaitingConfirmation.value?.action).toBe("pause");

    vi.advanceTimersByTime(1);
    expect(mounted.flow.controlAwaitingConfirmation.value).toBeNull();
    expect(mounted.flow.controlConfirmationError.value).toContain("16 秒内未收到上位机确认");
    mounted.wrapper.unmount();
  });

  test("enables resume after the selected tray returned to LAB_SALT even when the optional conclusion is blank", async () => {
    vi.useFakeTimers();
    const mounted = mountFlow({ paused: true });
    expect(mounted.flow.canResume.value).toBe(false);

    mounted.stagingEvents.value = [{
      action: "stock_out",
      appearance_phase: "mid_experiment",
      inspection_result: "",
      pause_no: "PAUSE-1",
      room: "appearance",
      run_no: "RUN-SALT",
      target_lab_code: "LAB_SALT",
      time: "2026-08-12T10:20:00+08:00",
      tray_code: "TRAY-1",
    }];
    mounted.samples.value = [{
      location: "盐雾试验室",
      trays: [{ status: "等待恢复实验", tray_code: "TRAY-1" }],
    }];
    await nextTick();

    expect(mounted.flow.canResume.value).toBe(true);
    await mounted.flow.requestContinue();
    expect(mounted.requestResume).toHaveBeenCalledWith(expect.objectContaining({
      pause_no: "PAUSE-1",
      run_no: "RUN-SALT",
    }));
    expect(mounted.flow.isPaused.value).toBe(true);
    mounted.wrapper.unmount();
  });

  test("includes pause_no and termination classification in stop request", async () => {
    vi.useFakeTimers();
    const mounted = mountFlow({ paused: true });
    mounted.flow.openStopModal();
    mounted.flow.stopType.value = "abnormal";
    mounted.flow.stopReason.value = "设备故障";
    await mounted.flow.confirmStop();

    expect(mounted.requestStop).toHaveBeenCalledWith(expect.objectContaining({
      pause_no: "PAUSE-1",
      termination_reason: "设备故障",
      termination_type: "abnormal",
    }));
    expect(mounted.flow.isPaused.value).toBe(true);
    mounted.wrapper.unmount();
  });
});
