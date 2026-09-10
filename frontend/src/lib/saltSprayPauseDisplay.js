const SALT_SPRAY_PAUSE_REMARK = "实验进行中（暂停）";
const SALT_SPRAY_PAUSE_SUFFIX = "（暂停）";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const runNoOf = (row) => normalizeText(row?.run_no || row?.runNo || row?.id);
const trayCodeOf = (row) => normalizeText(row?.tray_code || row?.trayCode || row?.tray_no || row?.trayNo);
const pauseNoOf = (row) => normalizeText(row?.pause_no || row?.pauseNo);
const eventTimeOf = (row) => normalizeText(
  row?.time || row?.occurred_at || row?.occurredAt || row?.updated_at || row?.updatedAt || row?.created_at || row?.createdAt,
);

const activeSaltSprayPauseContexts = ({ experimentRunPauses, experimentRuns }) => {
  const pausedRunNos = new Set(
    asArray(experimentRuns)
      .filter((run) => normalizeText(run?.status || run?.run_status || run?.runStatus) === "实验暂停")
      .map(runNoOf)
      .filter(Boolean),
  );
  return asArray(experimentRunPauses)
    .filter((pause) => normalizeText(pause?.status || pause?.pause_status || pause?.pauseStatus) === "实验暂停")
    .filter((pause) => !normalizeText(pause?.resumed_at || pause?.resumedAt))
    .filter((pause) => !normalizeText(pause?.stopped_at || pause?.stoppedAt))
    .filter((pause) => normalizeText(pause?.lab_code || pause?.labCode) === "LAB_SALT")
    .map((pause, index) => ({
      index,
      pause,
      pauseNo: pauseNoOf(pause),
      runNo: runNoOf(pause),
      time: Date.parse(eventTimeOf(pause)) || 0,
    }))
    .filter((context) => context.runNo && context.pauseNo && pausedRunNos.has(context.runNo));
};

const activeSaltSprayPauseRunNos = ({ experimentRunPauses, experimentRuns }) => {
  return new Set(
    activeSaltSprayPauseContexts({ experimentRunPauses, experimentRuns }).map((context) => context.runNo),
  );
};

const pauseContextIncludesTray = (context, { experimentRuns, experimentRunTrays, trayCode }) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return true;
  }
  const pauseTrayCodes = asArray(context?.pause?.inspection_tray_codes || context?.pause?.inspectionTrayCodes)
    .map(normalizeText)
    .filter(Boolean);
  if (pauseTrayCodes.includes(normalizedTrayCode)) {
    return true;
  }
  if (asArray(experimentRunTrays).some((relation) => (
    runNoOf(relation) === context.runNo && trayCodeOf(relation) === normalizedTrayCode
  ))) {
    return true;
  }
  return asArray(experimentRuns).some((run) => (
    runNoOf(run) === context.runNo
    && asArray(run?.tray_codes || run?.trayCodes).some((code) => normalizeText(code) === normalizedTrayCode)
  ));
};

const resolveActiveSaltSprayPauseContext = ({
  experimentRunPauses = [],
  experimentRuns = [],
  experimentRunTrays = [],
  runNo = "",
  trayCode = "",
} = {}) => {
  const normalizedRunNo = normalizeText(runNo);
  return activeSaltSprayPauseContexts({ experimentRunPauses, experimentRuns })
    .filter((context) => !normalizedRunNo || context.runNo === normalizedRunNo)
    .filter((context) => pauseContextIncludesTray(context, { experimentRuns, experimentRunTrays, trayCode }))
    .sort((left, right) => left.time - right.time || left.index - right.index)
    .at(-1) || null;
};

const isSaltSprayReturnEvent = (event) => {
  const targetLabCode = normalizeText(event?.target_lab_code || event?.targetLabCode);
  const targetLab = normalizeText(event?.target_lab || event?.targetLab || event?.location);
  return targetLabCode === "LAB_SALT" || targetLab.includes("盐雾");
};

function resolveSaltSprayMidExperimentAppearance({
  experimentRunPauses = [],
  experimentRuns = [],
  experimentRunTrays = [],
  stagingEvents = [],
  runNo = "",
  trayCode = "",
} = {}) {
  const context = resolveActiveSaltSprayPauseContext({
    experimentRunPauses,
    experimentRuns,
    experimentRunTrays,
    runNo,
    trayCode,
  });
  const normalizedTrayCode = normalizeText(trayCode);
  if (!context || !normalizedTrayCode) {
    return { pauseNo: "", returnedAt: "", runNo: "", stockedAt: "", visible: false };
  }
  const matchedEvents = asArray(stagingEvents)
    .map((event, index) => ({ event, index, time: Date.parse(eventTimeOf(event)) || 0 }))
    .filter(({ event }) => normalizeText(event?.room) === "appearance")
    .filter(({ event }) => normalizeText(event?.appearance_phase || event?.appearancePhase) === "mid_experiment")
    .filter(({ event }) => trayCodeOf(event) === normalizedTrayCode)
    .filter(({ event }) => runNoOf(event) === context.runNo && pauseNoOf(event) === context.pauseNo)
    .sort((left, right) => left.time - right.time || left.index - right.index);
  const latest = matchedEvents.at(-1)?.event || null;
  const latestAction = normalizeText(latest?.action);
  return {
    pauseNo: context.pauseNo,
    returnedAt: latestAction === "stock_out" && isSaltSprayReturnEvent(latest) ? eventTimeOf(latest) : "",
    runNo: context.runNo,
    stockedAt: latestAction === "stock_in" ? eventTimeOf(latest) : "",
    visible: latestAction === "stock_in",
  };
}

