import { formatLocalDateTime } from "@/lib/dateTime";
import { serverNowDate } from "@/lib/serverClock";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import {
  RUNNING_SCHEDULE_DELETE_MESSAGE,
  RUNNING_SCHEDULE_RESCHEDULE_MESSAGE,
  scheduleExperimentHasStarted,
} from "@/lib/runningExperimentGuards";
import {
  createId,
  formatDateTime,
  isRetentionDevice,
  normalizeText,
  overlaps,
  parseDate,
} from "./sharedModel";
import { resolveScheduleTimes } from "./formModel";
import {
  STATUS_RETENTION,
  STATUS_SCHEDULED,
  STREAMING_STATUS,
  deriveAxisSubExperimentCode,
  findDeviceRecord,
  resolveAxisScheduleLockContext,
  resolveDeviceScheduleBlockMessage,
  resolveNextAxisBatchNo,
  resolveScheduledAxisSelection,
  resolveSubExperimentCode,
} from "./scheduleFoundationModel";
import {
  buildExperimentNameMap,
  buildExperimentTrayMap,
  buildTrayExperimentCodeMap,
  scheduleIsCompleted,
} from "./scheduleLifecycleModel";
import {
  syncExperimentUnscheduledSince,
  syncTaskStatuses,
} from "./scheduleViewModel";


function ensureStreamForSchedule(streams, schedule, now = serverNowDate()) {
  const nextStreams = Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [];
  const taskCode = normalizeText(schedule?.task_code);
  const existing = nextStreams.find((stream) => normalizeText(stream?.task_code) === taskCode);
  if (existing) {
    // 已有数据流时仅同步最新设备归属，不重复创建。
    existing.device = normalizeText(schedule?.device);
    return nextStreams;
  }
  // 首次排程会为任务补建一条默认数据流记录。
  nextStreams.push({
    device: normalizeText(schedule?.device),
    id: createId("stream"),
    last_packet: formatDateTime(now),
    quality: "98.0%",
    reported: false,
    status: STREAMING_STATUS,
    task_code: taskCode,
  });
  return nextStreams;
}

function findScheduleConflicts({ schedules, candidate, ignoreId = "", experiments = [], experimentTrays = [], samples = [] }) {
  const device = normalizeText(candidate?.device);
  if (!device || isRetentionDevice(device)) {
    return [];
  }
  const startAt = parseDate(candidate?.start_at);
  const endAt = parseDate(candidate?.end_at);
  if (!startAt || !endAt) {
    return [];
  }

  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);

  // 冲突检查排除自身编辑场景，只比较同设备且时间重叠的正式排程。
  return (Array.isArray(schedules) ? schedules : []).filter((schedule) => {
    if (normalizeText(schedule?.id) === normalizeText(ignoreId)) {
      return false;
    }
    if (!scheduleMatchesLab(schedule, candidate)) {
      return false;
    }
    if (scheduleIsCompleted({ experimentNameByCode, experimentTrayMap, samples, schedule, trayExperimentCodeMap })) {
      return false;
    }
    const existingStart = parseDate(schedule?.start_at);
    const existingEnd = parseDate(schedule?.end_at);
    return existingStart && existingEnd && overlaps(startAt, endAt, existingStart, existingEnd);
  });
}

