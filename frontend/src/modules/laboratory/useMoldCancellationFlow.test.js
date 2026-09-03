import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";

import {
  MOLD_CANCELLATION_DEFAULT_REASON,
  moldCancellationConfirmationMatches,
  useMoldCancellationFlow,
} from "./useMoldCancellationFlow";

const buildFlow = ({ labCode = "LAB_MOLD", running = true } = {}) => {
  const state = {
    cancellationAwaitingConfirmation: ref(null),
    cancellationConfirmationError: ref(""),
    cancellationDangerModalOpen: ref(false),
    cancellationReason: ref(""),
    cancellationReasonError: ref(""),
    cancellationReasonModalOpen: ref(false),
    cancellationSubmitting: ref(false),
    completionAwaitingConfirmation: ref(null),
    completionSubmitting: ref(false),
    currentTask: ref({ experimentCode: "EXP-MOLD", taskCode: "TASK-MOLD" }),
    laboratoryConfig: ref({ labCode }),
    requestCancellation: vi.fn().mockResolvedValue({ cancelRequestId: "CANCEL-1", published: true }),
    runningExperiment: ref({ active: running, experimentCode: "EXP-MOLD", runNo: "RUN-MOLD", taskCode: "TASK-MOLD" }),
  };
  return { flow: useMoldCancellationFlow(state), state };
};

describe("useMoldCancellationFlow", () => {
  test("only enables cancellation for a running LAB_MOLD experiment", () => {
    expect(buildFlow().flow.canCancelMoldExperiment.value).toBe(true);
    expect(buildFlow({ labCode: "LAB_SALT" }).flow.canCancelMoldExperiment.value).toBe(false);
    expect(buildFlow({ running: false }).flow.canCancelMoldExperiment.value).toBe(false);
  });

  test("requires a reason, performs the second confirmation, and waits for authoritative cancellation", async () => {
    const { flow, state } = buildFlow();
    flow.openCancellationReasonModal();
    expect(state.cancellationReasonModalOpen.value).toBe(true);
    expect(state.cancellationReason.value).toBe(MOLD_CANCELLATION_DEFAULT_REASON);

    state.cancellationReason.value = "";
    flow.continueCancellationConfirmation();
    expect(state.cancellationReasonError.value).toBe("请填写取消原因。");
    expect(state.cancellationDangerModalOpen.value).toBe(false);

    state.cancellationReason.value = "培养物未按预期繁殖";
    flow.continueCancellationConfirmation();
    expect(state.cancellationDangerModalOpen.value).toBe(true);
    await flow.confirmMoldCancellation();

    expect(state.requestCancellation).toHaveBeenCalledWith({
      cancel_reason: "培养物未按预期繁殖",
      experiment_code: "EXP-MOLD",
      lab_code: "LAB_MOLD",
      run_no: "RUN-MOLD",
      task_code: "TASK-MOLD",
    });
    expect(state.runningExperiment.value.active).toBe(true);
    expect(state.cancellationAwaitingConfirmation.value).toEqual(expect.objectContaining({
      cancelRequestId: "CANCEL-1",
      runNo: "RUN-MOLD",
    }));
    expect(flow.canCancelMoldExperiment.value).toBe(false);
  });

  test("accepts only the matching run's canceled status as confirmation", () => {
    const pending = { experimentCode: "EXP-MOLD", runNo: "RUN-MOLD", taskCode: "TASK-MOLD" };
    expect(moldCancellationConfirmationMatches(pending, [
      { run_no: "RUN-MOLD", status: "实验已完成" },
      { run_no: "RUN-OTHER", status: "实验已取消" },
    ])).toBe(false);
    expect(moldCancellationConfirmationMatches(pending, [
      { run_no: "RUN-MOLD", status: "实验已取消" },
    ])).toBe(true);
  });
});
