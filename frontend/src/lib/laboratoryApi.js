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

const applySaltResumePreparation = async ({
  experimentCode,
  fixtureInstallId = "",
  labCode = "LAB_SALT",
  occurredAt = "",
  operationType,
  pauseNo,
  runNo,
  taskCode,
  trayCodes = [],
}) => {
  const response = await fetch(buildApiUrl("/api/laboratory/salt-resume-preparation", API_BASE_URL), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "include",
    body: JSON.stringify({
      experimentCode: String(experimentCode || "").trim(),
      fixtureInstallId: String(fixtureInstallId || "").trim(),
      labCode: String(labCode || "").trim(),
      occurredAt: String(occurredAt || "").trim(),
      operationType: String(operationType || "").trim(),
      pauseNo: String(pauseNo || "").trim(),
      runNo: String(runNo || "").trim(),
      taskCode: String(taskCode || "").trim(),
      trayCodes: Array.isArray(trayCodes) ? trayCodes : [],
    }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
};

export {
  applyLaboratoryOperation,
  applySaltResumePreparation,
  withdrawCurrentLaboratoryExperiment,
};