function createScheduleRecord({
  devices = [],
  experiments,
  experimentRunSteps = [],
  form,
  tasks,
  schedules,
  streams,
  now = serverNowDate(),
  samples = [],
  experimentTrays = [],
}) {
  const taskCode = normalizeText(form?.task_code);
  const device = normalizeText(form?.device);
  if (!taskCode || !device) {
    return { error: "请选择任务和实验室" };
  }

  const resolved = resolveScheduleTimes(form, now, schedules);
  if (resolved.error) {
    return resolved;
  }

  const deviceRecord = findDeviceRecord(devices, device);
  const initialDeviceBlockMessage = isRetentionDevice(device)
    ? ""
    : resolveDeviceScheduleBlockMessage({
        device: deviceRecord,
        endAt: resolved.endAt,
        now,
        startAt: resolved.startAt,
      });
  if (initialDeviceBlockMessage) {
    return { error: initialDeviceBlockMessage };
  }

  const axisSelection = resolveScheduledAxisSelection({
    experimentCode: form?.experiment_code,
    experiments,
    experimentRunSteps,
    form,
    schedules,
  });
  if (axisSelection.error) {
    return { error: axisSelection.error };
  }
  const selectedAxisCodes = axisSelection.axisCodes;
  const axisScheduleLock = resolveAxisScheduleLockContext({
    experimentCode: form?.experiment_code,
    experiments,
    form,
    schedules,
  });
  if (axisScheduleLock.device && device !== axisScheduleLock.device) {
    return { error: `后续${axisScheduleLock.label}轴向需沿用${axisScheduleLock.device}` };
  }
  const explicitAxisBatchNo = normalizeText(form?.axis_batch_no ?? form?.axisBatchNo);
  const axisBatchNo = explicitAxisBatchNo || (selectedAxisCodes.length > 0
    ? resolveNextAxisBatchNo({
      experimentCode: form?.experiment_code,
      schedules,
      taskCode,
    })
    : "");
  const subExperimentCode = resolveSubExperimentCode(form) || deriveAxisSubExperimentCode(form?.experiment_code, axisBatchNo);
  const candidate = {
    device,
    end_at: formatLocalDateTime(resolved.endAt),
    experiment_code: normalizeText(form?.experiment_code),
    lab_code: normalizeText(form?.lab_code ?? form?.labCode),
    lab_id: form?.lab_id ?? form?.labId ?? "",
    planned_hours: resolved.plannedHours,
    start_at: formatLocalDateTime(resolved.startAt),
    sub_experiment_code: subExperimentCode,
    task_code: taskCode,
  };
  if (selectedAxisCodes.length > 0) {
    candidate.axis_codes = selectedAxisCodes;
  }
  if (axisBatchNo) {
    candidate.axis_batch_no = axisBatchNo;
  }

  const deviceBlockMessage = isRetentionDevice(device)
    ? ""
    : resolveDeviceScheduleBlockMessage({
        device: deviceRecord,
        endAt: resolved.endAt,
        now,
        startAt: resolved.startAt,
      });
  if (deviceBlockMessage) {
    return { error: deviceBlockMessage };
  }

  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
  const conflicts = findScheduleConflicts({ candidate, experiments, experimentTrays, samples, schedules: nextSchedules });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 任务此前若只在暂存间，转入正式实验室时直接复用原暂存记录。
  const retentionSchedule = nextSchedules.find(
    (schedule) => normalizeText(schedule?.task_code) === taskCode && isRetentionDevice(schedule) && !isRetentionDevice(device),
  );
  if (retentionSchedule) {
    retentionSchedule.device = device;
    retentionSchedule.start_at = candidate.start_at;
    retentionSchedule.end_at = candidate.end_at;
    retentionSchedule.experiment_code = candidate.experiment_code;
    retentionSchedule.lab_code = candidate.lab_code;
    retentionSchedule.lab_id = candidate.lab_id;
    retentionSchedule.planned_hours = candidate.planned_hours;
    retentionSchedule.sub_experiment_code = candidate.sub_experiment_code;
    retentionSchedule.status = STATUS_SCHEDULED;
    if (candidate.axis_codes) {
      retentionSchedule.axis_codes = candidate.axis_codes;
    } else {
      delete retentionSchedule.axis_codes;
    }
    if (candidate.axis_batch_no) {
      retentionSchedule.axis_batch_no = candidate.axis_batch_no;
    } else {
      delete retentionSchedule.axis_batch_no;
    }
    if (!candidate.sub_experiment_code) {
      delete retentionSchedule.sub_experiment_code;
    }
  } else {
    // 否则新增一条排程记录，并根据设备类型设置初始状态。
    nextSchedules.push({
      id: createId("schedule"),
      ...candidate,
      status: isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED,
    });
  }

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now, samples, experimentTrays);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: candidate.experiment_code,
    experiments,
    samples,
    schedules: nextSchedules,
    taskCode,
    tasks,
  });
  const targetSchedule =
    nextSchedules.find((schedule) => normalizeText(schedule?.task_code) === taskCode && scheduleMatchesLab(schedule, candidate)) ||
    nextSchedules[nextSchedules.length - 1];
  const nextStreams = ensureStreamForSchedule(streams, targetSchedule, now);

  return { experiments: nextExperiments, schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function updateScheduleRecord({
  devices = [],
  experiments,
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experimentTrays = [],
  form,
  tasks,
  schedules,
  streams,
  now = serverNowDate(),
  samples = [],
}) {
  const scheduleId = normalizeText(form?.id);
  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
  const target = nextSchedules.find((schedule) => normalizeText(schedule?.id) === scheduleId);
  if (!target) {
    return { error: "未找到排程记录" };
  }
  if (
    scheduleExperimentHasStarted({
      experimentRuns,
      experimentRunSteps,
      experimentRunTrays,
      experimentTrays,
      samples,
      schedule: target,
    })
  ) {
    return { error: RUNNING_SCHEDULE_RESCHEDULE_MESSAGE };
  }

  const resolved = resolveScheduleTimes(form, now, schedules);
  if (resolved.error) {
    return resolved;
  }

  const device = normalizeText(form?.device);
  if (!device) {
    return { error: "请选择实验室" };
  }

  const candidate = {
    device,
    end_at: formatLocalDateTime(resolved.endAt),
    experiment_code: normalizeText(form?.experiment_code),
    lab_code: normalizeText(form?.lab_code ?? form?.labCode),
    lab_id: form?.lab_id ?? form?.labId ?? "",
    planned_hours: resolved.plannedHours,
    start_at: formatLocalDateTime(resolved.startAt),
    sub_experiment_code: resolveSubExperimentCode(form),
    task_code: normalizeText(form?.task_code),
  };
  const deviceRecord = findDeviceRecord(devices, device);
  const deviceBlockMessage = isRetentionDevice(device)
    ? ""
    : resolveDeviceScheduleBlockMessage({
        device: deviceRecord,
        endAt: resolved.endAt,
        now,
        startAt: resolved.startAt,
      });
  if (deviceBlockMessage) {
    return { error: deviceBlockMessage };
  }
  const conflicts = findScheduleConflicts({ candidate, experiments, experimentTrays, samples, schedules: nextSchedules, ignoreId: scheduleId });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 编辑场景直接原位覆盖目标排程记录。
  target.device = device;
  target.start_at = candidate.start_at;
  target.end_at = candidate.end_at;
  target.experiment_code = candidate.experiment_code;
  target.lab_code = candidate.lab_code;
  target.lab_id = candidate.lab_id;
  target.planned_hours = candidate.planned_hours;
  target.sub_experiment_code = candidate.sub_experiment_code;
  target.status = isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED;
  if (!candidate.sub_experiment_code) {
    delete target.sub_experiment_code;
  }

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now, samples, experimentTrays);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: candidate.experiment_code,
    experiments,
    samples,
    schedules: nextSchedules,
    taskCode: candidate.task_code,
    tasks,
  });
  const nextStreams = ensureStreamForSchedule(streams, target, now);

  return { experiments: nextExperiments, schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function deleteScheduleRecord({
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experimentTrays = [],
  experiments,
  samples = [],
  scheduleId,
  tasks,
  schedules,
  streams,
  now = serverNowDate(),
}) {
  const removedSchedule = (Array.isArray(schedules) ? schedules : []).find(
    (schedule) => normalizeText(schedule?.id) === normalizeText(scheduleId),
  );
  if (
    scheduleExperimentHasStarted({
      experimentRuns,
      experimentRunSteps,
      experimentRunTrays,
      experimentTrays,
      samples,
      schedule: removedSchedule,
    })
  ) {
    return {
      error: RUNNING_SCHEDULE_DELETE_MESSAGE,
      experiments: Array.isArray(experiments) ? experiments.map((experiment) => ({ ...experiment })) : [],
      schedules: Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [],
      streams: Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [],
      tasks: Array.isArray(tasks) ? tasks.map((task) => ({ ...task })) : [],
    };
  }
  const nextSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.id) !== normalizeText(scheduleId),
  );
  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now, samples, experimentTrays);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: normalizeText(removedSchedule?.experiment_code),
    experiments,
    samples,
    schedules: nextSchedules,
    taskCode: normalizeText(removedSchedule?.task_code),
    tasks,
  });
  return {
    experiments: nextExperiments,
    schedules: nextSchedules,
    streams: Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [],
    tasks: nextTasks,
  };
}


export {
  createScheduleRecord,
  deleteScheduleRecord,
  updateScheduleRecord,
};
