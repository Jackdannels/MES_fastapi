const RETURNED_STATUS = "厂家收回";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const resolveTaskCode = (task) => normalizeText(task?.code || task?.task_code || task?.taskNo || task?.task_no || task?.id);
const resolveSampleTaskCode = (sample) => normalizeText(sample?.task_code || sample?.taskCode || sample?.taskNo || sample?.task_no);
const resolveTrayStatus = (tray) => normalizeText(tray?.status || tray?.tray_status || tray?.trayStatus);

const isReturnedTrayStatus = (status) => normalizeText(status) === RETURNED_STATUS;

const collectAssignedTrayStatuses = (task, samples) => {
  const taskCode = resolveTaskCode(task);
  if (!taskCode) {
    return [];
  }
  const statusByTrayCode = new Map();
  asArray(samples).forEach((sample) => {
    if (resolveSampleTaskCode(sample) !== taskCode) {
      return;
    }
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code || tray?.trayCode || tray?.trayNo || tray?.tray_no || tray?.code);
      const status = resolveTrayStatus(tray);
      if (trayCode && status) {
        statusByTrayCode.set(trayCode, status);
      }
    });
  });
  return Array.from(statusByTrayCode.values());
};

const hasExplicitReturnedStatus = (task) =>
  isReturnedTrayStatus(task?.transfer_status) ||
  isReturnedTrayStatus(task?.transferStatus) ||
  isReturnedTrayStatus(task?.status) ||
  isReturnedTrayStatus(task?.displayStatus) ||
  isReturnedTrayStatus(task?.display_status);

const isReturnedTask = (task, samples) => {
  const trayStatuses = collectAssignedTrayStatuses(task, samples);
  if (trayStatuses.length > 0) {
    return trayStatuses.every(isReturnedTrayStatus);
  }
  return hasExplicitReturnedStatus(task);
};

const filterActiveTasks = (tasks, samples) => asArray(tasks).filter((task) => !isReturnedTask(task, samples));

export {
  RETURNED_STATUS,
  collectAssignedTrayStatuses,
  filterActiveTasks,
  hasExplicitReturnedStatus,
  isReturnedTask,
  isReturnedTrayStatus,
};
