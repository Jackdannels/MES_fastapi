import { labIdentityMatches, scheduleMatchesLab } from "@/lib/labIdentity";
import { isRunningExperimentStatus, normalizeText } from "./deviceMaintenanceRules";

function createDeviceRunningRepair({ state }) {
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
          .filter((run) => labIdentityMatches(run, deviceRef) && isRunningExperimentStatus(run?.status))
          .map((run) => {
            const matchedSchedule = state.rawSchedules.value.find((schedule) =>
              scheduleMatchesLab(schedule, deviceRef)
              && normalizeText(schedule?.task_code) === normalizeText(run?.task_code)
              && normalizeText(schedule?.experiment_code) === normalizeText(run?.experiment_code));
            return {
              ...(matchedSchedule || {}),
              device: normalizeText(run?.device) || normalizeText(matchedSchedule?.device),
              experiment_code: normalizeText(run?.experiment_code) || normalizeText(matchedSchedule?.experiment_code),
              id: normalizeText(matchedSchedule?.id) || normalizeText(run?.schedule_id),
              run_no: normalizeText(run?.run_no) || normalizeText(run?.id),
              task_code: normalizeText(run?.task_code) || normalizeText(matchedSchedule?.task_code),
              tray_codes: Array.isArray(run?.tray_codes) ? run.tray_codes : [],
            };
          })
      : state.rawSchedules.value.filter((schedule) => scheduleMatchesLab(schedule, deviceRef) && scheduleHasRunningTray(schedule, deviceRef));
  };

  return { findRunningSchedulesForDevice, resolveDeviceRef };
}

export { createDeviceRunningRepair };
