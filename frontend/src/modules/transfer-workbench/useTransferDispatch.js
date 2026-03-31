import { reactive } from "vue";

import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";

const API_BASE_URL = getFrontendApiBaseUrl();

const normalizeText = (value) => String(value || "").trim();

const readErrorMessage = async (response) => {
  const payload = await response.json().catch(() => null);
  return payload?.detail || payload?.message || `请求失败（${response.status}）`;
};

function useTransferDispatch() {
  const state = reactive({
    scanCode: "",
    loading: false,
    submitting: false,
    tray: null,
    destinations: [],
    feedback: "",
  });

  const lookupTray = async () => {
    const trayCode = normalizeText(state.scanCode);
    if (!trayCode) {
      state.feedback = "请输入或扫描托盘编号。";
      return;
    }

    state.loading = true;
    try {
      const response = await fetch(buildApiUrl(`/api/transfer-area/trays/${encodeURIComponent(trayCode)}/dispatch`, API_BASE_URL), {
        headers: {
          Accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      const payload = await response.json();
      state.tray = payload?.tray || null;
      state.destinations = Array.isArray(payload?.destinations) ? payload.destinations : [];
      state.feedback = "";
    } catch (error) {
      state.tray = null;
      state.destinations = [];
      state.feedback = error instanceof Error ? error.message : "托盘查询失败，请重试。";
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
    const trayCode = normalizeText(state.tray?.trayNo || state.scanCode);
    if (!trayCode) {
      state.feedback = "请先扫描托盘编号。";
      return;
    }
    if (!canSelectDestination(destination)) {
      state.feedback = "当前候选位置尚未排程，不能直接出库。";
      return;
    }

    state.submitting = true;
    try {
      const response = await fetch(buildApiUrl(`/api/transfer-area/trays/${encodeURIComponent(trayCode)}/dispatch`, API_BASE_URL), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
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
      state.tray = payload?.tray || state.tray;
      state.destinations = Array.isArray(payload?.destinations) ? payload.destinations : state.destinations;
      state.feedback = normalizeText(payload?.message) || "托盘出库状态已更新。";
    } catch (error) {
      state.feedback = error instanceof Error ? error.message : "托盘出库失败，请重试。";
    } finally {
      state.submitting = false;
    }
  };

  return {
    canSelectDestination,
    lookupTray,
    state,
    submitDestination,
  };
}

export { useTransferDispatch };
