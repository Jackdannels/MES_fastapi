import { labIdentityMatches, scheduleMatchesLab } from "@/lib/labIdentity";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { revertLaboratoryTaskToPreviousStableState } from "@/modules/laboratory/model";
import { resolveTaskStatus, STATUS_COMPLETED, STATUS_WAITING } from "@/modules/schedule/model";
import { normalizeMaintenancePlan } from "./model";
import {
  isRunningExperimentStatus,
  maintenanceTypeToStatus,
  normalizeText,
} from "./deviceMaintenanceRules";

function createDeviceRunningRepair({ maintenancePlanDevice, rawDevicesIncludingMaintenanceTarget, state }) {
  const findExperimentBySchedule = (schedule) => state.rawExperiments.value.find((experiment) =>
    normalizeText(experiment?.task_code) === normalizeText(schedule?.task_code)
    && normalizeText(experiment?.experiment_code) === normalizeText(schedule?.experiment_code));

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

  const buildLaboratoryTaskFromSchedule = (schedule) => {
    const experiment = findExperimentBySchedule(schedule);
    return {
      experimentName: normalizeText(schedule?.experiment_name)
        || normalizeText(experiment?.experiment_name)
        || normalizeText(schedule?.experiment_code)
        || "-",
      taskCode: normalizeText(schedule?.task_code),
      trayCodes: resolveScheduleTrayCodes(schedule),
    };
  };

  const completeRunningScheduleSamples = ({ samples, schedule, timestamp }) => {
    const taskCode = normalizeText(schedule?.task_code);
    const trayCodes = new Set(resolveScheduleTrayCodes(schedule));
    const experimentName = normalizeText(schedule?.experiment_name) || normalizeText(schedule?.experiment_code) || "-";
    return samples.map((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return sample;
      }
      let changed = false;
      const nextTrays = (Array.isArray(sample?.trays) ? sample.trays : []).map((tray) => {
        const trayCode = normalizeText(tray?.tray_code);
        if (trayCodes.size > 0 && !trayCodes.has(trayCode)) {
          return { ...tray };
        }
        changed = true;
        return { ...tray, status: STATUS_COMPLETED, updated_at: timestamp };
      });
      if (!changed) {
        return { ...sample, trays: nextTrays };
      }
      const nextSample = { ...sample, flow_status: STATUS_COMPLETED, status: STATUS_COMPLETED, trays: nextTrays, updated_at: timestamp };
      nextSample.history = [{
        action: "实验完成",
        detail: `${taskCode} / ${experimentName} / ${STATUS_COMPLETED}`,
        id: `device-repair-complete-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        location: normalizeText(nextSample.location),
        status: STATUS_COMPLETED,
        time: timestamp,
      }, ...(Array.isArray(sample?.history) ? sample.history : [])];
      return nextSample;
    });
  };

  const buildRunningRepairUpdates = ({ form, mode, runningSchedules = [], timestamp }) => {
    const runningScheduleIds = new Set(runningSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
    const runningExperimentKeys = new Set(runningSchedules.map((schedule) =>
      `${normalizeText(schedule?.task_code)}::${normalizeText(schedule?.experiment_code)}`));
    const runningRunNos = new Set(runningSchedules.map((schedule) => normalizeText(schedule?.run_no)).filter(Boolean));
    const deviceCode = normalizeText(maintenancePlanDevice.value?.code);
    const plan = normalizeMaintenancePlan(form);
    const nextDevices = rawDevicesIncludingMaintenanceTarget(deviceCode).map((device) =>
      normalizeText(device?.code) === deviceCode
        ? { ...device, ...plan, status: maintenanceTypeToStatus(plan.maintenance_type), updated_at: timestamp }
        : { ...device });
    const nextSchedules = state.rawSchedules.value.filter((schedule) => !runningScheduleIds.has(normalizeText(schedule?.id)));
    let nextSamples = state.rawSamples.value.map((sample) => ({ ...sample }));
    runningSchedules.forEach((schedule) => {
      const currentTask = buildLaboratoryTaskFromSchedule(schedule);
      nextSamples = mode === "complete"
        ? completeRunningScheduleSamples({ samples: nextSamples, schedule, timestamp })
        : revertLaboratoryTaskToPreviousStableState({ allowRunningRevert: true, currentTask, now: timestamp, samples: nextSamples });
    });
    const nextExperiments = state.rawExperiments.value.map((experiment) => {
      const key = `${normalizeText(experiment?.task_code)}::${normalizeText(experiment?.experiment_code)}`;
      if (!runningExperimentKeys.has(key)) {
        return { ...experiment };
      }
      return mode === "complete"
        ? { ...experiment, actual_end_time: timestamp, status: STATUS_COMPLETED, updated_at: timestamp }
        : { ...experiment, status: STATUS_WAITING, unscheduled_since: timestamp, updated_at: timestamp };
    });
    const nextTasks = state.rawTasks.value.map((task) => ({
      ...task,
      status: resolveTaskStatus(task, nextSchedules, nextSamples, new Date(timestamp), state.rawExperimentTrays.value),
    }));
    const nextExperimentRuns = mode === "complete"
      ? state.rawExperimentRuns.value.map((run) => {
          const runNo = normalizeText(run?.run_no) || normalizeText(run?.id);
          const key = `${normalizeText(run?.task_code)}::${normalizeText(run?.experiment_code)}`;
          return !runningRunNos.has(runNo) && !runningExperimentKeys.has(key)
            ? { ...run }
            : { ...run, ended_at: timestamp, status: STATUS_COMPLETED, updated_at: timestamp };
        })
      : state.rawExperimentRuns.value.filter((run) => {
          const runNo = normalizeText(run?.run_no) || normalizeText(run?.id);
          const key = `${normalizeText(run?.task_code)}::${normalizeText(run?.experiment_code)}`;
          return !runningRunNos.has(runNo) && !runningExperimentKeys.has(key);
        });
    const nextExperimentRunTrays = mode === "complete"
      ? state.rawExperimentRunTrays.value.map((relation) => {
          const runNo = normalizeText(relation?.run_no) || normalizeText(relation?.runNo);
          const key = `${normalizeText(relation?.task_code)}::${normalizeText(relation?.experiment_code)}`;
          return !runningRunNos.has(runNo) && !runningExperimentKeys.has(key)
            ? { ...relation }
            : { ...relation, ended_at: timestamp, run_tray_status: STATUS_COMPLETED, status: STATUS_COMPLETED, updated_at: timestamp };
        })
      : state.rawExperimentRunTrays.value.filter((relation) => {
          const runNo = normalizeText(relation?.run_no) || normalizeText(relation?.runNo);
          const key = `${normalizeText(relation?.task_code)}::${normalizeText(relation?.experiment_code)}`;
          return !runningRunNos.has(runNo) && !runningExperimentKeys.has(key);
        });
    return {
      [STORAGE_KEYS.devices]: nextDevices,
      [STORAGE_KEYS.experiments]: nextExperiments,
      [STORAGE_KEYS.experiment_runs]: nextExperimentRuns,
      [STORAGE_KEYS.experiment_run_trays]: nextExperimentRunTrays,
      [STORAGE_KEYS.samples]: nextSamples,
      [STORAGE_KEYS.schedules]: nextSchedules,
      [STORAGE_KEYS.tasks]: nextTasks,
    };
  };

  return { buildRunningRepairUpdates, findRunningSchedulesForDevice, resolveDeviceRef };
}

export { createDeviceRunningRepair };
