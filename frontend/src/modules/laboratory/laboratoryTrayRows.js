import { normalizeAxisCodes } from "@/lib/axisCodes";
import { LAB_RESET_STATUS } from "./laboratoryConstants";
import {
  resolveLatestAnyExperimentHistorySnapshot,
  resolveLatestExperimentHistorySnapshot,
  resolveLatestLaboratoryDispatchSnapshot,
  resolvePreviousCompletedExperimentSnapshot,
} from "./laboratoryHistory";
import { uniqueValues } from "./laboratoryPresentation";
import {
  buildCompletedExperimentCodesByTrayCode,
  buildCompletedExperimentRecordCodesByTrayCode,
  buildCompletedScheduleTrayCodeSet,
  buildExperimentCodesByTrayCode,
} from "./laboratoryRunIndex";
import {
  resolveSubExperimentCode,
} from "./scheduleCompletion";
import {
  experimentHistoryStatusIsWithdrawal,
  resolveLaboratoryStatusRank,
} from "./laboratoryTrayEligibility";
import {
  experimentIsCompletedInSampleHistory,
  isFixtureReady,
  resolveCurrentExperimentTrayStatus,
  resolveUnifiedTrayLifecycleCandidate,
  shouldReplaceUnifiedTrayLifecycle,
} from "./laboratoryTrayState";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const collectTrayRows = ({
  device,
  experimentName,
  experimentRecordMap,
  experimentRuns,
  experimentRunTrays,
  experimentTrayCodeMap,
  experimentKey,
  relatedSamples,
  schedule,
  taskCode,
}) => {
  const trayRows = [];
  const indexByTrayCode = new Map();
  const experimentCodesByTrayCode = buildExperimentCodesByTrayCode(experimentTrayCodeMap);
  const currentExperimentCode = normalizeText(String(experimentKey).split("::")[1]);
  const currentScheduleIsAxisSubExperiment = Boolean(
    resolveSubExperimentCode(schedule)
    && normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
  );
  const completedCurrentScheduleTrayCodes = currentScheduleIsAxisSubExperiment
    ? buildCompletedScheduleTrayCodeSet({ experimentRuns, experimentRunTrays, schedule })
    : new Set();
  const completedExperimentCodesByTrayCode = buildCompletedExperimentCodesByTrayCode({ experimentRunTrays, taskCode });
  const completedExperimentRecordCodesByTrayCode = buildCompletedExperimentRecordCodesByTrayCode({
    currentExperimentCode,
    experimentRecordMap,
    experimentTrayCodeMap,
    taskCode,
  });

  const pushRow = (
    trayCode,
    sampleCode = "",
    quantity = "",
    owner = "",
    location = "",
    fixtureReady = false,
    targetLab = "",
    targetExperimentCode = "",
    hasCurrentExperimentHistory = false,
  ) => {
    const normalizedTrayCode = normalizeText(trayCode);
    if (!normalizedTrayCode) {
      return;
    }
    const normalizedTargetLab = normalizeText(targetLab);
    const normalizedTargetExperimentCode = normalizeText(targetExperimentCode);
    const existingIndex = indexByTrayCode.get(normalizedTrayCode);
    if (existingIndex !== undefined) {
      const current = trayRows[existingIndex];
      if (sampleCode && !current.sampleCodes.includes(sampleCode)) {
        current.sampleCodes.push(sampleCode);
      }
      if (!current.owner && owner) {
        current.owner = owner;
      }
      if (!current.quantity && quantity) {
        current.quantity = quantity;
      }
      if (!current.currentLocation && location) {
        current.currentLocation = location;
      }
      if (!current.targetLab && normalizedTargetLab) {
        current.targetLab = normalizedTargetLab;
      }
      if (!current.targetExperimentCode && normalizedTargetExperimentCode) {
        current.targetExperimentCode = normalizedTargetExperimentCode;
      }
      current.hasCurrentExperimentHistory = current.hasCurrentExperimentHistory || Boolean(hasCurrentExperimentHistory);
      current.fixtureReady = current.fixtureReady || isFixtureReady(fixtureReady);
      return;
    }
    indexByTrayCode.set(normalizedTrayCode, trayRows.length);
    const completedExperimentCodes = new Set([
      ...Array.from(completedExperimentCodesByTrayCode.get(normalizedTrayCode) || []),
      ...Array.from(completedExperimentRecordCodesByTrayCode.get(normalizedTrayCode) || []),
    ]);
    if (currentScheduleIsAxisSubExperiment && !completedCurrentScheduleTrayCodes.has(normalizedTrayCode)) {
      completedExperimentCodes.delete(currentExperimentCode);
    }
    trayRows.push({
      currentLocation: normalizeText(location),
      completedExperimentCodes: Array.from(completedExperimentCodes),
      completedForCurrentExperiment: false,
      completedForOtherExperiment: false,
      displayStatus: "",
      experimentCodes: experimentCodesByTrayCode.get(normalizedTrayCode) || [],
      lifecycleLocation: normalizeText(location),
      lifecycleStatus: "",
      lifecycleTime: 0,
      hasCurrentExperimentHistory: false,
      currentExperimentHistoryStatus: "",
      latestExperimentHistoryStatus: "",
      owner: normalizeText(owner),
      quantity: quantity || "",
      sampleCodes: sampleCode ? [sampleCode] : [],
      targetExperimentCode: normalizedTargetExperimentCode,
      targetLab: normalizedTargetLab,
      fixtureReady: isFixtureReady(fixtureReady),
      trayStatus: "",
      trayCode: normalizedTrayCode,
    });
  };

  const scopedTrayCodes = experimentTrayCodeMap.get(experimentKey) || [];
  scopedTrayCodes.forEach((trayCode) => pushRow(trayCode));

  asArray(relatedSamples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const owner = normalizeText(sample?.owner);
    const location = normalizeText(sample?.location);
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      const quantity = tray?.quantity ?? "";
      if (scopedTrayCodes.length > 0 && !scopedTrayCodes.includes(trayCode)) {
        return;
      }
      const targetLab = normalizeText(tray?.target_lab || tray?.targetLab);
      const targetExperimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
      const physicalTrayStatus = normalizeText(tray?.status);
      const latestDispatch = physicalTrayStatus === LAB_RESET_STATUS
        ? resolveLatestLaboratoryDispatchSnapshot({
            currentExperimentCode,
            currentLab: device,
            sample,
            trayCode,
          })
        : null;
      const restoredDispatch = physicalTrayStatus === LAB_RESET_STATUS && (!targetLab || !targetExperimentCode)
        ? latestDispatch
        : null;
      const currentExperimentHistorySnapshot = resolveLatestExperimentHistorySnapshot({
        experimentName,
        sample,
        taskCode,
        trayCode,
      });
      const latestExperimentHistorySnapshot = resolveLatestAnyExperimentHistorySnapshot({
        sample,
        taskCode,
        trayCode,
      });
      const currentExperimentHistoryIsStale =
        currentExperimentHistorySnapshot
        && latestExperimentHistorySnapshot
        && normalizeText(latestExperimentHistorySnapshot.experimentName) !== normalizeText(experimentName)
        && (latestExperimentHistorySnapshot.time || -Infinity) > (currentExperimentHistorySnapshot.time || -Infinity)
        && (
          resolveLaboratoryStatusRank(latestExperimentHistorySnapshot.status) > 0
          || experimentHistoryStatusIsWithdrawal(latestExperimentHistorySnapshot.status)
        );
      const dispatchRestoresWithdrawnCurrentExperiment =
        experimentHistoryStatusIsWithdrawal(currentExperimentHistorySnapshot?.status)
        && latestDispatch
        && latestDispatch.time > (currentExperimentHistorySnapshot?.time || -Infinity)
        && normalizeText(latestDispatch.targetLab) === normalizeText(device)
        && (
          !normalizeText(currentExperimentCode)
          || normalizeText(latestDispatch.targetExperimentCode) === normalizeText(currentExperimentCode)
        );
      const rawCurrentExperimentHistoryStatus = normalizeText(currentExperimentHistorySnapshot?.status);
      const rawCurrentExperimentHistoryRank = resolveLaboratoryStatusRank(rawCurrentExperimentHistoryStatus);
      const currentScheduleSuppressesCurrentHistory =
        currentScheduleIsAxisSubExperiment
        && (rawCurrentExperimentHistoryRank <= 0 || rawCurrentExperimentHistoryRank >= 5);
      const currentExperimentHistoryStatus = dispatchRestoresWithdrawnCurrentExperiment
        || currentExperimentHistoryIsStale
        || currentScheduleSuppressesCurrentHistory
        ? ""
        : rawCurrentExperimentHistoryStatus;
      const latestExperimentHistoryStatus = normalizeText(latestExperimentHistorySnapshot?.status);
      const restoredTargetLab = targetLab || normalizeText(restoredDispatch?.targetLab);
      const restoredTargetExperimentCode =
        targetExperimentCode
        || (restoredTargetLab === normalizeText(restoredDispatch?.targetLab)
          ? normalizeText(restoredDispatch?.targetExperimentCode)
          : "");
      const sampleHasCurrentExperimentHistory = Boolean(currentExperimentHistoryStatus);
      const currentExperimentHistoryRank = resolveLaboratoryStatusRank(currentExperimentHistoryStatus);
      const currentExperimentProgressIsAuthoritative = sampleHasCurrentExperimentHistory && currentExperimentHistoryRank > 0;
      const effectiveTargetLab = currentExperimentProgressIsAuthoritative ? device : restoredTargetLab;
      const effectiveTargetExperimentCode = currentExperimentProgressIsAuthoritative ? currentExperimentCode : restoredTargetExperimentCode;
      pushRow(
        trayCode,
        sampleCode,
        quantity,
        owner,
        location,
        tray?.fixtureReady ?? tray?.fixture_ready,
        effectiveTargetLab,
        effectiveTargetExperimentCode,
        sampleHasCurrentExperimentHistory,
      );
      const row = trayRows[indexByTrayCode.get(trayCode)];
      const completedExperimentCodes = completedExperimentCodesByTrayCode.get(trayCode) || new Set();
      const completedExperimentRecordCodes = completedExperimentRecordCodesByTrayCode.get(trayCode) || new Set();
      row.completedExperimentCodes = uniqueValues([
        ...asArray(row.completedExperimentCodes),
        ...Array.from(completedExperimentCodes),
        ...Array.from(completedExperimentRecordCodes),
      ]);
      row.completedForCurrentExperiment =
        row.completedForCurrentExperiment
        || (
          currentScheduleIsAxisSubExperiment
            ? completedCurrentScheduleTrayCodes.has(trayCode)
            : (
                completedExperimentCodes.has(currentExperimentCode)
                || completedExperimentRecordCodes.has(currentExperimentCode)
                || experimentIsCompletedInSampleHistory({ experimentName, sample, taskCode, trayCode })
              )
        );
      row.completedForOtherExperiment =
        row.completedForOtherExperiment
        || asArray(row?.experimentCodes).some((experimentCode) =>
          experimentCode !== currentExperimentCode
          && (completedExperimentCodes.has(experimentCode) || completedExperimentRecordCodes.has(experimentCode)),
        )
        || Boolean(resolvePreviousCompletedExperimentSnapshot(sample, taskCode, experimentName));
      row.hasCurrentExperimentHistory =
        row.hasCurrentExperimentHistory
        || sampleHasCurrentExperimentHistory;
      if (currentExperimentHistoryStatus) {
        row.currentExperimentHistoryStatus = currentExperimentHistoryStatus;
      }
      if (latestExperimentHistoryStatus) {
        row.latestExperimentHistoryStatus = latestExperimentHistoryStatus;
      }
      const currentRank = resolveLaboratoryStatusRank(row?.trayStatus);
      const nextStatus = physicalTrayStatus
        ? resolveCurrentExperimentTrayStatus({
            completedForCurrentExperiment: row.completedForCurrentExperiment,
            completedForOtherExperiment: row.completedForOtherExperiment,
            currentExperimentCode,
            device,
            experimentCodes: row?.experimentCodes,
            experimentName,
            historyStatus: currentExperimentHistoryStatus,
            physicalStatus: physicalTrayStatus,
            sample,
            targetExperimentCode: effectiveTargetExperimentCode,
            targetLab: effectiveTargetLab,
            taskCode,
            trayCode: row.trayCode,
          })
        : "";
      const displayStatusCandidate = resolveCurrentExperimentTrayStatus({
        completedForCurrentExperiment: row.completedForCurrentExperiment,
        completedForOtherExperiment: row.completedForOtherExperiment,
        currentExperimentCode,
        device,
        experimentCodes: row?.experimentCodes,
        experimentName,
        historyStatus: currentExperimentHistoryStatus,
        physicalStatus: physicalTrayStatus,
        sample,
        targetExperimentCode: effectiveTargetExperimentCode,
        targetLab: effectiveTargetLab,
        taskCode,
        trayCode: row.trayCode,
      });
      if (currentExperimentProgressIsAuthoritative) {
        row.targetLab = effectiveTargetLab;
        row.targetExperimentCode = effectiveTargetExperimentCode;
      }
      const nextStatusRestoresCurrentDispatch =
        dispatchRestoresWithdrawnCurrentExperiment && nextStatus === LAB_RESET_STATUS;
      if (nextStatusRestoresCurrentDispatch || resolveLaboratoryStatusRank(nextStatus) >= currentRank) {
        row.trayStatus = nextStatus;
      }
      if (physicalTrayStatus === LAB_RESET_STATUS && effectiveTargetLab) {
        row.currentLocation = effectiveTargetLab;
        row.lifecycleLocation = effectiveTargetLab;
      }
      const currentDisplayRank = resolveLaboratoryStatusRank(row?.displayStatus);
      if (
        nextStatusRestoresCurrentDispatch
        || resolveLaboratoryStatusRank(displayStatusCandidate) >= currentDisplayRank
      ) {
        row.displayStatus = displayStatusCandidate;
      }
      const lifecycleLocation = physicalTrayStatus === LAB_RESET_STATUS && effectiveTargetLab ? effectiveTargetLab : location;
      const lifecycleCandidate = resolveUnifiedTrayLifecycleCandidate({
        location: lifecycleLocation,
        sample,
        tray,
        trayCode: row.trayCode,
      });
      if (shouldReplaceUnifiedTrayLifecycle(row, lifecycleCandidate)) {
        row.lifecycleLocation = lifecycleCandidate.location || row.currentLocation;
        row.lifecycleStatus = lifecycleCandidate.status;
        row.lifecycleTime = lifecycleCandidate.time || 0;
      }
    });
  });

  return trayRows;
};

export { collectTrayRows };
