import { DEVICE_FAULT_CANCELED } from "@/lib/deviceFaultCancellation";
import { SAMPLE_FLOW_STEPS } from "./sampleFlow.constants";
import { normalizeHistoryFlowLabel } from "./sampleFlow.flowTimeHelpers";
import { historyEntryAppliesToTray } from "./sampleFlow.runtimeEvidence";

const text = (value) => String(value ?? "").trim();
const rows = (value) => Array.isArray(value) ? value : [];
const eventTime = (entry) => text(entry?.time || entry?.ended_at || entry?.updated_at);
const timestamp = (value) => Date.parse(value) || 0;
const foundationalKeys = new Set(["in_transit", "arrived", "arrival"]);
const attemptKeys = new Set(["sent_to_staging", "arrived_staging", "sent_to_lab", "arrived_lab", "fixture_install", "ready", "running", "completed"]);

function trayHistory(input, taskCode, trayCode) {
  return rows(input.samples).filter((sample) => text(sample.task_code) === taskCode).flatMap((sample) =>
    rows(sample.history).filter((entry) => {
      const explicitTray = text(entry.tray_code || entry.trayCode);
      if (explicitTray && explicitTray !== trayCode) return false;
      if (rows(entry.tray_codes).length && !entry.tray_codes.includes(trayCode)) return false;
      return historyEntryAppliesToTray(entry, sample, trayCode);
    }));
}

function insertionIndex(steps, time) {
  // A terminal event can never precede transport/arrival, even with missing timestamps.
  const floor = steps.findLastIndex((step) => foundationalKeys.has(step.key)) + 1;
  const later = steps.findIndex((step, index) => index >= floor && (step.reached || step.active) && timestamp(step.time) > timestamp(time));
  if (later >= 0) return later;
  const prior = steps.findLastIndex((step) => (step.reached || step.active) && timestamp(step.time) && timestamp(step.time) <= timestamp(time));
  return Math.max(floor, prior + 1);
}

