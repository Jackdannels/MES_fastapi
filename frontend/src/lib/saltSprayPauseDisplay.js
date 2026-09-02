const SALT_SPRAY_PAUSE_REMARK = "实验进行中（暂停）";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const runNoOf = (row) => normalizeText(row?.run_no || row?.runNo || row?.id);
const trayCodeOf = (row) => normalizeText(row?.tray_code || row?.trayCode || row?.tray_no || row?.trayNo);

const activeSaltSprayPauseRunNos = ({ experimentRunPauses, experimentRuns }) => {
  const pausedRunNos = new Set(
    asArray(experimentRuns)
      .filter((run) => normalizeText(run?.status || run?.run_status || run?.runStatus) === "实验暂停")
      .map(runNoOf)
      .filter(Boolean),
  );
  return new Set(
    asArray(experimentRunPauses)
      .filter((pause) => normalizeText(pause?.status || pause?.pause_status || pause?.pauseStatus) === "实验暂停")
      .filter((pause) => !normalizeText(pause?.resumed_at || pause?.resumedAt))
      .filter((pause) => !normalizeText(pause?.stopped_at || pause?.stoppedAt))
      .filter((pause) => normalizeText(pause?.lab_code || pause?.labCode) === "LAB_SALT")
      .map(runNoOf)
      .filter((runNo) => pausedRunNos.has(runNo)),
  );
};

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

export { SALT_SPRAY_PAUSE_REMARK, resolveSaltSprayPauseRemark };
