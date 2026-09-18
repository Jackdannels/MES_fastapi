import { normalizeHistoryFlowLabel } from "./sampleFlow.flowTimeHelpers";

const text = (value) => String(value ?? "").trim();
const rows = (value) => Array.isArray(value) ? value : [];
const at = (value) => Date.parse(value) || 0;
const eventTime = (row) => text(row?.time || row?.ended_at || row?.updated_at);
const routeKeys = new Set(["sent_to_staging", "arrived_staging", "sent_to_lab", "arrived_lab", "fixture_install", "ready"]);
const isRoute = (step) => /^route-\d+-\d+$/.test(step.key) || routeKeys.has(step.key);
const stageLabel = (step) => /^送至.*(?:实验室|试验室|一室|二室)$/.test(step.label) ? "送至实验室" : step.label;

// A historical cancellation is immutable. Build the subsequent route from evidence,
// never from the position of the current step in a generic template.
function projectDeviceFaultFollowup(flow, input, { history, cancellations }) {
  const boundary = Math.max(...cancellations.map((row) => at(eventTime(row))));
  const taskCode = text(input.taskCode), trayCode = text(input.trayCode || flow.trayCode);
  const sample = rows(input.samples).find((row) => text(row.task_code) === taskCode && rows(row.trays).some((tray) => text(tray.tray_code) === trayCode));
  const tray = rows(sample?.trays).find((row) => text(row.tray_code) === trayCode) || {};
  const currentStatus = text(tray.status || input.status || sample?.status);
  const latestHistory = history.filter((entry) => at(eventTime(entry)) > boundary).sort((a, b) => at(eventTime(b)) - at(eventTime(a)));
  const parsedName = latestHistory.map((entry) => text(entry.detail).split(" / "))
    .find((parts) => parts[0] === taskCode && parts.length >= 3)?.[1];
  const experiments = rows(input.experiments).filter((row) => text(row.task_code || row.taskCode) === taskCode);
  const code = text(input.currentExperimentCode || tray.target_experiment_code || tray.targetExperimentCode)
    || text(experiments.find((entry) => text(entry.experiment_name || entry.experimentName || entry.name) === parsedName)?.experiment_code);
  const experiment = experiments.find((entry) => text(entry.experiment_code || entry.experimentCode) === code);
  const name = text(experiment?.experiment_name || experiment?.experimentName || experiment?.name);
  const schedule = rows(input.schedules).find((entry) => text(entry.task_code) === taskCode && text(entry.experiment_code) === code
    && (!rows(entry.tray_codes).length || entry.tray_codes.includes(trayCode)));
  const lab = text(schedule?.device || input.location || sample?.location);
  const evidence = latestHistory.filter((entry) => {
    const entryCode = text(entry.experiment_code || entry.experimentCode);
    if (entryCode && code && entryCode !== code) return false;
    const parts = text(entry.detail).split(" / ");
    if (parts[0] === taskCode && parts.length >= 3 && name && parts[1] !== name) return false;
    const entrySchedule = text(entry.schedule_id || entry.scheduleId);
    if (entrySchedule && schedule?.id && entrySchedule !== text(schedule.id)) return false;
    return true;
  });
  const events = rows(input.stagingEvents || input.staging_events).filter((entry) => text(entry.task_code) === taskCode
    && text(entry.tray_code) === trayCode && at(eventTime(entry)) > boundary);
  const timeFor = (label) => {
    const times = evidence.filter((entry) => {
      if (normalizeHistoryFlowLabel(entry.status, entry.location) !== label) return false;
      return !["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"].includes(label)
        || !lab || !text(entry.location) || text(entry.location) === lab;
    }).map(eventTime);
    for (const entry of events) {
      if (label === "已到达暂存间" && entry.room === "staging" && entry.action === "stock_in") times.push(eventTime(entry));
      if (label === "送至暂存间" && entry.action === "stock_out" && entry.target_type === "staging") times.push(eventTime(entry));
      if (label === "送至实验室" && entry.action === "stock_out" && entry.target_type !== "staging"
        && (!code || text(entry.target_experiment_code) === code)
        && (!lab || text(entry.target_lab) === lab)) times.push(eventTime(entry));
    }
    return times.sort((a, b) => at(b) - at(a))[0] || "";
  };
  const original = flow.steps.map((step) => ({ ...step }));
  const currentRun = rows(input.experimentRuns || input.experiment_runs).filter((run) =>
    text(run.task_code) === taskCode && text(run.experiment_code) === code && at(run.started_at) > boundary
    && rows(input.experimentRunTrays || input.experiment_run_trays).some((entry) => text(entry.task_code) === taskCode
      && text(entry.tray_code) === trayCode && text(entry.run_no) === text(run.run_no || run.id)))
    .sort((a, b) => at(b.started_at) - at(a.started_at))[0];
  if (currentRun && name) {
    original.forEach((step) => {
      if (step.label === `${name}进行中` || step.key === "running") {
        step.time = text(currentRun.started_at);
      }
      if ((step.label === `${name}已完成` || step.key === "completed") && currentRun.ended_at) {
        step.time = text(currentRun.ended_at);
      }
    });
  }
  for (const canceledCode of new Set(cancellations.map((entry) => text(entry.experiment_code)))) {
    const canceledExperiment = experiments.find((entry) => text(entry.experiment_code || entry.experimentCode) === canceledCode);
    const canceledName = text(canceledExperiment?.experiment_name || canceledExperiment?.experimentName || canceledExperiment?.name);
    const canceledAt = Math.max(...cancellations.filter((entry) => text(entry.experiment_code) === canceledCode).map((entry) => at(eventTime(entry))));
    const hasLaterExecution = rows(input.experimentRunTrays || input.experiment_run_trays).some((entry) =>
      text(entry.task_code) === taskCode && text(entry.tray_code) === trayCode && text(entry.experiment_code) === canceledCode
      && ["实验进行中", "实验中", "实验暂停", "实验已完成", "实验完成"].includes(text(entry.run_tray_status || entry.status))
      && at(entry.started_at || eventTime(entry)) > canceledAt);
    if (!canceledName || hasLaterExecution) continue;
    original.forEach((step) => {
      if ([`${canceledName}进行中`, `${canceledName}已完成`].includes(step.label)) {
        step.label = `${canceledName}未完成`;
        step.time = "";
        step.active = false;
        step.reached = false;
      }
    });
  }
  const activeRoute = original.find((step) => step.active && isRoute(step));
  const activePrefix = activeRoute?.key.match(/^(route-\d+-)/)?.[1];
  const route = original.filter((step) => isRoute(step) && (!activePrefix || step.key.startsWith(activePrefix)));
  const activeIndex = route.findIndex((step) => step.active);
  const retained = new Set();
  route.forEach((step, index) => {
    const time = timeFor(stageLabel(step));
    const wasReached = step.reached;
    step.time = time;
    step.reached = Boolean(time) && !step.active;
    // Omit bypassed optional/past stages; keep future stages as pending, without timestamps.
    if (!time && !step.active && ((activeIndex >= 0 && index < activeIndex) || wasReached)) return;
    retained.add(step);
  });
  let steps = original.filter((step) => !route.includes(step));
  const summaries = steps.filter((step) => step.kind === "device-fault-cancel");
  steps = steps.filter((step) => step.kind !== "device-fault-cancel");
  for (const summary of summaries) {
    const floor = steps.findLastIndex((step) => ["in_transit", "arrival", "arrived"].includes(step.key)) + 1;
    const later = steps.findIndex((step, index) => index >= floor && (step.active || step.reached) && at(step.time) > at(summary.time));
    const prior = steps.findLastIndex((step) => step.reached && at(step.time) && at(step.time) <= at(summary.time));
    steps.splice(later >= 0 ? later : Math.max(floor, prior + 1), 0, summary);
  }
  const lastSummary = steps.findLastIndex((step) => step.kind === "device-fault-cancel");
  steps.splice(lastSummary + 1, 0, ...retained);
  const stockIns = events.filter((entry) => ["stock_in", "stock_out_withdraw"].includes(entry.action))
    .sort((a, b) => at(eventTime(a)) - at(eventTime(b)));
  const currentStorage = stockIns.at(-1);
  const storageStatus = normalizeHistoryFlowLabel(currentStatus, input.location || sample?.location);
  const isStored = ["已到达暂存间", "暂存间存放", "实验前外观检测间存放", "实验后外观检测间存放"].includes(storageStatus);
  const storageSteps = stockIns.map((entry, index) => ({
    key: `device-fault-followup-storage-${entry.id || index}-${at(eventTime(entry))}`,
    label: entry.room === "staging" ? "已到达暂存间" : text(entry.status) || "外观检测间存放",
    time: eventTime(entry), reached: !(isStored && entry === currentStorage), active: isStored && entry === currentStorage,
  }));
  if (storageSteps.length) {
    // An optional storage visit exists only when there is a real stock event.
    steps = steps.filter((step) => !storageSteps.some((storageStep) => step.label === storageStep.label
      && (at(step.time) === at(storageStep.time) || (isStored && step.active))));
    if (isStored) steps.forEach((step) => { step.active = false; });
    for (const storageStep of storageSteps) {
      const floor = steps.findLastIndex((step) => step.kind === "device-fault-cancel" && at(step.time) <= at(storageStep.time)) + 1;
      const later = steps.findIndex((step, index) => index >= floor && ((step.reached || step.active) ? at(step.time) > at(storageStep.time) : true));
      steps.splice(later >= 0 ? later : steps.length, 0, storageStep);
    }
  }
  // Before a run actually starts, its future execution node must not read as underway.
  if (!["实验进行中", "实验中", "实验暂停", "实验已完成"].includes(currentStatus) && name) {
    steps.forEach((step) => {
      if (!step.active && !step.reached && step.label === `${name}进行中`) step.label = `${name}待开始`;
    });
  }
  if (currentStatus === "实验已完成" && name) {
    const completed = steps.find((step) => step.label === `${name}已完成` && at(step.time) > boundary);
    if (completed) steps.forEach((step) => { step.active = step === completed; });
  }
  return { ...flow, steps, ...(isStored && currentStorage ? {
    canonicalStatus: currentStatus, status: currentStatus,
    currentStatus: `当前托盘：${trayCode} | 当前状态：${currentStatus}`,
  } : {}) };
}

export { projectDeviceFaultFollowup };
