// 负责读取、校验和保存试验数据归档目录，并提供失败 PDF 的重试入口。
import { computed, onMounted, ref } from "vue";

import {
  listFailedTestDataExports,
  readTestDataSettings,
  retryFailedTestDataExports,
  updateTestDataSettings,
} from "@/lib/testDataApi";
import { normalizeFailedExportList, normalizeTestDataSettings } from "./model";

function useDataPage() {
  const defaultPath = ref("");
  const savePath = ref("");
  const writable = ref(null);
  const settingsDetail = ref("");
  const settingsLoading = ref(true);
  const settingsSaving = ref(false);
  const settingsError = ref("");
  const settingsSuccess = ref("");

  const failedExports = ref([]);
  const failedCount = ref(0);
  const exportsLoading = ref(true);
  const exportsError = ref("");
  const retryingKeys = ref(new Set());
  const retryingAll = ref(false);

  const pathStatusLabel = computed(() => {
    if (settingsLoading.value || settingsSaving.value) {
      return "正在检测";
    }
    return writable.value ? "目录可写" : "目录不可写";
  });
  const pathStatusClass = computed(() => ({
    "is-checking": settingsLoading.value || settingsSaving.value,
    "is-error": !settingsLoading.value && !settingsSaving.value && writable.value !== true,
    "is-writable": !settingsLoading.value && !settingsSaving.value && writable.value === true,
  }));

  const applySettings = (payload) => {
    const settings = normalizeTestDataSettings(payload);
    defaultPath.value = settings.defaultPath;
    savePath.value = settings.savePath || settings.defaultPath;
    settingsDetail.value = settings.detail;
    writable.value = settings.writable;
  };

  const loadSettings = async () => {
    settingsLoading.value = true;
    settingsError.value = "";
    try {
      applySettings(await readTestDataSettings());
      if (writable.value !== true) {
        settingsError.value = settingsDetail.value || "当前保存地址不可写，请修改后重新检测";
      }
    } catch (error) {
      writable.value = false;
      settingsError.value = error?.message || "读取保存地址失败";
    } finally {
      settingsLoading.value = false;
    }
  };

  const loadFailedExports = async () => {
    exportsLoading.value = true;
    exportsError.value = "";
    try {
      const result = normalizeFailedExportList(await listFailedTestDataExports());
      failedExports.value = result.items;
      failedCount.value = result.failedCount;
    } catch (error) {
      failedExports.value = [];
      failedCount.value = 0;
      exportsError.value = error?.message || "读取 PDF 失败记录失败";
    } finally {
      exportsLoading.value = false;
    }
  };

  const saveSettings = async () => {
    const nextPath = String(savePath.value || "").trim();
    settingsError.value = "";
    settingsSuccess.value = "";
    if (!nextPath) {
      writable.value = false;
      settingsError.value = "请输入试验数据保存地址";
      return;
    }
    settingsSaving.value = true;
    try {
      applySettings(await updateTestDataSettings(nextPath));
      settingsSuccess.value = settingsDetail.value || "保存地址已更新，目录可正常写入";
    } catch (error) {
      writable.value = false;
      settingsError.value = error?.message || "保存地址检测失败";
    } finally {
      settingsSaving.value = false;
    }
  };

  const isRetrying = (exportKey) => retryingKeys.value.has(exportKey);

  const retryFailed = async (exportKey) => {
    if (!exportKey || isRetrying(exportKey)) {
      return;
    }
    exportsError.value = "";
    retryingKeys.value = new Set([...retryingKeys.value, exportKey]);
    try {
      await retryFailedTestDataExports([exportKey]);
      await loadFailedExports();
    } catch (error) {
      exportsError.value = error?.message || "重新生成 PDF 失败";
    } finally {
      const nextKeys = new Set(retryingKeys.value);
      nextKeys.delete(exportKey);
      retryingKeys.value = nextKeys;
    }
  };

  const retryAllFailed = async () => {
    if (retryingAll.value || !failedExports.value.length) {
      return;
    }
    exportsError.value = "";
    retryingAll.value = true;
    try {
      await retryFailedTestDataExports();
      await loadFailedExports();
    } catch (error) {
      exportsError.value = error?.message || "批量重新生成 PDF 失败";
    } finally {
      retryingAll.value = false;
    }
  };

  onMounted(() => {
    void Promise.all([loadSettings(), loadFailedExports()]);
  });

  return {
    defaultPath,
    exportsError,
    exportsLoading,
    failedCount,
    failedExports,
    isRetrying,
    loadFailedExports,
    loadSettings,
    pathStatusClass,
    pathStatusLabel,
    retryAllFailed,
    retryFailed,
    retryingAll,
    savePath,
    saveSettings,
    settingsError,
    settingsLoading,
    settingsSaving,
    settingsSuccess,
    writable,
  };
}

export { useDataPage };
