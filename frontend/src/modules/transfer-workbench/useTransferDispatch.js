import { reactive } from "vue";

import { useFeedback } from "@/composables/useFeedback";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { normalizeTrayScanCode } from "@/lib/trayQrCode";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

const API_BASE_URL = getFrontendApiBaseUrl();

const normalizeText = (value) => String(value || "").trim();

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
    state.destinations = Array.isArray(payload?.destinations) ? payload.destinations : fallbackDestinations;
  };

  const resetDispatch = () => {
    state.scanCode = "";
    state.loading = false;
    state.submitting = false;
    state.tray = null;
    state.destinations = [];
    feedbackState.clear();
  };

  const lookupTray = async () => {
    const trayCode = normalizeTrayScanCode(state.scanCode);
    if (!trayCode) {
      feedbackState.show("请输入或扫描托盘编号。", "warning");
      return false;
    }

    state.loading = true;
    try {
      const payload = await fetchTrayDispatch(trayCode);
      applyDispatchPayload(payload);
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
      feedbackState.show("当前候选位置尚未排程，不能直接出库。", "warning");
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
  };
}

export { useTransferDispatch };
