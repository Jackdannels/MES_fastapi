const DEVICE_FAULT_CANCELED = "设备故障试验取消";
const text = (value) => String(value ?? "").trim();

function latestDeviceFaultCancellation({ experimentRuns = [], experimentRunTrays = [], taskCode, trayCode }) {
  const relations = experimentRunTrays
    .filter((row) => text(row.task_code || row.taskCode) === text(taskCode) && text(row.tray_code || row.trayCode) === text(trayCode))
    .map((row, index) => ({ row, index, time: Date.parse(row.updated_at || row.ended_at || row.started_at) || 0 }))
    .sort((a, b) => a.time - b.time || a.index - b.index);
  const relation = relations.at(-1)?.row;
  if (text(relation?.run_tray_status || relation?.status) !== DEVICE_FAULT_CANCELED) return null;
  const runNo = text(relation.run_no || relation.runNo);
  const run = experimentRuns.find((row) => text(row.run_no || row.id) === runNo && text(row.task_code) === text(taskCode));
  return run && text(run.status) === DEVICE_FAULT_CANCELED ? { run, relation, runNo, experimentCode: text(relation.experiment_code) } : null;
}

export { DEVICE_FAULT_CANCELED, latestDeviceFaultCancellation };