function resolveSaltSprayResumePreparation({
  experimentRunPauses = [],
  experimentRuns = [],
  experimentRunTrays = [],
  stagingEvents = [],
  runNo = "",
  trayCode = "",
} = {}) {
  const context = resolveActiveSaltSprayPauseContext({
    experimentRunPauses,
    experimentRuns,
    experimentRunTrays,
    runNo,
    trayCode,
  });
  const normalizedTrayCode = normalizeText(trayCode);
  const empty = {
    compared: false,
    comparedAt: "",
    fixtureReady: false,
    fixtureReadyAt: "",
    installed: false,
    installedAt: "",
    pauseNo: "",
    ready: false,
    readyAt: "",
    runNo: "",
    started: false,
    startedAt: "",
  };
  if (!context || !normalizedTrayCode) {
    return empty;
  }
  const actionFields = {
    resume_preparation_started: ["started", "startedAt"],
    resume_preparation_compared: ["compared", "comparedAt"],
    resume_preparation_installed: ["installed", "installedAt"],
    resume_preparation_fixture_ready: ["fixtureReady", "fixtureReadyAt"],
    resume_preparation_ready: ["ready", "readyAt"],
  };
  const result = { ...empty, pauseNo: context.pauseNo, runNo: context.runNo };
  asArray(stagingEvents)
    .map((event, index) => ({ event, index, time: Date.parse(eventTimeOf(event)) || 0 }))
    .filter(({ event }) => normalizeText(event?.room) === "laboratory_resume_preparation")
    .filter(({ event }) => trayCodeOf(event) === normalizedTrayCode)
    .filter(({ event }) => runNoOf(event) === context.runNo && pauseNoOf(event) === context.pauseNo)
    .sort((left, right) => left.time - right.time || left.index - right.index)
    .forEach(({ event }) => {
      const fields = actionFields[normalizeText(event?.action)];
      if (!fields) {
        return;
      }
      result[fields[0]] = true;
      result[fields[1]] = eventTimeOf(event);
    });
  return result;
}

function resolveSaltSprayPauseRemark({
  experimentRunPauses = [],
  experimentRuns = [],
  experimentRunTrays = [],
  runNo = "",
  trayCode = "",
} = {}) {
  const activeRunNos = activeSaltSprayPauseRunNos({ experimentRunPauses, experimentRuns });
  const normalizedRunNo = normalizeText(runNo);
  if (normalizedRunNo) {
    return activeRunNos.has(normalizedRunNo) ? SALT_SPRAY_PAUSE_REMARK : "";
  }

  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return "";
  }
  const relationMatches = asArray(experimentRunTrays).some((relation) => (
    activeRunNos.has(runNoOf(relation)) && trayCodeOf(relation) === normalizedTrayCode
  ));
  const runMatches = asArray(experimentRuns).some((run) => (
    activeRunNos.has(runNoOf(run))
    && asArray(run?.tray_codes || run?.trayCodes).some((code) => normalizeText(code) === normalizedTrayCode)
  ));
  const pauseMatches = asArray(experimentRunPauses).some((pause) => (
    activeRunNos.has(runNoOf(pause))
    && asArray(pause?.inspection_tray_codes || pause?.inspectionTrayCodes)
      .some((code) => normalizeText(code) === normalizedTrayCode)
  ));
  return relationMatches || runMatches || pauseMatches ? SALT_SPRAY_PAUSE_REMARK : "";
}

function resolveSaltSprayPauseFlowLabel(label, displayRemark) {
  const normalizedLabel = normalizeText(label);
  if (
    displayRemark !== SALT_SPRAY_PAUSE_REMARK
    || !/盐雾(?:试验|实验)进行中$/.test(normalizedLabel)
  ) {
    return normalizedLabel;
  }
  return `${normalizedLabel}${SALT_SPRAY_PAUSE_SUFFIX}`;
}

export {
  SALT_SPRAY_PAUSE_REMARK,
  resolveActiveSaltSprayPauseContext,
  resolveSaltSprayMidExperimentAppearance,
  resolveSaltSprayPauseFlowLabel,
  resolveSaltSprayPauseRemark,
  resolveSaltSprayResumePreparation,
};
