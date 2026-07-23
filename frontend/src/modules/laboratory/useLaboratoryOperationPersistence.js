import {
  applyLaboratoryOperation,
  completeLaboratoryExperiment,
} from "@/lib/laboratoryApi";
import { formatLocalDateTime } from "@/lib/dateTime";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import {
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
} from "./model";
import { countTrayRowSamples } from "./laboratoryConfig";
import {
  generateFixtureInstallId,
  normalizeText,
  resolveSubExperimentCode,
  scheduleAxisCodes,
} from "./pageHelpers";

function useLaboratoryOperationPersistence({
  applyExperimentStartAttendance,
  currentTask,
  experimentRunSteps,
  experimentRunTrays,
  experimentRuns,
  experiments,
  getCurrentTaskTrayCodesByStatus,
  getCurrentTaskTrayRowsByStatus,
  laboratoryConfig,
  samples,
  schedules,
  tasks,
  verifiedTrayCodes,
}) {
  let samplesPersistQueue = null;

  const buildFixtureInstallPayload = ({ trayCodes = [] } = {}) => {
    const comparedRows = getCurrentTaskTrayRowsByStatus(LAB_COMPARE_STATUS);
    const targetTrayRows = comparedRows.length > 0
      ? comparedRows
      : getCurrentTaskTrayRowsByStatus(LAB_INSTALL_STATUS);
    const stepTrayCodes = [
      ...trayCodes,
      ...targetTrayRows.map((row) => String(row?.trayCode || "").trim()),
    ].map((trayCode) => String(trayCode || "").trim()).filter(Boolean);
    const resolvedTrayCodes = Array.from(new Set(
      stepTrayCodes.length > 0
        ? stepTrayCodes
        : (Array.isArray(currentTask.value?.trayCodes) ? currentTask.value.trayCodes : [])
          .map((trayCode) => String(trayCode || "").trim())
          .filter(Boolean),
    ));
    return {
      experiment_code: currentTask.value?.experimentCode || "",
      fixture_install_id: generateFixtureInstallId(),
      lab_code: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
      sample_count: countTrayRowSamples(targetTrayRows),
      sample_type: "",
      task_code: currentTask.value?.taskCode || "",
      tray_codes: resolvedTrayCodes,
    };
  };

  const buildReadyPayload = () => {
    const axisCodes = scheduleAxisCodes(currentTask.value);
    const subExperimentCode = resolveSubExperimentCode(currentTask.value);
    const payload = {
      experiment_code: currentTask.value?.experimentCode || "",
      lab_code: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
      schedule_id: currentTask.value?.id || "",
      task_code: currentTask.value?.taskCode || "",
    };
    const axisBatchNo = currentTask.value?.axis_batch_no || currentTask.value?.axisBatchNo || "";
    if (axisBatchNo) {
      payload.axis_batch_no = axisBatchNo;
    }
    if (axisCodes.length > 0) {
      payload.axis_codes = axisCodes;
      payload.current_axis_code = axisCodes[0];
    }
    if (subExperimentCode) {
      payload.sub_experiment_code = subExperimentCode;
    }
    return payload;
  };

  const applyOperationResponse = (payload = {}) => {
    if (Array.isArray(payload?.tasks)) {
      tasks.value = payload.tasks;
    }
    if (Array.isArray(payload?.samples)) {
      samples.value = payload.samples;
    }
    if (Array.isArray(payload?.schedules)) {
      schedules.value = payload.schedules;
    }
    if (Array.isArray(payload?.experiments)) {
      experiments.value = payload.experiments;
    }
  };

  const applyExperimentStartResponse = (payload = {}) => {
    if (payload?.attendanceSession && typeof payload.attendanceSession === "object") {
      applyExperimentStartAttendance(payload.attendanceSession);
    }
    applyOperationResponse(payload);
    if (Array.isArray(payload?.experimentRuns)) {
      experimentRuns.value = payload.experimentRuns;
    }
    if (Array.isArray(payload?.experimentRunTrays)) {
      experimentRunTrays.value = payload.experimentRunTrays;
    }
    if (Array.isArray(payload?.experimentRunSteps)) {
      experimentRunSteps.value = payload.experimentRunSteps;
    }
  };

  const queueLaboratoryOperation = (operation) => {
    const persistOperation = samplesPersistQueue
      ? samplesPersistQueue.catch(() => {}).then(operation)
      : operation();
    const trackedOperation = persistOperation.finally(() => {
      if (samplesPersistQueue === trackedOperation) {
        samplesPersistQueue = null;
      }
    });
    samplesPersistQueue = trackedOperation;
    return persistOperation;
  };

  const persistRunningExperimentCompletion = (payload) => {
    const writeCompletion = () => completeLaboratoryExperiment(payload);
    const persistOperation = samplesPersistQueue
      ? samplesPersistQueue.catch(() => {}).then(writeCompletion)
      : writeCompletion();
    const trackedOperation = persistOperation.finally(() => {
      if (samplesPersistQueue === trackedOperation) {
        samplesPersistQueue = null;
      }
    });
    samplesPersistQueue = trackedOperation;
    return persistOperation;
  };

  const operationTypeForStatus = (nextStatus) => {
    const normalizedStatus = normalizeText(nextStatus);
    if (normalizedStatus === LAB_COMPARE_STATUS) {
      return "compare";
    }
    if (normalizedStatus === LAB_INSTALL_STATUS) {
      return "install";
    }
    if (normalizedStatus === LAB_READY_STATUS) {
      return "ready";
    }
    return "";
  };

  const persistCurrentTaskStep = async (nextStatus, options = {}) => {
    const normalizedOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const trayCodeOverride = normalizedOptions.trayCodes || null;
    const actionTime = formatLocalDateTime();
    const targetTrayCodes = Array.isArray(trayCodeOverride)
      ? trayCodeOverride
      : nextStatus === LAB_COMPARE_STATUS
        ? verifiedTrayCodes.value
        : nextStatus === LAB_INSTALL_STATUS
          ? getCurrentTaskTrayCodesByStatus(LAB_COMPARE_STATUS)
          : nextStatus === LAB_READY_STATUS
            ? getCurrentTaskTrayCodesByStatus(LAB_INSTALL_STATUS)
            : currentTask.value?.trayCodes;
    const operationType = operationTypeForStatus(nextStatus);
    if (!operationType || !currentTask.value) {
      return;
    }
    const payload = await queueLaboratoryOperation(() => applyLaboratoryOperation({
      experimentCode: currentTask.value?.experimentCode,
      labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
      labName: laboratoryConfig.value.labName,
      occurredAt: actionTime,
      operationType,
      subExperimentCode: resolveSubExperimentCode(currentTask.value),
      taskCode: currentTask.value?.taskCode,
      trayCodes: targetTrayCodes,
    }));
    applyOperationResponse(payload);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
  };

  const persistFixtureReadyForTask = async ({ taskCode, trayCodes }) => {
    const targetTaskCode = String(taskCode || "").trim();
    const targetTrayCodes = new Set(
      (Array.isArray(trayCodes) ? trayCodes : [])
        .map((code) => String(code || "").trim())
        .filter(Boolean),
    );
    if (!targetTaskCode || targetTrayCodes.size === 0) {
      return;
    }
    const payload = await queueLaboratoryOperation(() => applyLaboratoryOperation({
      experimentCode: currentTask.value?.experimentCode,
      labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
      labName: laboratoryConfig.value.labName,
      operationType: "fixtureReady",
      taskCode: targetTaskCode,
      trayCodes: Array.from(targetTrayCodes),
    }));
    applyOperationResponse(payload);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
  };

  return {
    applyExperimentStartResponse,
    buildFixtureInstallPayload,
    buildReadyPayload,
    persistCurrentTaskStep,
    persistFixtureReadyForTask,
    persistRunningExperimentCompletion,
  };
}

export { useLaboratoryOperationPersistence };