function decorateDeviceFaultCancellation(flow, input = {}) {
  const taskCode = text(input.taskCode);
  const trayCode = text(input.trayCode || flow.trayCode);
  const cancellations = rows(input.experimentRunTrays || input.experiment_run_trays)
    .filter((row) => text(row.task_code) === taskCode && text(row.tray_code) === trayCode
      && text(row.run_tray_status || row.status) === DEVICE_FAULT_CANCELED)
    .sort((a, b) => Date.parse(a.ended_at) - Date.parse(b.ended_at));
  if (!cancellations.length) return flow;
  let steps = rows(flow.steps).map((step) => ({ ...step }));
  const history = trayHistory(input, taskCode, trayCode);
  const runs = rows(input.experimentRuns || input.experiment_runs);
  const currentCanceled = rows(input.samples).some((sample) => text(sample.task_code) === taskCode
    && rows(sample.trays).some((tray) => text(tray.tray_code) === trayCode && text(tray.status) === DEVICE_FAULT_CANCELED));
  const isCurrentSingleAttempt = currentCanceled && steps.some((step) => step.key === "running");
  const latestCancellation = cancellations.at(-1);
  const latestCanceledRun = runs.find((run) => text(run.run_no || run.id) === text(latestCancellation.run_no || latestCancellation.runNo));
  const hasNewSchedule = rows(input.schedules).some((schedule) => text(schedule.task_code) === taskCode
    && text(schedule.experiment_code) === text(latestCancellation.experiment_code)
    && text(schedule.id || schedule.schedule_id) !== text(latestCanceledRun?.schedule_id || latestCanceledRun?.schedule_no));
  if (isCurrentSingleAttempt && !hasNewSchedule) {
    // The single-experiment template falls back to transport for an unknown terminal status.
    // Replace its stale attempt (including normal completion) with actual historical milestones.
    steps = steps.filter((step) => !attemptKeys.has(step.key));
  }
  for (const step of steps.filter((entry) => foundationalKeys.has(entry.key))) {
    const label = step.key === "in_transit" ? "样品运输中" : "到货";
    const evidence = history.filter((entry) => normalizeHistoryFlowLabel(entry.status, entry.location) === label)
      .sort((a, b) => timestamp(eventTime(a)) - timestamp(eventTime(b)))[0];
    step.reached = true; // A confirmed, started run has necessarily passed these milestones.
    step.active = false;
    step.time = step.time || eventTime(evidence);
  }
  const seen = new Set();
  let previousCancellationTime = 0;
  for (const relation of cancellations) {
    const runNo = text(relation.run_no || relation.runNo);
    if (seen.has(runNo)) continue;
    seen.add(runNo);
    const time = text(relation.ended_at || relation.updated_at);
    const experiment = rows(input.experiments).find((row) => text(row.experiment_code || row.experimentCode) === text(relation.experiment_code));
    const name = text(experiment?.experiment_name || experiment?.experimentName || experiment?.name || relation.experiment_code);
    const run = runs.find((entry) => text(entry.run_no || entry.id) === runNo && text(entry.task_code) === taskCode) || {};
    const lab = text(run.device || run.lab_name);
    const startedAt = text(run.started_at || relation.started_at);
    const segment = [];
    // Full milestone reconstruction is only needed for the current single template. Other
    // templates retain their own route; they still receive an immutable run-start anchor.
    if (isCurrentSingleAttempt) {
      for (const stage of SAMPLE_FLOW_STEPS.filter((entry) => attemptKeys.has(entry.key) && !["running", "completed"].includes(entry.key))) {
        const candidates = history.filter((entry) => {
          const at = timestamp(eventTime(entry));
          if (!at || at <= previousCancellationTime || at > timestamp(time)) return false;
          if (startedAt && at > timestamp(startedAt)) return false;
          if (normalizeHistoryFlowLabel(entry.status, entry.location) !== stage.label) return false;
          const parts = text(entry.detail).split(" / ");
          if (parts[0] === taskCode && parts.length >= 3 && parts[1] !== name) return false;
          return !["sent_to_lab", "arrived_lab", "fixture_install", "ready"].includes(stage.key)
            || !lab || !text(entry.location) || text(entry.location) === lab;
        }).sort((a, b) => timestamp(eventTime(b)) - timestamp(eventTime(a)));
        if (candidates[0]) segment.push({ key: `device-fault-history-${runNo}-${stage.key}`,
          label: stage.key === "sent_to_lab" && lab ? `送至${lab}` : stage.label,
          time: eventTime(candidates[0]), reached: true, active: false, runNo });
      }
    }
    if (startedAt && !steps.some((step) => step.reached && timestamp(step.time) === timestamp(startedAt) && step.label === `${name}进行中`)) {
      segment.push({ key: `device-fault-history-${runNo}-running`, label: `${name}进行中`, time: startedAt, reached: true, active: false, runNo });
    }
    const index = insertionIndex(steps, time);
    steps.splice(index, 0, ...segment, { key: `device-fault-canceled-${runNo}`, label: DEVICE_FAULT_CANCELED,
      reached: true, active: false, time, detail: `${name} / ${runNo}`, runNo, experimentCode: text(relation.experiment_code) });
    previousCancellationTime = timestamp(time);
  }
  if (currentCanceled) {
    // Cancellation leaves the experiment unfinished; the default post-test storage
    // placeholder must not imply a completed-test destination. Keep genuine history.
    steps = steps.filter((step) => !(step.label === "实验后暂存间存放" && !step.reached && !step.active && !step.time));
    // A canceled attempt is historical, while the experiment remains an obligation.
    // Fold the old dispatch/install/start milestones into its cancellation summary,
    // then show a clean, untimed route for the next attempt (as for mold cancellation).
    for (const cancellation of steps.filter((step) => step.key.startsWith("device-fault-canceled-"))) {
      cancellation.collapsedSteps = steps.filter((step) => step.key.startsWith(`device-fault-history-${cancellation.runNo}-`));
    }
    steps = steps.filter((step) => !step.key.startsWith("device-fault-history-"));
    if (isCurrentSingleAttempt) {
      const experiment = rows(input.experiments).find((entry) => text(entry.experiment_code || entry.experimentCode) === text(latestCancellation.experiment_code));
      const name = text(experiment?.experiment_name || experiment?.experimentName || experiment?.name || latestCancellation.experiment_code);
      const newSchedule = rows(input.schedules).find((entry) => text(entry.task_code) === taskCode
        && text(entry.experiment_code) === text(latestCancellation.experiment_code)
        && text(entry.id || entry.schedule_id) !== text(latestCanceledRun?.schedule_id || latestCanceledRun?.schedule_no));
      const pendingRoute = SAMPLE_FLOW_STEPS.filter((step) => attemptKeys.has(step.key) && step.key !== "running")
        .map((step) => ({ ...step, time: "", reached: false, active: false,
          label: step.key === "completed" ? `${name}未完成`
            : step.key === "sent_to_lab" && text(newSchedule?.device) ? `送至${text(newSchedule.device)}` : step.label }));
      steps = steps.filter((step) => !attemptKeys.has(step.key));
      const cancellationIndex = steps.findLastIndex((step) => step.key.startsWith("device-fault-canceled-"));
      steps.splice(cancellationIndex + 1, 0, ...pendingRoute);
    } else {
      for (const experimentCode of new Set(cancellations.map((entry) => text(entry.experiment_code)))) {
        const experiment = rows(input.experiments).find((entry) => text(entry.experiment_code || entry.experimentCode) === experimentCode);
        const name = text(experiment?.experiment_name || experiment?.experimentName || experiment?.name || experimentCode);
        const pendingLabel = `${name}未完成`;
        const resultStep = steps.find((step) => !step.key.startsWith("device-fault-")
          && [pendingLabel, `${name}进行中`, `${name}已完成`].includes(step.label));
        if (resultStep) {
          resultStep.label = pendingLabel;
          resultStep.time = "";
          resultStep.reached = false;
          resultStep.active = false;
          const routeIndex = resultStep.key.match(/^experiment-current-(\d+)$/)?.[1];
          if (routeIndex !== undefined) {
            steps.filter((step) => step.key.startsWith(`route-${routeIndex}-`)).forEach((step) => {
              step.time = "";
              step.reached = false;
              step.active = false;
            });
          }
        } else {
          const tail = steps.findIndex((step) => step.label === "厂家收回" || step.key === "post_test_staging");
          steps.splice(tail < 0 ? steps.length : tail, 0, { key: `device-fault-unfinished-${experimentCode}`,
            label: pendingLabel, time: "", reached: false, active: false, experimentCode });
        }
      }
    }
    steps.forEach((step) => { step.active = false; });
    const latest = [...steps].reverse().find((step) => step.key.startsWith("device-fault-canceled-"));
    if (latest) latest.active = true;
    return { ...flow, steps, canonicalStatus: DEVICE_FAULT_CANCELED, status: DEVICE_FAULT_CANCELED,
      currentStatus: `当前托盘：${trayCode} | 当前状态：${DEVICE_FAULT_CANCELED}` };
  }
  return { ...flow, steps };
}

export { decorateDeviceFaultCancellation };
