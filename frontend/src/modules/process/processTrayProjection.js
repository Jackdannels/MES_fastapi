import { trayExperimentRunIsCompleted } from "@/modules/experiment-progress/model";
import { normalizeLifecycleStatus, resolveFlowStatusByLocation } from "@/modules/samples/samplesFlowModel";
import {
  COMPLETED_TRAY_STATUSES,
  RUNNING_TRAY_STATUSES,
  TRAY_STATUS_READY,
  asArray,
  normalizeLocationList,
  normalizeText,
  resolveTrayFlowStatusRank,
  summarizeUniqueTexts,
  toText,
  trayBelongsToLab,
  trayHasUnknownLocation,
} from "./processLabCatalog";

function createProcessTrayProjection({ scheduleSelection, state }) {
  const {
    getScheduledExperimentName,
    getScheduledLabName,
    getScheduledStartTime,
    getTaskSamples,
  } = scheduleSelection;

  const isSharedExperimentTray = (taskCode, trayCode) => {
    const experimentCodes = new Set();
    state.experimentTrays.value.forEach((entry) => {
      if (normalizeText(entry?.task_code) !== normalizeText(taskCode) || normalizeText(entry?.tray_code) !== normalizeText(trayCode)) {
        return;
      }
      const experimentCode = normalizeText(entry?.experiment_code);
      if (experimentCode) {
        experimentCodes.add(experimentCode);
      }
    });
    return experimentCodes.size > 1;
  };

  const resolveReadyBlockedReason = (row, options = {}) => {
    if (!row?.isReady) {
      return "";
    }
    const taskCode = normalizeText(options.taskCode);
    const experimentCode = normalizeText(options.experimentCode);
    const trayCode = normalizeText(row?.trayCode);
    if (!taskCode || !experimentCode || !trayCode || !isSharedExperimentTray(taskCode, trayCode)) {
      return "";
    }
    const targetExperimentCodes = asArray(row?.targetExperimentCodes).map(normalizeText).filter(Boolean);
    if (row?.hasCurrentExperimentReadyEvidence === true) {
      return "";
    }
    if (targetExperimentCodes.length > 0 && !targetExperimentCodes.includes(experimentCode)) {
      const targetExperimentName = getScheduledExperimentName(taskCode, targetExperimentCodes[0]);
      return `托盘正在${targetExperimentName || "其他实验"}中，不能开始当前实验`;
    }
    const labName = normalizeText(options.labName);
    if (!labName || trayBelongsToLab(row, labName) || trayHasUnknownLocation(row)) {
      return "";
    }
    return "托盘正在其他实验中，不能开始当前实验";
  };

  const collectExperimentTrayCodes = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return [];
    }
    const trayCodes = new Set();
    state.experimentTrays.value.forEach((entry) => {
      if (normalizeText(entry?.task_code) !== normalizedTaskCode || normalizeText(entry?.experiment_code) !== normalizedExperimentCode) {
        return;
      }
      const trayCode = normalizeText(entry?.tray_code);
      if (trayCode) {
        trayCodes.add(trayCode);
      }
    });
    return Array.from(trayCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  };

  const buildExperimentRunTrayStatusMap = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const trayStatusMap = new Map();
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return trayStatusMap;
    }
    const scopedRunTrays = state.experimentRunTrays.value.filter((relation) =>
      normalizeText(relation?.task_code) === normalizedTaskCode
      && normalizeText(relation?.experiment_code) === normalizedExperimentCode);
    if (scopedRunTrays.length > 0) {
      scopedRunTrays.forEach((relation) => {
        const trayCode = normalizeText(relation?.tray_code || relation?.tray_no);
        if (!trayCode) {
          return;
        }
        const status = normalizeLifecycleStatus("", normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status));
        const isRunning = RUNNING_TRAY_STATUSES.has(status);
        const isCompleted = trayExperimentRunIsCompleted({
          experimentCode: normalizedExperimentCode,
          experimentRunSteps: state.experimentRunSteps.value,
          experimentRunTrays: [relation],
          experiments: state.experiments.value,
          taskCode: normalizedTaskCode,
          trayCode,
        });
        if (!isRunning && !isCompleted) {
          return;
        }
        const current = trayStatusMap.get(trayCode) || { isCompleted: false, isRunning: false };
        trayStatusMap.set(trayCode, {
          isCompleted: current.isCompleted || isCompleted,
          isRunning: current.isRunning || isRunning,
        });
      });
    }
    return trayStatusMap;
  };

  const collectTaskTrayCodes = (taskCode, experimentCode = "") => {
    const experimentTrayCodes = collectExperimentTrayCodes(taskCode, experimentCode);
    if (experimentTrayCodes.length) {
      return experimentTrayCodes;
    }
    const trayCodes = new Set();
    state.experimentTrays.value.forEach((entry) => {
      if (normalizeText(entry?.task_code) !== taskCode) {
        return;
      }
      const normalized = normalizeText(entry?.tray_code);
      if (normalized) {
        trayCodes.add(normalized);
      }
    });
    return Array.from(trayCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  };

  const collectExperimentSampleCodes = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return [];
    }
    const sampleCodes = new Set();
    state.experimentSamples.value.forEach((entry) => {
      if (normalizeText(entry?.task_code) !== normalizedTaskCode || normalizeText(entry?.experiment_code) !== normalizedExperimentCode) {
        return;
      }
      const sampleCode = normalizeText(entry?.sample_code || entry?.sample_no);
      if (sampleCode) {
        sampleCodes.add(sampleCode);
      }
    });
    return Array.from(sampleCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  };

  const sampleTrayShowsCurrentExperimentReady = ({ experimentCode, labName, sample, taskCode, tray }) => {
    const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status));
    if (trayStatus !== TRAY_STATUS_READY) {
      return false;
    }
    const targetExperimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
    if (targetExperimentCode) {
      if (targetExperimentCode === normalizeText(experimentCode)) {
        return true;
      }
      const targetStart = getScheduledStartTime(taskCode, targetExperimentCode);
      const currentStart = getScheduledStartTime(taskCode, experimentCode);
      return normalizeText(sample?.location) === normalizeText(labName)
        && Number.isFinite(targetStart)
        && Number.isFinite(currentStart)
        && targetStart < currentStart;
    }
    const targetLab = normalizeText(tray?.target_lab || tray?.targetLab);
    return targetLab ? targetLab === normalizeText(labName) : normalizeText(sample?.location) === normalizeText(labName);
  };

  const buildTraySummary = (taskCode, task, experimentCode = "") => {
    const ordered = collectTaskTrayCodes(taskCode, experimentCode);
    const visible = ordered.slice(0, 3);
    const remaining = ordered.length - visible.length;
    return {
      trayCodes: ordered,
      trayCount: ordered.length,
      traySummary: ordered.length === 0 ? "未分配托盘" : `${visible.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`,
    };
  };

  const buildTrayRows = (taskCode, experimentCode = "") => {
    const trayMap = new Map();
    const scopedTrayCodes = collectExperimentTrayCodes(taskCode, experimentCode);
    const scopedTrayCodeSet = scopedTrayCodes.length ? new Set(scopedTrayCodes) : null;
    const scopedSampleCodes = collectExperimentSampleCodes(taskCode, experimentCode);
    const scopedSampleCodeSet = scopedSampleCodes.length ? new Set(scopedSampleCodes) : null;
    const experimentRunTrayStatusMap = buildExperimentRunTrayStatusMap(taskCode, experimentCode);
    const currentLabName = getScheduledLabName(taskCode, experimentCode);
    const fallbackContext = { flowStatus: "", locationSummary: "", ownerSummary: "", status: "" };

    collectTaskTrayCodes(taskCode, experimentCode).forEach((trayCode) => {
      trayMap.set(trayCode, {
        flowStatuses: [], locations: [], owners: [], sampleCodes: [], status: "",
        targetExperimentCodes: [], targetLabs: [], hasCurrentExperimentReadyEvidence: false, trayCode,
      });
    });

    getTaskSamples(taskCode).forEach((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return;
      }
      asArray(sample?.trays).forEach((tray) => {
        const trayCode = normalizeText(tray?.tray_code);
        if (!trayCode || !trayMap.has(trayCode) || (scopedTrayCodeSet && !scopedTrayCodeSet.has(trayCode))) {
          return;
        }
        const row = trayMap.get(trayCode);
        const sampleCode = normalizeText(sample?.code);
        if (scopedSampleCodeSet && !scopedSampleCodeSet.has(sampleCode)) {
          return;
        }
        if (sampleCode && !row.sampleCodes.includes(sampleCode)) {
          row.sampleCodes.push(sampleCode);
        }
        const nextStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status));
        if (nextStatus === TRAY_STATUS_READY && sampleTrayShowsCurrentExperimentReady({ experimentCode, labName: currentLabName, sample, taskCode, tray })) {
          row.hasCurrentExperimentReadyEvidence = true;
        }
        const currentRank = resolveTrayFlowStatusRank(sample?.location, row.status);
        const nextRank = resolveTrayFlowStatusRank(sample?.location, nextStatus);
        if (!row.status || nextRank >= currentRank) {
          row.status = nextStatus;
        }
        row.locations.push(normalizeText(sample?.location));
        row.owners.push(normalizeText(sample?.owner));
        row.targetExperimentCodes.push(normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode));
        row.targetLabs.push(normalizeText(tray?.target_lab || tray?.targetLab));
        row.flowStatuses.push(resolveFlowStatusByLocation(sample?.location, normalizeText(tray?.status)));
      });
    });

    return Array.from(trayMap.values()).map((row) => {
      const status = normalizeText(row.status) || fallbackContext.status;
      const sampleCodes = row.sampleCodes.slice().sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
      const runTrayStatus = experimentRunTrayStatusMap.get(row.trayCode);
      const isRunning = Boolean(runTrayStatus?.isRunning);
      const isCompleted = !isRunning && (COMPLETED_TRAY_STATUSES.has(status) || Boolean(runTrayStatus?.isCompleted));
      return {
        flowStatus: row.flowStatuses.length ? summarizeUniqueTexts(row.flowStatuses) : toText(fallbackContext.flowStatus),
        isCompleted,
        isReady: !isCompleted && status === TRAY_STATUS_READY,
        isRunning,
        locationNames: normalizeLocationList(row.locations),
        locationSummary: summarizeUniqueTexts(row.locations, fallbackContext.locationSummary),
        ownerSummary: summarizeUniqueTexts(row.owners, fallbackContext.ownerSummary),
        sampleCodes,
        sampleCount: sampleCodes.length,
        sampleSummary: sampleCodes.length ? sampleCodes.join("、") : "-",
        status,
        targetExperimentCodes: normalizeLocationList(row.targetExperimentCodes),
        targetLabNames: normalizeLocationList(row.targetLabs),
        hasCurrentExperimentReadyEvidence: row.hasCurrentExperimentReadyEvidence === true,
        trayCode: row.trayCode,
      };
    }).sort((left, right) => left.trayCode.localeCompare(right.trayCode, "zh-Hans-CN"));
  };

  const buildStartExperimentState = (trayRows, options = {}) => {
    const rows = asArray(trayRows);
    const normalizedLabName = normalizeText(options.labName);
    const matchesLab = (row) => row.isRunning || !normalizedLabName || trayBelongsToLab(row, normalizedLabName) || trayHasUnknownLocation(row);
    const readyTrayCandidates = rows.filter((row) => row.isReady && !row.isCompleted);
    const blockedReadyRows = readyTrayCandidates.map((row) => ({ reason: resolveReadyBlockedReason(row, options), row })).filter((entry) => entry.reason);
    const blockedReadyTrayCodes = new Set(blockedReadyRows.map((entry) => normalizeText(entry.row?.trayCode)).filter(Boolean));
    const readyTrayRows = readyTrayCandidates.filter((row) => !blockedReadyTrayCodes.has(normalizeText(row?.trayCode)));
    const runningTrayRows = rows.filter((row) => row.isRunning && matchesLab(row));
    const remainingTrayRows = rows.filter((row) => !row.isReady && !row.isRunning && !row.isCompleted);
    return {
      canStartExperiment: readyTrayRows.length > 0 && runningTrayRows.length === 0,
      readyTrayRows,
      readyTrayCodes: readyTrayRows.map((row) => row.trayCode),
      readyTrayCount: readyTrayRows.length,
      remainingTrayRows,
      remainingTrayCount: remainingTrayRows.length,
      runningTrayRows,
      runningTrayCount: runningTrayRows.length,
      startDisabledReason: runningTrayRows.length > 0
        ? "当前批次实验未结束"
        : readyTrayRows.length === 0 && blockedReadyRows.length > 0
          ? blockedReadyRows[0].reason
          : readyTrayRows.length === 0 ? "暂无可启动托盘" : "",
    };
  };

  return {
    buildStartExperimentState,
    buildTrayRows,
    buildTraySummary,
    collectExperimentSampleCodes,
  };
}

export { createProcessTrayProjection };
