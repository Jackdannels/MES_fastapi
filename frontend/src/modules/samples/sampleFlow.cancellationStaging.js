import { historyEntryAppliesToTray } from "./sampleFlow.runtimeEvidence";

const text = (value) => String(value ?? "").trim();
const rows = (value) => Array.isArray(value) ? value : [];
const at = (value) => Date.parse(value) || 0;
const stagingLabels = new Set(["送至暂存间", "已到达暂存间"]);
const downstreamStatuses = new Set(["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验中", "实验暂停", "实验已完成", "实验完成"]);
const isCancellation = (step) => step.kind === "device-fault-cancel" || text(step.key).startsWith("mold-canceled-");
const isNormalStaging = (location) => text(location).includes("暂存间") && !text(location).includes("实验后");

// Shared presentation policy: cancellation starts a new optional staging route.
// Reached includes process inference; timestamps always require an actual event.
function presentCancellationStaging(flow, input = {}) {
  const summaries = rows(flow.steps).filter(isCancellation).sort((a, b) => at(a.time) - at(b.time));
  const summary = summaries.at(-1);
  if (!summary) return flow;
  const boundary = at(summary.time);
  const taskCode = text(input.taskCode), trayCode = text(input.trayCode || flow.trayCode);
  const samples = rows(input.samples).filter((sample) => text(sample.task_code) === taskCode
    && rows(sample.trays).some((tray) => text(tray.tray_code) === trayCode));
  const evidence = [];
  let hasDownstreamHistory = false;
  for (const sample of samples) {
    for (const entry of rows(sample.history)) {
      const entryTray = text(entry.tray_code || entry.trayCode);
      if (entryTray && entryTray !== trayCode) continue;
      if (rows(entry.tray_codes).length && !entry.tray_codes.includes(trayCode)) continue;
      if (!historyEntryAppliesToTray(entry, sample, trayCode) || at(entry.time) <= boundary) continue;
      if (downstreamStatuses.has(text(entry.status))) hasDownstreamHistory = true;
      if (text(entry.status) === "送至暂存间" && !text(entry.location).includes("实验后")) {
        evidence.push({ label: "送至暂存间", time: entry.time });
      } else if (["已到达暂存间", "暂存间存放", "到货"].includes(text(entry.status)) && isNormalStaging(entry.location)) {
        evidence.push({ label: "已到达暂存间", time: entry.time });
      }
    }
  }
  const events = rows(input.stagingEvents || input.staging_events).filter((event) => text(event.task_code) === taskCode
    && text(event.tray_code) === trayCode && at(event.time) > boundary).sort((a, b) => at(a.time) - at(b.time));
  for (const event of events) {
    if (event.action === "stock_out" && (event.target_type === "staging" || isNormalStaging(event.target_lab))
      && !text(event.target_lab).includes("实验后")) evidence.push({ label: "送至暂存间", time: event.time });
    if (event.room === "staging" && ["stock_in", "stock_out_withdraw"].includes(event.action)
      && !text(event.status).includes("实验后") && !text(event.location).includes("实验后")) {
      evidence.push({ label: "已到达暂存间", time: event.time });
    }
  }
  const firstTime = (label) => evidence.filter((entry) => entry.label === label)
    .sort((a, b) => at(a.time) - at(b.time))[0]?.time || "";
  const sentTime = firstTime("送至暂存间"), arrivedTime = firstTime("已到达暂存间");
  const selected = samples[0];
  const selectedTray = rows(selected?.trays).find((tray) => text(tray.tray_code) === trayCode);
  const status = text(selectedTray?.status || input.status || selected?.status);
  const location = text(input.location || selected?.location);
  const hasDownstreamRun = rows(input.experimentRunTrays || input.experiment_run_trays).some((entry) =>
    text(entry.task_code) === taskCode && text(entry.tray_code) === trayCode
    && downstreamStatuses.has(text(entry.run_tray_status || entry.status))
    && at(entry.started_at || entry.updated_at || entry.ended_at) > boundary);
  const hasLabDispatch = events.some((event) => event.action === "stock_out" && event.target_type !== "staging"
    && !isNormalStaging(event.target_lab) && Boolean(event.target_lab || event.target_lab_code));
  const recoveryIsCurrent = rows(flow.steps).some((step) => step.active && text(step.key).startsWith("mold-cancel-recovery-"));
  const advancedPastStaging = !summary.active && !recoveryIsCurrent
    && (downstreamStatuses.has(status) || (/部分完成/.test(status) && /轴/.test(status)))
    && (hasDownstreamHistory || hasDownstreamRun || hasLabDispatch);
  const latestArrival = evidence.filter((entry) => entry.label === "已到达暂存间").sort((a, b) => at(b.time) - at(a.time))[0];
  const pair = [
    { key: `cancel-staging-sent-${summary.key}`, label: "送至暂存间", time: sentTime,
      active: Boolean(sentTime) && status === "送至暂存间" && !location.includes("实验后") },
    { key: `cancel-staging-arrived-${summary.key}`, label: "已到达暂存间", time: arrivedTime,
      active: Boolean(arrivedTime) && at(arrivedTime) === at(latestArrival?.time)
        && ["已到达暂存间", "暂存间存放", "到货"].includes(status) && isNormalStaging(location) },
  ].map((step) => {
    const inferred = !step.time && (advancedPastStaging || (step.label === "送至暂存间" && Boolean(arrivedTime)));
    return { ...step, reached: (Boolean(step.time) || inferred) && !step.active, inferred, optional: true };
  });
  let steps = rows(flow.steps).map((step) => ({ ...step }));
  const summaryIndex = steps.findIndex((step) => step.key === summary.key);
  steps = steps.filter((step, index) => {
    if (index <= summaryIndex) return true;
    if (step.label === "实验后暂存间存放" && !step.active && !step.reached && !step.time) return false;
    if (!stagingLabels.has(step.label)) return true;
    // Reuse the fresh pair instead of duplicate template/stock-in nodes. Other
    // actual visits keep their own positions and times, including earlier cycles.
    if (!step.time || at(step.time) <= boundary) return false;
    return !pair.some((entry) => entry.label === step.label && at(entry.time) === at(step.time));
  });
  let anchor = steps.findIndex((step) => step.key === summary.key) + 1;
  const recovery = steps[anchor];
  if (text(recovery?.key).startsWith("mold-cancel-recovery-")) anchor += 1;
  // No visit: keep the optional pair directly after cancellation/recovery. A real
  // later visit stays after any actual intervening operations (e.g. appearance).
  const firstActual = Math.min(...pair.filter((step) => step.time).map((step) => at(step.time)));
  if (Number.isFinite(firstActual)) {
    for (let index = anchor; index < steps.length; index += 1) {
      if ((steps[index].active || steps[index].reached) && at(steps[index].time) > boundary && at(steps[index].time) < firstActual) anchor = index + 1;
    }
  }
  if (pair.some((step) => step.active)) steps.forEach((step) => { step.active = false; });
  steps.splice(anchor, 0, ...pair);
  return { ...flow, steps };
}

export { presentCancellationStaging };
