import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

const readErrorMessage = async (response) => {
  const payload = await response.json().catch(() => null);
  return payload?.detail || payload?.message || `请求失败（${response.status}）`;
};

const withdrawCurrentLaboratoryExperiment = async ({
  axisBatchNo = "",
  experimentCode,
  reason = "",
  scheduleId = "",
  subExperimentCode = "",
  taskCode,
  trayCodes = [],
}) => {
  const normalizedTaskCode = String(taskCode || "").trim();
  const normalizedExperimentCode = String(experimentCode || "").trim();
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    throw new Error("缺少当前任务或实验信息。");
  }
  const response = await fetch(
    buildApiUrl(
      `/api/laboratory/tasks/${encodeURIComponent(normalizedTaskCode)}/experiments/${encodeURIComponent(normalizedExperimentCode)}/withdraw-current`,
      API_BASE_URL,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        axisBatchNo,
        reason,
        scheduleId,
        subExperimentCode,
        trayCodes: Array.isArray(trayCodes) ? trayCodes : [],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

const applyLaboratoryOperation = async ({
  experimentCode,
  labCode = "",
  labName = "",
  occurredAt = "",
  operationType,
  scheduleId = "",
  subExperimentCode = "",
  taskCode,
  trayCodes = [],
}) => {
  const normalizedTaskCode = String(taskCode || "").trim();
  const normalizedExperimentCode = String(experimentCode || "").trim();
  const normalizedOperationType = String(operationType || "").trim();
  if (!normalizedTaskCode || !normalizedExperimentCode || !normalizedOperationType) {
    throw new Error("缺少当前任务、实验或操作类型。");
  }
  const response = await fetch(buildApiUrl("/api/laboratory/operations", API_BASE_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      experimentCode: normalizedExperimentCode,
      labCode: String(labCode || "").trim(),
      labName: String(labName || "").trim(),
      occurredAt: String(occurredAt || "").trim(),
      operationType: normalizedOperationType,
      scheduleId: String(scheduleId || "").trim(),
      subExperimentCode: String(subExperimentCode || "").trim(),
      taskCode: normalizedTaskCode,
      trayCodes: Array.isArray(trayCodes) ? trayCodes : [],
    }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

const startLaboratoryExperiment = async ({
  axisBatchNo = "",
  axisCodes = [],
  currentAxisCode = "",
  experimentCode,
  labCode = "",
  labName = "",
  plannedEndAt = "",
  plannedHours = null,
  runNo = "",
  scheduleId = "",
  startedAt = "",
  subExperimentCode = "",
  taskCode,
  trayCodes = [],
}) => {
  const normalizedTaskCode = String(taskCode || "").trim();
  const normalizedExperimentCode = String(experimentCode || "").trim();
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    throw new Error("缺少当前任务或实验信息。");
  }
  const body = {
    axisBatchNo: String(axisBatchNo || "").trim(),
    axisCodes: Array.isArray(axisCodes) ? axisCodes : [],
    currentAxisCode: String(currentAxisCode || "").trim(),
    labCode: String(labCode || "").trim(),
    labName: String(labName || "").trim(),
    plannedEndAt: String(plannedEndAt || "").trim(),
    plannedHours,
    runNo: String(runNo || "").trim(),
    scheduleId: String(scheduleId || "").trim(),
    startedAt: String(startedAt || "").trim(),
    subExperimentCode: String(subExperimentCode || "").trim(),
    trayCodes: Array.isArray(trayCodes) ? trayCodes : [],
  };
  const scopedBody = Object.fromEntries(
    Object.entries(body).filter(([, value]) => (
      Array.isArray(value) ? value.length > 0 : value !== "" && value !== null && value !== undefined
    )),
  );
  const response = await fetch(
    buildApiUrl(
      `/api/laboratory/tasks/${encodeURIComponent(normalizedTaskCode)}/experiments/${encodeURIComponent(normalizedExperimentCode)}/start`,
      API_BASE_URL,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      ...(Object.keys(scopedBody).length ? { body: JSON.stringify(scopedBody) } : {}),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

const markLaboratoryAxisAdjustmentReady = async ({
  axisCode,
  experimentCode,
  labCode = "",
  labName = "",
  runNo,
  taskCode,
}) => {
  const normalizedTaskCode = String(taskCode || "").trim();
  const normalizedExperimentCode = String(experimentCode || "").trim();
  const normalizedRunNo = String(runNo || "").trim();
  const normalizedAxisCode = String(axisCode || "").trim();
  if (!normalizedTaskCode || !normalizedExperimentCode || !normalizedRunNo || !normalizedAxisCode) {
    throw new Error("缺少当前任务、实验、运行批次或轴向信息。");
  }
  const response = await fetch(
    buildApiUrl(
      `/api/laboratory/tasks/${encodeURIComponent(normalizedTaskCode)}/experiments/${encodeURIComponent(normalizedExperimentCode)}/axis-adjustment-ready`,
      API_BASE_URL,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        axisCode: normalizedAxisCode,
        labCode: String(labCode || "").trim(),
        labName: String(labName || "").trim(),
        runNo: normalizedRunNo,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

const completeLaboratoryExperiment = async ({
  axisCode = "",
  completedAt = "",
  experimentCode,
  nextAxisCode = "",
  runNo = "",
  subExperimentCode = "",
  taskCode,
  trayCodes = [],
}) => {
  const normalizedTaskCode = String(taskCode || "").trim();
  const normalizedExperimentCode = String(experimentCode || "").trim();
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    throw new Error("缺少当前任务或实验信息。");
  }
  const response = await fetch(
    buildApiUrl(
      `/api/laboratory/tasks/${encodeURIComponent(normalizedTaskCode)}/experiments/${encodeURIComponent(normalizedExperimentCode)}/complete`,
      API_BASE_URL,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        axisCode,
        completedAt,
        nextAxisCode,
        runNo,
        subExperimentCode,
        trayCodes: Array.isArray(trayCodes) ? trayCodes : [],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

export {
  applyLaboratoryOperation,
  completeLaboratoryExperiment,
  markLaboratoryAxisAdjustmentReady,
  startLaboratoryExperiment,
  withdrawCurrentLaboratoryExperiment,
};
