export const findSelectedLabTask = (tasks, selectedTaskCode) =>
  tasks.find((task) => task.taskCode === selectedTaskCode) || tasks[0] || null;

export const findSelectedLabTray = (trays, selectedTrayCode) =>
  trays.find((tray) => tray.trayCode === selectedTrayCode) || trays[0] || null;
