import { DEVICE_FAULT_CANCELED } from "@/lib/deviceFaultCancellation";
import { labIdentityMatches, resolveLabRef } from "@/lib/labIdentity";
import { resolveLaboratoryDisplayName, resolveLaboratoryRouteKey } from "@/lib/labs";

const text = (value) => String(value ?? "").trim();
const rows = (value) => Array.isArray(value) ? value : [];
const at = (value) => Date.parse(value) || 0;
const taskOf = (row) => text(row?.task_code || row?.taskCode || row?.task_no);
const trayOf = (row) => text(row?.tray_code || row?.trayCode || row?.tray_no);
const runOf = (row) => text(row?.run_no || row?.runNo || row?.id);
const experimentOf = (row) => text(row?.experiment_code || row?.experimentCode || row?.experiment_no);
const statusOf = (row) => text(row?.run_tray_status || row?.runTrayStatus || row?.run_status || row?.status);
const eventTime = (row) => at(row?.time || row?.updated_at || row?.ended_at || row?.started_at);
const movingStatuses = new Set(["送至暂存间", "已到达暂存间", "暂存间存放", "实验后暂存间存放", "送至外观检测间", "实验前外观检测间存放", "实验后外观检测间存放", "送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "厂家收回"]);

const canonicalLab = (lab) => {
  const ref = resolveLabRef(lab);
  const routeKey = resolveLaboratoryRouteKey(ref.name);
  const code = ref.code || (routeKey.startsWith("LAB_") ? routeKey : "");
  return { ...ref, code, name: ref.name || resolveLaboratoryDisplayName(code),
    aliases: [...new Set([...ref.aliases, ...rows(lab?.aliases).map(text).filter(Boolean)])] };
};
const matchesLab = (source, lab) => {
  const target = canonicalLab(lab);
  if (labIdentityMatches(source, target)) return true;
  const sourceId = text(source.lab_id || source.labId);
  const sourceCode = text(source.lab_code || source.labCode);
  // A legacy display alias cannot override a conflicting explicit identity.
  if ((sourceId && target.id && sourceId !== target.id)
    || (sourceCode && target.code && sourceCode !== target.code)) return false;
  return target.aliases.includes(text(source.device || source.device_name || source.location));
};
const appliesToTray = (entry, sample, trayCode) => {
  if (trayOf(entry)) return trayOf(entry) === trayCode;
  const explicit = rows(entry?.tray_codes || entry?.trayCodes);
  if (explicit.length) return explicit.includes(trayCode);
  return rows(sample.trays).length === 1;
};

function createFaultTrayResidencyResolver({ experimentRuns, experimentRunTrays, stagingEvents, samples }) {
  const runs = new Map(rows(experimentRuns).map((run) => [`${taskOf(run)}::${runOf(run)}`, run]));
  const latestRelations = new Map();
  for (const relation of rows(experimentRunTrays)) {
    const key = `${taskOf(relation)}::${trayOf(relation)}`;
    const run = runs.get(`${taskOf(relation)}::${runOf(relation)}`);
    const time = eventTime(relation) || eventTime(run);
    if (!latestRelations.has(key) || time >= latestRelations.get(key).time) latestRelations.set(key, { relation, run, time });
  }
  const movementByTray = new Map();
  const positionsByTray = new Map();
  const appendMovement = (key, entry) => movementByTray.set(key, [...(movementByTray.get(key) || []), entry]);
  for (const event of rows(stagingEvents)) {
    if (!taskOf(event) || !trayOf(event)) continue;
    if (["stock_in", "stock_out", "stock_out_withdraw", "manufacturer_return"].includes(text(event.action))) appendMovement(`${taskOf(event)}::${trayOf(event)}`, event);
  }
  for (const sample of rows(samples)) {
    for (const tray of rows(sample.trays)) {
      const key = `${taskOf(sample)}::${trayOf(tray)}`;
      const history = rows(sample.history).filter((entry) => appliesToTray(entry, sample, trayOf(tray)));
      for (const entry of history) {
        if (movingStatuses.has(text(entry.status))) appendMovement(key, entry);
      }
      const time = Math.max(eventTime(tray), eventTime(sample), ...history.map(eventTime), 0);
      const position = { sample, tray, time };
      if (!positionsByTray.has(key) || time >= positionsByTray.get(key).time) positionsByTray.set(key, position);
    }
  }
  return (sample, tray) => {
    const key = `${taskOf(sample)}::${trayOf(tray)}`;
    const latest = latestRelations.get(key);
    if (!latest?.run || statusOf(latest.relation) !== DEVICE_FAULT_CANCELED
      || statusOf(latest.run) !== DEVICE_FAULT_CANCELED
      || experimentOf(latest.relation) !== experimentOf(latest.run)) return null;
    const originalLab = canonicalLab({ lab_code: latest.run.lab_code || latest.run.labCode,
      lab_id: latest.run.lab_id || latest.run.labId,
      name: latest.run.device || latest.run.device_name || latest.run.lab_name });
    if (!originalLab.name && !originalLab.code && !originalLab.id) return null;
    const canceledAt = at(latest.relation.ended_at || latest.run.ended_at) || latest.time;
    const hasExited = canceledAt > 0 && (movementByTray.get(key) || []).some((entry) => {
      if (text(entry.source) === "device_fault_cancellation") return false;
      const time = eventTime(entry);
      return time > canceledAt || (time === canceledAt
        && ["stock_out", "stock_in", "manufacturer_return"].includes(text(entry.action)));
    });
    const physical = positionsByTray.get(key) || { sample, tray };
    const physicalSample = physical.sample;
    const physicalTray = physical.tray;
    const physicalStatus = text(physicalTray.status || physicalSample.flow_status || physicalSample.status);
    const explicitPosition = text(physicalTray.location || physicalTray.current_lab_code || physicalTray.currentLabCode);
    let atOriginalLab = matchesLab({ location: explicitPosition || physicalSample.location }, originalLab);
    // A shared sample's aggregate location may describe the other tray that
    // just moved. Its untouched canceled sibling still belongs to the old run.
    if (!explicitPosition && !atOriginalLab && rows(physicalSample.trays).length > 1 && physicalStatus === DEVICE_FAULT_CANCELED) {
      atOriginalLab = rows(physicalSample.trays).some((other) => trayOf(other) !== trayOf(tray)
        && (movementByTray.get(`${taskOf(sample)}::${trayOf(other)}`) || []).some((entry) => eventTime(entry) > canceledAt));
    }
    return { originalLab, runNo: runOf(latest.run), canceledAt,
      isResident: physicalStatus === DEVICE_FAULT_CANCELED && atOriginalLab && !hasExited,
      hasExited, actualLocation: resolveLaboratoryDisplayName(originalLab.code || originalLab.name) };
  };
}

const faultResidencyMatchesLab = (context, lab) => matchesLab({
  lab_code: context.originalLab.code, lab_id: context.originalLab.id, device: context.originalLab.name,
}, lab);

export { createFaultTrayResidencyResolver, faultResidencyMatchesLab };
