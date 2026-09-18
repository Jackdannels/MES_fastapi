import { resolveLaboratoryDisplayName } from "@/lib/labs";
import { historyEntryAppliesToTray } from "./sampleFlow.runtimeEvidence";

const text = (value) => String(value ?? "").trim();
const rows = (value) => Array.isArray(value) ? value : [];
const time = (value) => Date.parse(value) || 0;
const preciseLab = (value) => {
  const name = resolveLaboratoryDisplayName(text(value));
  return name && name !== "实验室" && name !== "试验室" && /室$/.test(name)
    && !/暂存|外观|接驳|拆箱/.test(name) ? name : "";
};

// Only presentation changes: label remains the canonical business status used by
// rank/time matching. Both sample and visualization render displayLabel.
function presentLaboratoryArrivals(flow, input = {}) {
  const taskCode = text(input.taskCode), trayCode = text(input.trayCode || flow.trayCode);
  const samples = rows(input.samples).filter((sample) => text(sample.task_code) === taskCode
    && rows(sample.trays).some((tray) => text(tray.tray_code || tray.trayCode) === trayCode));
  const history = samples.flatMap((sample) => rows(sample.history).filter((entry) => {
    const explicitTray = text(entry.tray_code || entry.trayCode);
    if (explicitTray && explicitTray !== trayCode) return false;
    if (rows(entry.tray_codes).length && !entry.tray_codes.includes(trayCode)) return false;
    return historyEntryAppliesToTray(entry, sample, trayCode);
  }));
  const steps = rows(flow.steps).map((step, index, all) => {
    const dispatchStep = step.label === "送至实验室" || step.key === "sent_to_lab";
    const arrivalStep = step.label === "已到达实验室";
    if (!arrivalStep && !dispatchStep) return step;
    const status = dispatchStep ? "送至实验室" : "已到达实验室";
    let lab = preciseLab(step.lab_name || step.labName || step.lab_code || step.labCode);
    if (!lab && time(step.time)) {
      const matches = history.filter((entry) => (text(entry.status) === status
        || (dispatchStep && text(entry.status) === "等待恢复实验" && text(entry.action).includes("出库")))
        && time(entry.time || entry.updated_at) === time(step.time)
        && (!step.experimentCode || !entry.experiment_code || text(entry.experiment_code) === text(step.experimentCode)));
      const names = [...new Set(matches.map((entry) => preciseLab(entry.location || entry.lab_name || entry.lab_code)).filter(Boolean))];
      // Exact historical event wins over a newly edited schedule/current location.
      if (names.length === 1) lab = names[0];
    }
    if (!lab && !step.time) {
      const prefix = text(step.key).match(/^(route-\d+-)/)?.[1];
      const dispatch = all.slice(0, index).reverse().find((entry) =>
        (prefix ? text(entry.key).startsWith(prefix) : entry.key === "sent_to_lab") && text(entry.label).startsWith("送至"));
      lab = preciseLab(text(dispatch?.label).replace(/^送至/, ""));
      if (!lab && step.active) {
        const names = [...new Set(samples.map((sample) => preciseLab(sample.location)).filter(Boolean))];
        if (names.length === 1) lab = names[0];
      }
    }
    return lab ? { ...step, displayLabel: `${dispatchStep ? "送至" : "已到达"}${lab}` } : step;
  });
  return { ...flow, steps };
}

function formatLaboratoryFlowStatus(flow = {}) {
  const source = text(flow.currentStatus);
  const active = rows(flow.steps).find((step) => step.active && step.displayLabel);
  if (!active || !["已到达实验室", "送至实验室"].includes(active.label)) return source;
  const suffix = `当前状态：${active.label}`;
  return source.endsWith(suffix) ? `${source.slice(0, -suffix.length)}当前状态：${active.displayLabel}` : source;
}

export { presentLaboratoryArrivals, formatLaboratoryFlowStatus };
