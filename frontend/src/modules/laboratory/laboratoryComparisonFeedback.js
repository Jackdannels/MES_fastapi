import { APPEARANCE_INSPECTION_LOCATION } from "./laboratoryConstants";

const normalizeText = (value) => String(value ?? "").trim();

const buildBlockedComparisonResult = (trayCode, status) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "实验已完成" || normalizedStatus === "实验完成" || normalizedStatus === "实验后暂存间存放" || normalizedStatus === "厂家收回") {
    return {
      guidance: `${normalizedTrayCode} 已完成实验，无需再次比对。`,
      message: "托盘已完成实验",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  if (normalizedStatus === "实验进行中" || normalizedStatus === "实验中") {
    return {
      guidance: `${normalizedTrayCode} 当前实验正在进行中，不能再次比对。`,
      message: "托盘实验进行中",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  return {
    guidance: `${normalizedTrayCode} 当前状态为${normalizedStatus || "已比对"}，已完成任务比对，无需再次比对。`,
    message: "托盘已完成比对",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const resolveNotDispatchedSourceGuidance = (tray = null) => {
  const location = normalizeText(tray?.currentLocation || tray?.location);
  const status = normalizeText(tray?.trayStatus || tray?.displayStatus);
  if (status === "送至外观检测间") {
    return "当前托盘需先进入外观检测间并完成入库，再由外观检测间出库送至实验室。";
  }
  if (
    location.includes(APPEARANCE_INSPECTION_LOCATION)
    || status.includes(APPEARANCE_INSPECTION_LOCATION)
  ) {
    return "请先在外观检测间完成出库并送至实验室。";
  }
  const sourceLabel = location.includes("暂存间") || status.includes("暂存间") ? "暂存间" : "接驳间";
  return `请先在${sourceLabel}完成出库并送至实验室。`;
};

const buildNotDispatchedComparisonResult = (trayCode, tray = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  return {
    guidance: resolveNotDispatchedSourceGuidance(tray),
    message: "托盘尚未出库",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const buildWrongLaboratoryDispatchResult = (trayCode, tray = null, currentTask = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const location = normalizeText(tray?.targetLab || tray?.target_lab || tray?.currentLocation || tray?.location);
  const currentLab = normalizeText(currentTask?.device);
  return {
    guidance: `${normalizedTrayCode} 已出库至${location || "其他试验间"}，请先出库至${currentLab || "当前试验间"}后再比对。`,
    message: "托盘未送达当前试验间",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const buildActiveOtherExperimentComparisonResult = (trayCode, lock = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const experimentName = normalizeText(lock?.experimentName);
  const device = normalizeText(lock?.device);
  const runningLabel = [device, experimentName].filter(Boolean).join(" / ") || "其他实验";
  return {
    guidance: `${normalizedTrayCode} 正在${runningLabel}进行实验，完成后才可在当前试验间比对。`,
    message: "托盘正在其他实验中",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

export {
  buildActiveOtherExperimentComparisonResult,
  buildBlockedComparisonResult,
  buildNotDispatchedComparisonResult,
  buildWrongLaboratoryDispatchResult,
};
