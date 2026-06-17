import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";

const API_BASE_URL = getFrontendApiBaseUrl();

const readErrorMessage = async (response) => {
  const payload = await response.json().catch(() => null);
  return payload?.detail || payload?.message || `请求失败（${response.status}）`;
};

const withdrawCurrentLaboratoryExperiment = async ({ taskCode, experimentCode, reason = "" }) => {
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
      body: JSON.stringify({ reason }),
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
  experimentCode,
  labCode = "",
  labName = "",
  plannedEndAt = "",
  plannedHours = null,
  runNo = "",
  scheduleId = "",
  startedAt = "",
  taskCode,
  trayCodes = [],
}) => {
  const normalizedTaskCode = String(taskCode || "").trim();
  const normalizedExperimentCode = String(experimentCode || "").trim();
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    throw new Error("缺少当前任务或实验信息。");
  }
  const body = {
    labCode: String(labCode || "").trim(),
    labName: String(labName || "").trim(),
    plannedEndAt: String(plannedEndAt || "").trim(),
    plannedHours,
    runNo: String(runNo || "").trim(),
    scheduleId: String(scheduleId || "").trim(),
    startedAt: String(startedAt || "").trim(),
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

const completeLaboratoryExperiment = async ({
  completedAt = "",
  experimentCode,
  runNo = "",
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
        completedAt,
        runNo,
        trayCodes: Array.isArray(trayCodes) ? trayCodes : [],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

export { applyLaboratoryOperation, completeLaboratoryExperiment, startLaboratoryExperiment, withdrawCurrentLaboratoryExperiment };
