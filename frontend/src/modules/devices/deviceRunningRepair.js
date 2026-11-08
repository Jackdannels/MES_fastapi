import { labIdentityMatches, scheduleMatchesLab } from "@/lib/labIdentity";
import { isRunningExperimentStatus, normalizeText } from "./deviceMaintenanceRules";

function createDeviceRunningRepair({ state }) {
  const isActiveRepairRun = (status) => isRunningExperimentStatus(status) || normalizeText(status) === "实验暂停";
  const sampleTrays = (sample) => Array.isArray(sample?.trays) ? sample.trays : [];
  const resolveScheduleTrayCodes = (schedule) => {
    const scheduleTrayCodes = (Array.isArray(schedule?.tray_codes) ? schedule.tray_codes : []).map(normalizeText).filter(Boolean);
    if (scheduleTrayCodes.length > 0) {
      return scheduleTrayCodes;
    }
    const taskCode = normalizeText(schedule?.task_code);
    const experimentCode = normalizeText(schedule?.experiment_code);
    const scopedCodes = state.rawExperimentTrays.value
      .filter((entry) => normalizeText(entry?.task_code) === taskCode && normalizeText(entry?.experiment_code) === experimentCode)
      .map((entry) => normalizeText(entry?.tray_code))
      .filter(Boolean);
    if (scopedCodes.length > 0) {
      return scopedCodes;
    }
    return state.rawSamples.value
      .filter((sample) => normalizeText(sample?.task_code) === taskCode)
      .flatMap((sample) => (Array.isArray(sample?.trays) ? sample.trays : []))
      .map((tray) => normalizeText(tray?.tray_code))
      .filter(Boolean);
  };

  const resolveDeviceRef = (deviceCode) => state.rawDevices.value.find((device) =>
    normalizeText(device?.code) === normalizeText(deviceCode))
    || { code: normalizeText(deviceCode), name: normalizeText(deviceCode) };

  const scheduleHasRunningTray = (schedule, deviceRef) => {
    const taskCode = normalizeText(schedule?.task_code);
    const trayCodes = new Set(resolveScheduleTrayCodes(schedule));
    return state.rawSamples.value.some((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode || !labIdentityMatches(sample, deviceRef)) {
        return false;
      }
      return (Array.isArray(sample?.trays) ? sample.trays : []).some((tray) => {
        const trayCode = normalizeText(tray?.tray_code);
        if (trayCodes.size > 0 && !trayCodes.has(trayCode)) {
          return false;
        }
        return isRunningExperimentStatus(tray?.status) || isRunningExperimentStatus(sample?.status);
      });
    });
  };

  const findRunningSchedulesForDevice = (deviceCode) => {
    const deviceRef = resolveDeviceRef(deviceCode);
    return state.rawExperimentRuns.value.length > 0
      ? state.rawExperimentRuns.value
          .filter((run) => labIdentityMatches(run, deviceRef) && isActiveRepairRun(run?.status))
          .map((run) => {
            const runNo = normalizeText(run?.run_no || run?.id);
            const scheduleId = normalizeText(run?.schedule_id || run?.schedule_no);
            const matchedSchedule = state.rawSchedules.value.find((schedule) =>
              scheduleId && normalizeText(schedule?.id) === scheduleId && scheduleMatchesLab(schedule, deviceRef))
              || state.rawSchedules.value.find((schedule) =>
                scheduleMatchesLab(schedule, deviceRef)
                && normalizeText(schedule?.task_code) === normalizeText(run?.task_code)
                && normalizeText(schedule?.experiment_code) === normalizeText(run?.experiment_code));
            const relations = state.rawExperimentRunTrays.value.filter((row) =>
              normalizeText(row?.run_no || row?.runNo) === runNo
              && normalizeText(row?.task_code) === normalizeText(run?.task_code)
              && normalizeText(row?.experiment_code) === normalizeText(run?.experiment_code));
            const trayCodes = [...new Set((relations.length > 0
              ? relations.map((row) => row.tray_code || row.trayCode)
              : Array.isArray(run?.tray_codes) ? run.tray_codes : [])
              .map(normalizeText).filter(Boolean))];
            const samples = state.rawSamples.value.filter((sample) =>
              normalizeText(sample?.task_code) === normalizeText(run?.task_code)
              && sampleTrays(sample).some((tray) => trayCodes.includes(normalizeText(tray?.tray_code))));
            return {
              ...(matchedSchedule || {}),
              device: normalizeText(run?.device) || normalizeText(matchedSchedule?.device),
              experiment_code: normalizeText(run?.experiment_code) || normalizeText(matchedSchedule?.experiment_code),
              id: normalizeText(matchedSchedule?.id) || normalizeText(run?.schedule_id),
              run_no: runNo,
              run_status: normalizeText(run?.status),
              task_code: normalizeText(run?.task_code) || normalizeText(matchedSchedule?.task_code),
              tray_codes: trayCodes,
              sample_codes: [...new Set(samples.map((sample) => normalizeText(sample.code)).filter(Boolean))],
              tray_locations: trayCodes.map((trayCode) => {
                const traySamples = samples.filter((sample) => sampleTrays(sample).some((tray) => normalizeText(tray?.tray_code) === trayCode));
                const locations = [...new Set(traySamples.map((sample) => normalizeText(sample.location)).filter(Boolean))];
                return { tray_code: trayCode, location: locations.join(" / ") || "待确认",
                  sample_codes: traySamples.map((sample) => normalizeText(sample.code)).filter(Boolean) };
              }),
            };
          })
      : state.rawSchedules.value.filter((schedule) => scheduleMatchesLab(schedule, deviceRef) && scheduleHasRunningTray(schedule, deviceRef));
  };

  return { findRunningSchedulesForDevice, resolveDeviceRef };
}

export { createDeviceRunningRepair };
