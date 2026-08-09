import { reactive } from "vue";

import { useFeedback } from "@/composables/useFeedback";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { normalizeTrayScanCode } from "@/lib/trayQrCode";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

const API_BASE_URL = getFrontendApiBaseUrl();

const normalizeText = (value) => String(value || "").trim();

const parseScheduleTime = (destination) => {
  const value = destination?.scheduleStartAt ?? destination?.schedule_start_at;
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
};

const resolveStrictDispatchDestinations = (destinations) => {
  const candidates = Array.isArray(destinations) ? destinations : [];
  const stagingDestinations = candidates.filter((destination) => normalizeText(destination?.targetType) === "staging");
  const nextScheduledLab = candidates
    .filter((destination) => normalizeText(destination?.targetType) !== "staging" && Boolean(destination?.scheduled))
    .sort((left, right) => {
      const timeDifference = parseScheduleTime(left) - parseScheduleTime(right);
      if (timeDifference) {
        return timeDifference;
      }
      return normalizeText(left?.scheduleId || left?.schedule_id).localeCompare(
        normalizeText(right?.scheduleId || right?.schedule_id),
      );
    })[0];

  return [
    ...stagingDestinations,
    ...(nextScheduledLab ? [{ ...nextScheduledLab, preferred: true }] : []),
  ];
};

const readErrorMessage = async (response) => {
  const payload = await response.json().catch(() => null);
  return payload?.detail || payload?.message || `请求失败（${response.status}）`;
};

function useTransferDispatch(options = {}) {
  const feedbackState = useFeedback();
  const state = reactive({
    scanCode: "",
    loading: false,
    submitting: false,
    tray: null,
    destinations: [],
  });
  const createStorageUpdateMeta = typeof options.createStorageUpdateMeta === "function"
    ? options.createStorageUpdateMeta
    : () => ({});

  const fetchTrayDispatch = async (trayCode) => {
    const response = await fetch(buildApiUrl(`/api/transfer-area/trays/${encodeURIComponent(trayCode)}/dispatch`, API_BASE_URL), {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    return response.json();
  };

  const applyDispatchPayload = (payload, fallbackDestinations = []) => {
    state.tray = payload?.tray || null;
    state.destinations = resolveStrictDispatchDestinations(
      Array.isArray(payload?.destinations) ? payload.destinations : fallbackDestinations,
    );
  };

  const resetDispatch = () => {
    state.scanCode = "";
    state.loading = false;
    state.submitting = false;
    state.tray = null;
    state.destinations = [];
    feedbackState.clear();
  };

  const updateScanCode = (value) => {
    state.scanCode = normalizeTrayScanCode(value);
  };

  const lookupTray = async () => {
    const trayCode = normalizeTrayScanCode(state.scanCode);
    if (!trayCode) {
      feedbackState.show("请输入或扫描托盘编号。", "warning");
      return false;
    }
    state.scanCode = trayCode;

    state.loading = true;
    try {
      const payload = await fetchTrayDispatch(trayCode);
      applyDispatchPayload(payload);
      state.scanCode = "";
      feedbackState.clear();
      return true;
    } catch (error) {
      state.tray = null;
      state.destinations = [];
      state.scanCode = "";
      feedbackState.show(error instanceof Error ? error.message : "托盘查询失败，请重试。", "error");
      return false;
    } finally {
      state.loading = false;
    }
  };

  const canSelectDestination = (destination) => {
    if (!destination || state.submitting) {
      return false;
    }
    return destination.targetType === "staging" || Boolean(destination.scheduled);
  };

  const submitDestination = async (destination) => {
    const trayCode = normalizeTrayScanCode(state.tray?.trayNo || state.scanCode);
    if (!trayCode) {
      feedbackState.show("请先扫描托盘编号。", "warning");
      return false;
    }
    if (!canSelectDestination(destination)) {
      feedbackState.show("该目标不是当前排程顺序中的下一实验，请刷新后重试。", "warning");
      return false;
    }

    state.submitting = true;
    const storageUpdateMeta = createStorageUpdateMeta("dispatch");
    try {
      const response = await fetch(buildApiUrl(`/api/transfer-area/trays/${encodeURIComponent(trayCode)}/dispatch`, API_BASE_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(storageUpdateMeta.source ? { "X-MES-Update-Source": storageUpdateMeta.source } : {}),
          ...(storageUpdateMeta.requestId ? { "X-MES-Update-Request-Id": storageUpdateMeta.requestId } : {}),
        },
        body: JSON.stringify({
          targetType: destination.targetType,
          targetName: destination.targetName,
          experimentCode: destination.experimentCode || "",
          scheduleId: destination.scheduleId || destination.schedule_id || "",
          subExperimentCode: destination.subExperimentCode || destination.sub_experiment_code || "",
          axisBatchNo: destination.axisBatchNo || destination.axis_batch_no || "",
        }),
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const payload = await response.json();
      applyDispatchPayload(payload, state.destinations);
      feedbackState.show(normalizeText(payload?.message) || "托盘出库状态已更新。", "success");
      state.scanCode = "";
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, {
        detail: { source: "transfer-workbench", reason: "dispatch", requestId: storageUpdateMeta.requestId || "" },
      }));
      return true;
    } catch (error) {
      feedbackState.show(error instanceof Error ? error.message : "托盘出库失败，请重试。", "error");
      return false;
    } finally {
      state.submitting = false;
    }
  };

  return {
    canSelectDestination,
    clearFeedback: feedbackState.clear,
    feedbackMessage: feedbackState.message,
    feedbackTone: feedbackState.tone,
    lookupTray,
    resetDispatch,
    state,
    submitDestination,
    updateScanCode,
  };
}

export { resolveStrictDispatchDestinations, useTransferDispatch };
