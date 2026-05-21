import { reactive } from "vue";

import { useFeedback } from "@/composables/useFeedback";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";

const API_BASE_URL = getFrontendApiBaseUrl();

const normalizeText = (value) => String(value || "").trim();

const readErrorMessage = async (response) => {
  const payload = await response.json().catch(() => null);
  return payload?.detail || payload?.message || `请求失败（${response.status}）`;
};

function useTrayErrorSampleHandling(options = {}) {
  const feedbackState = useFeedback();
  const state = reactive({
    open: false,
    scanCode: "",
    loading: false,
    submitting: false,
    tray: null,
    destinations: [],
  });

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

  const fetchWithdrawDispatch = async (trayCode, reason = "") => {
    const response = await fetch(buildApiUrl(`/api/transfer-area/trays/${encodeURIComponent(trayCode)}/withdraw-dispatch`, API_BASE_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ reason }),
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

  const reset = () => {
    state.scanCode = "";
    state.loading = false;
    state.submitting = false;
    state.tray = null;
    state.destinations = [];
    feedbackState.clear();
  };

  const open = () => {
    reset();
    state.open = true;
  };

  const notifyChanged = async (payload, reason) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, { detail: { source: "tray-error-sample", reason } }));
    }
    if (typeof options.onChanged === "function") {
      await options.onChanged(payload, reason);
    }
  };

  const close = async () => {
    state.open = false;
    reset();
    if (typeof options.onClose === "function") {
      await options.onClose();
    }
  };

  const lookupTray = async () => {
    const trayCode = normalizeText(state.scanCode);
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

  const withdrawDispatch = async () => {
    const trayCode = normalizeText(state.tray?.trayNo || state.scanCode);
    if (!trayCode) {
      feedbackState.show("请先查询托盘。", "warning");
      return false;
    }
    if (state.submitting) {
      return false;
    }

    state.submitting = true;
    try {
      const payload = await fetchWithdrawDispatch(trayCode, "");
      applyDispatchPayload(payload, state.destinations);
      feedbackState.show(normalizeText(payload?.message) || "托盘撤回出库成功。", "success");
      const refreshedPayload = await fetchTrayDispatch(trayCode);
      applyDispatchPayload(refreshedPayload, state.destinations);
      state.scanCode = "";
      await notifyChanged(refreshedPayload, "withdraw-dispatch");
      return true;
    } catch (error) {
      feedbackState.show(error instanceof Error ? error.message : "托盘撤回失败，请重试。", "error");
      return false;
    } finally {
      state.submitting = false;
    }
  };

  return {
    close,
    clearFeedback: feedbackState.clear,
    feedbackMessage: feedbackState.message,
    feedbackTone: feedbackState.tone,
    lookupTray,
    open,
    reset,
    state,
    withdrawDispatch,
  };
}

export { useTrayErrorSampleHandling };
