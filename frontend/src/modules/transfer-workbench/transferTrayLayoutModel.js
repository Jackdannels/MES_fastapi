import { normalizeTrayLimit } from "./model";

const encodeTaskTrayId = (serial) => 1000 + serial;
const sampleSort = (left, right) => String(left?.sampleNo || "").localeCompare(String(right?.sampleNo || ""));

const normalizeTraySamples = (samples) => samples
  .slice()
  .sort(sampleSort);

const createTaskTrayRef = (serial, limit, { taskCode, taskId }) => ({
  trayId: encodeTaskTrayId(serial),
  trayNo: `${taskCode || "TASK"}-TP-${String(serial).padStart(3, "0")}`,
  trayType: "标准托盘",
  capacity: limit,
  currentTaskId: taskId,
});

const createInventorySlot = (slot, index, limit) => ({
  trayId: Number.parseInt(slot?.trayId, 10) || 5000 + index + 1,
  trayNo: String(slot?.trayNo || `INVENTORY-${index + 1}`),
  trayType: slot?.trayType || "标准托盘",
  capacity: Number.parseInt(slot?.capacity, 10) || limit,
  currentTaskId: null,
});

const normalizeInventoryRefs = (inventory, limit) => inventory
  .map((slot, index) => createInventorySlot(slot, index, limit));

const buildInventorySlots = (count, limit) => normalizeInventoryRefs(
  Array.from({ length: count }, () => ({})),
  limit,
);

const createEditableTray = (trayRef, limit, samples = []) => {
  const normalizedSamples = normalizeTraySamples(samples);
  return {
    trayId: trayRef.trayId,
    trayNo: trayRef.trayNo,
    trayType: trayRef.trayType || "标准托盘",
    trayStatus: "已预分配",
    capacity: limit,
    loadQty: normalizedSamples.length,
    samples: normalizedSamples,
    barcode: null,
    barcodeData: null,
  };
};

const normalizeEditableTrays = (trays, limit, taskContext) => trays.map((tray, index) => createEditableTray(
  createTaskTrayRef(index + 1, limit, taskContext),
  limit,
  tray.samples,
));

const collectOrderedSamples = (sourceTrays) => sourceTrays
  .flatMap((tray) => tray.samples.map((sample) => ({ ...sample })))
  .sort(sampleSort);

const buildRebalancedTrayLayout = ({
  assignedTrays,
  availableInventoryCount,
  limit,
  pendingStatus,
  taskContext,
}) => {
  const normalizedLimit = normalizeTrayLimit(limit);
  const orderedSamples = collectOrderedSamples(assignedTrays);
  const requiredCount = Math.max(1, Math.ceil(orderedSamples.length / normalizedLimit));
  const totalTrayPoolCount = Math.max(requiredCount, assignedTrays.length + availableInventoryCount);
  const nextAssigned = Array.from({ length: requiredCount }, (_, index) => createEditableTray(
    createTaskTrayRef(index + 1, normalizedLimit, taskContext),
    normalizedLimit,
    [],
  ));

  orderedSamples.forEach((sample, index) => {
    nextAssigned[Math.floor(index / normalizedLimit)].samples.push({
      ...sample,
      sampleStatus: pendingStatus,
    });
  });

  return {
    assignedTrays: nextAssigned.map((tray) => createEditableTray(tray, normalizedLimit, tray.samples)),
    availableInventory: buildInventorySlots(totalTrayPoolCount - requiredCount, normalizedLimit),
    trayLimit: normalizedLimit,
  };
};

const buildAllocationPayload = ({ assignedTrays, experiments, experimentTraySelections, trayLimit }) => {
  const trayByNo = new Map(assignedTrays.map((tray, index) => [tray.trayNo, {
    index,
    trayId: tray.trayId,
  }]));

  return {
    trayLimit,
    trays: assignedTrays.map((tray) => ({
      trayId: tray.trayId,
      sampleIds: tray.samples.map((sample) => sample.sampleId),
    })),
    experimentTrays: experiments.map((experiment) => {
      const selectedTrayNos = Array.isArray(experimentTraySelections[experiment.experimentCode])
        ? experimentTraySelections[experiment.experimentCode]
        : [];
      const seenTrayNos = new Set();
      const selectedTrays = [];
      selectedTrayNos.forEach((trayNo) => {
        const tray = trayByNo.get(trayNo);
        if (!tray || seenTrayNos.has(trayNo)) {
          return;
        }
        seenTrayNos.add(trayNo);
        selectedTrays.push(tray);
      });
      selectedTrays.sort((left, right) => left.index - right.index);
      return {
        experimentCode: experiment.experimentCode,
        trayIds: selectedTrays.map((tray) => tray.trayId),
      };
    }),
  };
};

export {
  buildAllocationPayload,
  buildInventorySlots,
  buildRebalancedTrayLayout,
  createTaskTrayRef,
  normalizeEditableTrays,
  normalizeInventoryRefs,
  normalizeTraySamples,
};
