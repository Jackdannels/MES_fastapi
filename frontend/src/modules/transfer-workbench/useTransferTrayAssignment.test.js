import { ref } from "vue";
import { describe, expect, test, vi } from "vitest";

import { useTransferTrayAssignment } from "./useTransferTrayAssignment";

const createAssignment = () => useTransferTrayAssignment({
  currentTask: ref({ taskNo: "TASK-001", taskStatus: "未入库" }),
  mode: ref("pre-allocation"),
  pendingStatus: "未入库",
  selectedTaskId: ref(1),
  showWorkbenchFeedback: vi.fn(),
  storedStatus: "到货",
});

const createTenTrayScenario = (experimentCount = 8) => ({
  experiments: Array.from({ length: experimentCount }, (_, index) => ({
    experimentCode: `EXP-${index + 1}`,
    experimentName: `试验 ${index + 1}`,
  })),
  trays: Array.from({ length: 10 }, (_, index) => ({
    trayId: index + 1,
    trayNo: `TRAY-${String(index + 1).padStart(2, "0")}`,
    samples: [{ sampleId: index + 1, sampleNo: `SAMPLE-${index + 1}` }],
  })),
});

describe("transfer tray experiment assignment", () => {
  test("assigns every experiment to all 10 trays as one batch", () => {
    const assignment = createAssignment();
    const scenario = createTenTrayScenario();
    assignment.experiments.value = scenario.experiments;
    assignment.assignedTrays.value = scenario.trays;
    assignment.rebuildTrayExperimentLabels();

    assignment.assignAllExperimentsToAllTrays();

    expect(Object.values(assignment.draftExperimentTraySelections.value)).toEqual(
      scenario.experiments.map(() => scenario.trays.map((tray) => tray.trayNo)),
    );
    expect(assignment.assignedTrays.value.every((tray) => tray.experimentCodes.length === 8)).toBe(true);
    expect(assignment.hasCompleteExperimentTrayAllocation.value).toBe(true);
    expect(assignment.buildAllocationPayload().experimentTrays).toEqual(
      scenario.experiments.map((experiment) => ({
        experimentCode: experiment.experimentCode,
        trayIds: scenario.trays.map((tray) => tray.trayId),
      })),
    );
  });

  test("updates one of 10 tray cards without rebuilding the other nine", () => {
    const assignment = createAssignment();
    const scenario = createTenTrayScenario();
    assignment.experiments.value = scenario.experiments;
    assignment.assignedTrays.value = scenario.trays;
    assignment.rebuildTrayExperimentLabels();
    assignment.assignAllExperimentsToAllTrays();
    assignment.setAssignmentMode(scenario.experiments[0].experimentCode);
    const previousTrays = [...assignment.assignedTrays.value];

    assignment.toggleExperimentTraySelection(0);

    expect(assignment.assignedTrays.value[0]).not.toBe(previousTrays[0]);
    expect(assignment.assignedTrays.value.slice(1)).toEqual(previousTrays.slice(1));
    assignment.assignedTrays.value.slice(1).forEach((tray, index) => {
      expect(tray).toBe(previousTrays[index + 1]);
    });
    expect(assignment.draftExperimentTraySelections.value[scenario.experiments[0].experimentCode]).toHaveLength(9);
    expect(assignment.hasCompleteExperimentTrayAllocation.value).toBe(true);
  });
});
