import { formatLocalDateTime } from "@/lib/dateTime";
import { normalizeText } from "./sampleFlow.shared";
import {
  normalizeLabels,
  normalizeLifecycleStatus,
  normalizeSamplesSnapshot,
  syncTrayStatusToSampleStatus,
} from "./sampleFlow.status";
import { getSampleTrayList } from "./sampleFlow.trayScope";
import {
  generateId,
  parseCodeList,
} from "./sampleFlow.experimentHelpers";
import {
  appendSampleHistory,
  cloneSampleCollection,
  resolveSampleStatus,
  synchronizeSamplesForTrayCodes,
} from "./sampleFlow.sampleCollection";

function submitSamplesBatchIntake(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.slice() : [],
      }))
    : [];
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const codes = parseCodeList(payload.codes);
  const targetLocation =
    normalizeText(payload.location) ||
    normalizeText(labels.intakeLocation) ||
    normalizeText(labels.unpackingLocation) ||
      normalizeText(labels.preRetentionLocation) ||
      normalizeText(labels.retentionLocation);

  if (!targetLocation || codes.length === 0) {
    return { error: "\u8BF7\u586B\u5199\u5165\u5E93\u4F4D\u7F6E\u548C\u6837\u54C1\u5217\u8868\u3002", samples };
  }

  const now = input.now || formatLocalDateTime();
  codes.forEach((code) => {
    const existing = samples.find((sample) => normalizeText(sample.code) === code);
    const nextStatus = resolveSampleStatus(targetLocation, labels);
    if (existing) {
      existing.location = targetLocation;
      existing.owner = normalizeText(payload.owner) || existing.owner || "";
      existing.status = normalizeLifecycleStatus(targetLocation, nextStatus, labels);
      existing.flow_status = existing.status;
      existing.updated_at = now;
      existing.history = appendSampleHistory(existing, "\u6279\u91CF\u5165\u5E93", "", now);
      return;
    }

    const created = {
      id: generateId("sample"),
      code,
      task_code: "",
      location: targetLocation,
      owner: normalizeText(payload.owner),
      status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      flow_status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      created_at: now,
      updated_at: now,
      trays: [],
      history: [],
    };
    created.history = appendSampleHistory(created, "\u6279\u91CF\u5165\u5E93", "", now);
    samples.unshift(created);
  });

  return { error: "", samples: normalizeSamplesSnapshot(samples, labels) };
}

function updateSampleDetail(input = {}) {
  const sample = input.sample && typeof input.sample === "object" ? { ...input.sample } : null;
  if (!sample) {
    return { error: "\u672A\u627E\u5230\u6837\u54C1\u3002", sample: null };
  }
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const labels = normalizeLabels(input.labels);
  const nextStatus = normalizeText(payload.status) || normalizeText(sample.status);
  const nextRemark = normalizeText(payload.remark);
  const now = input.now || formatLocalDateTime();
  const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);

  if (trayCodes.length > 0) {
    const result = synchronizeSamplesForTrayCodes({
      historyAction: "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0",
      historyDetail: nextRemark,
      labels,
      now,
      samples: [sample],
      status: nextStatus,
      trayCodes,
    });
    return { error: "", sample: result.samples[0] || sample };
  }

  sample.status = normalizeLifecycleStatus(sample.location, nextStatus, labels);
  sample.flow_status = sample.status;
  sample.updated_at = now;
  sample.history = appendSampleHistory(sample, "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0", nextRemark, now);

  return { error: "", sample };
}

function updateTrayStatus(input = {}) {
  const trayCode = normalizeText(input.trayCode);
  const labels = normalizeLabels(input.labels);
  const now = input.now || formatLocalDateTime();
  const samples = cloneSampleCollection(input.samples);

  if (!trayCode || !normalizeText(input.status)) {
    return { error: "请选择托盘和目标状态。", samples };
  }

  const nextStatus = syncTrayStatusToSampleStatus(input.status, "", labels);
  const result = synchronizeSamplesForTrayCodes({
    historyAction: "托盘状态更新",
    historyDetail: `${trayCode} -> ${nextStatus}`,
    labels,
    now,
    samples,
    status: nextStatus,
    trayCodes: [trayCode],
  });

  return {
    error: result.updatedCount > 0 ? "" : `未找到托盘 ${trayCode}。`,
    samples: result.samples,
  };
}

function dispatchStagingSamples(input = {}) {
  const labels = normalizeLabels(input.labels);
  let samples = cloneSampleCollection(input.samples);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const selectedCodes = Array.isArray(input.selectedCodes) ? input.selectedCodes : [];
  const targetLab = normalizeText(payload.targetLab);
  const targetExperimentCode = normalizeText(payload.targetExperimentCode || payload.target_experiment_code);
  const owner = normalizeText(payload.owner);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);
  const codes = Array.from(new Set([...selectedCodes, ...parseCodeList(payload.codes)].map((code) => normalizeText(code)).filter(Boolean)));

  if (!targetLab || codes.length === 0) {
    return {
      error: "请填写样品编号并选择目标实验室。",
      samples,
      dispatchedCodes: [],
    };
  }

  const missing = [];
  const notStaging = [];
  const dispatchedCodes = [];
  const now = input.now || formatLocalDateTime();
  const trayCodesToSync = new Set();
  const dispatchLocation = targetLab;
  const dispatchStatus = "已到达实验室";

  codes.forEach((code) => {
    const sample = samples.find((item) => normalizeText(item?.code) === code);
    if (!sample) {
      missing.push(code);
      return;
    }
    if (normalizeText(sample.location) !== preRetentionLocation) {
      notStaging.push(code);
      return;
    }

    getSampleTrayList(sample).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (trayCode) {
        trayCodesToSync.add(trayCode);
      }
    });
    sample.location = dispatchLocation;
    sample.owner = owner || normalizeText(sample.owner);
    sample.status = normalizeLifecycleStatus(dispatchLocation, dispatchStatus, labels);
    sample.flow_status = sample.status;
    sample.updated_at = now;
    sample.history = appendSampleHistory(sample, "暂存间派发", "", now);
    dispatchedCodes.push(code);
  });

  if (trayCodesToSync.size > 0) {
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: "",
      labels,
      location: dispatchLocation,
      now,
      owner,
      samples,
      status: dispatchStatus,
      targetExperimentCode,
      targetLab,
      trayCodes: Array.from(trayCodesToSync),
    });
    samples = synced.samples;
  }

  const warnings = [];
  if (missing.length) {
    warnings.push(`未找到样品：${missing.join("、")}`);
  }
  if (notStaging.length) {
    warnings.push(`不在暂存间：${notStaging.join("、")}`);
  }

  return {
    error: warnings.length ? `${warnings.join("；")}。` : "",
    samples,
    dispatchedCodes,
  };
}

export {
  dispatchStagingSamples,
  submitSamplesBatchIntake,
  updateSampleDetail,
  updateTrayStatus,
};
