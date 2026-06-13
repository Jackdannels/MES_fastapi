import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import {
  asArray,
  entryMatchesTrayCode,
  firstNonEmptyArray,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
} from "./sampleFlow.trayScope";

const isReturnedStatusText = (value) => {
  const text = normalizeText(value);
  return text === "厂家收回" || text === "已处置" || text.includes("厂家收回");
};

const trayHasReturnedStatus = (tray) =>
  isReturnedStatusText(tray?.status)
  || isReturnedStatusText(tray?.tray_status)
  || isReturnedStatusText(tray?.trayStatus);

const entryMarksTrayReturned = (entry, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const structuredTrayCode = resolveEntryTrayCode(entry);
  const detail = normalizeText(entry?.detail);
  const entryIsReturned =
    isReturnedStatusText(entry?.status)
    || isReturnedStatusText(entry?.action)
    || isReturnedStatusText(detail);
  if (!entryIsReturned) {
    return false;
  }
  if (structuredTrayCode && structuredTrayCode === normalizedTrayCode) {
    return true;
  }
  if (entryMatchesTrayCode(entry, normalizedTrayCode)) {
    return true;
  }
  return false;
};

const resolveEffectiveTrayLifecycleStatus = (input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const fallbackStatus = normalizeLifecycleStatus(input.location, input.status);
  if (!taskCode || !trayCode) {
    return fallbackStatus;
  }

  const runtimeReturned = firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays)
    .some((relation) =>
      resolveEntryTaskCode(relation) === taskCode
      && resolveEntryTrayCode(relation) === trayCode
      && isReturnedStatusText(
        relation?.run_tray_status
        || relation?.runTrayStatus
        || relation?.status,
      ),
    );
  if (runtimeReturned) {
    return "厂家收回";
  }

  const matchedSamples = asArray(input.samples).filter((sample) => resolveEntryTaskCode(sample) === taskCode);
  for (const sample of matchedSamples) {
    const trays = asArray(sample?.trays);
    const matchingTrays = trays.filter((tray) => resolveEntryTrayCode(tray) === trayCode);
    if (!matchingTrays.length) {
      continue;
    }
    const trayReturned = matchingTrays.some((tray) =>
      trayHasReturnedStatus(tray),
    );
    const historyReturned = asArray(sample?.history).some((entry) =>
      entryMarksTrayReturned(entry, trayCode),
    );
    if (trayReturned || historyReturned) {
      return "厂家收回";
    }
  }

  return fallbackStatus;
};

export { resolveEffectiveTrayLifecycleStatus };
