// 负责归档目录设置、任务输出进度、目录/分享操作与失败 PDF 重试。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import {
  listFailedTestDataExports,
  listTestDataTasks,
  openTestDataExperimentFolder,
  openTestDataTaskFolder,
  readTestDataSettings,
  retryFailedTestDataExports,
  selectTestDataDirectory,
  shareTestDataExperiment,
  shareTestDataTask,
  updateTestDataSettings,
} from "@/lib/testDataApi";
import { normalizeFailedExportList, normalizeTaskOutputList, normalizeTestDataSettings } from "./model";

const TASKS_PAGE_SIZE = 5;

function useDataPage() {
  const defaultPath = ref("");
  const savePath = ref("");
  const writable = ref(null);
  const settingsDetail = ref("");
  const settingsLoading = ref(true);
  const settingsSaving = ref(false);
  const settingsError = ref("");
  const settingsSuccess = ref("");
  const directorySelecting = ref(false);

  const taskOutputs = ref([]);
  const tasksLoading = ref(true);
  const tasksError = ref("");
  const tasksPage = ref(1);
  const tasksPageSize = ref(TASKS_PAGE_SIZE);
  const tasksQuery = ref("");
  const tasksTotal = ref(0);
  const expandedTaskCode = ref("");
  const taskActionSuccess = ref("");
  const taskActionError = ref("");
  const shareFallbackUrl = ref("");
  const openingExperimentKeys = ref(new Set());
  const sharingExperimentKeys = ref(new Set());
  let taskClickTimer = null;

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
  const tasksPageCount = computed(() => Math.max(1, Math.ceil(tasksTotal.value / tasksPageSize.value)));

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

  const loadTaskOutputs = async ({ page = tasksPage.value, query = tasksQuery.value } = {}) => {
    tasksLoading.value = true;
    tasksError.value = "";
    try {
      const result = normalizeTaskOutputList(await listTestDataTasks({
        page,
        pageSize: TASKS_PAGE_SIZE,
        query,
      }));
      taskOutputs.value = result.items.slice(0, TASKS_PAGE_SIZE);
      tasksPage.value = result.page;
      tasksPageSize.value = TASKS_PAGE_SIZE;
      tasksTotal.value = result.total;
      if (!taskOutputs.value.some((task) => task.taskCode === expandedTaskCode.value)) {
        expandedTaskCode.value = "";
      }
    } catch (error) {
      taskOutputs.value = [];
      tasksTotal.value = 0;
      tasksError.value = error?.message || "读取任务数据失败";
    } finally {
      tasksLoading.value = false;
    }
  };

  const browseDirectory = async () => {
    if (directorySelecting.value || settingsSaving.value) {
      return;
    }
    directorySelecting.value = true;
    settingsError.value = "";
    settingsSuccess.value = "";
    try {
      const result = await selectTestDataDirectory();
      if (!result?.cancelled && String(result?.savePath || "").trim()) {
        savePath.value = String(result.savePath).trim();
        settingsSuccess.value = "已选择目录，请点击“保存并检测目录”完成设置";
      }
    } catch (error) {
      settingsError.value = error?.message || "选择保存目录失败";
    } finally {
      directorySelecting.value = false;
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

  const experimentKey = (taskCode, experimentCode) => `${taskCode}:${experimentCode}`;
  const taskActionKey = (taskCode) => `${taskCode}:__task__`;
  const clearTaskClickTimer = () => {
    if (taskClickTimer !== null) {
      globalThis.clearTimeout(taskClickTimer);
      taskClickTimer = null;
    }
  };
  const isTaskExpanded = (taskCode) => expandedTaskCode.value === String(taskCode || "").trim();
  const toggleTaskExpansion = (taskCode) => {
    const normalized = String(taskCode || "").trim();
    expandedTaskCode.value = normalized && expandedTaskCode.value !== normalized ? normalized : "";
  };
  const handleTaskClick = (taskCode) => {
    const normalized = String(taskCode || "").trim();
    if (!normalized || !isTaskExpanded(normalized)) {
      return;
    }
    clearTaskClickTimer();
    taskClickTimer = globalThis.setTimeout(() => {
      if (isTaskExpanded(normalized)) {
        expandedTaskCode.value = "";
      }
      taskClickTimer = null;
    }, 220);
  };
  const handleTaskDoubleClick = (taskCode) => {
    clearTaskClickTimer();
    toggleTaskExpansion(taskCode);
  };
  const isOpeningExperiment = (taskCode, experimentCode) => openingExperimentKeys.value.has(experimentKey(taskCode, experimentCode));
  const isSharingExperiment = (taskCode, experimentCode) => sharingExperimentKeys.value.has(experimentKey(taskCode, experimentCode));
  const isOpeningTask = (taskCode) => openingExperimentKeys.value.has(taskActionKey(taskCode));
  const isSharingTask = (taskCode) => sharingExperimentKeys.value.has(taskActionKey(taskCode));

  const openTaskFolder = async (taskCode) => {
    const key = taskActionKey(taskCode);
    if (!taskCode || openingExperimentKeys.value.has(key)) {
      return;
    }
    taskActionError.value = "";
    taskActionSuccess.value = "";
    openingExperimentKeys.value = new Set([...openingExperimentKeys.value, key]);
    try {
      await openTestDataTaskFolder(taskCode);
      taskActionSuccess.value = `已在 MES 主机打开 ${taskCode} 的任务数据目录`;
    } catch (error) {
      taskActionError.value = error?.message || "打开任务数据目录失败";
    } finally {
      const nextKeys = new Set(openingExperimentKeys.value);
      nextKeys.delete(key);
      openingExperimentKeys.value = nextKeys;
    }
  };

  const copyTaskUrl = async (taskCode) => {
    const key = taskActionKey(taskCode);
    if (!taskCode || sharingExperimentKeys.value.has(key)) {
      return;
    }
    taskActionError.value = "";
    taskActionSuccess.value = "";
    shareFallbackUrl.value = "";
    sharingExperimentKeys.value = new Set([...sharingExperimentKeys.value, key]);
    try {
      const result = await shareTestDataTask(taskCode);
      const url = String(result?.url || "").trim();
      if (!url) {
        throw new Error("后端未返回可用的任务下载地址");
      }
      try {
        if (!globalThis.navigator?.clipboard?.writeText) {
          throw new Error("当前浏览器不支持自动复制");
        }
        await globalThis.navigator.clipboard.writeText(url);
        taskActionSuccess.value = "任务下载地址已复制到剪贴板";
      } catch {
        shareFallbackUrl.value = url;
        taskActionSuccess.value = "任务下载地址已生成，请从下方手动复制";
      }
    } catch (error) {
      taskActionError.value = error?.message || "生成任务下载地址失败";
    } finally {
      const nextKeys = new Set(sharingExperimentKeys.value);
      nextKeys.delete(key);
      sharingExperimentKeys.value = nextKeys;
    }
  };

  const openExperimentFolder = async (taskCode, experimentCode) => {
    const key = experimentKey(taskCode, experimentCode);
    if (!taskCode || !experimentCode || openingExperimentKeys.value.has(key)) {
      return;
    }
    taskActionError.value = "";
    taskActionSuccess.value = "";
    openingExperimentKeys.value = new Set([...openingExperimentKeys.value, key]);
    try {
      await openTestDataExperimentFolder(taskCode, experimentCode);
      taskActionSuccess.value = `已在 MES 主机打开 ${experimentCode} 的数据目录`;
    } catch (error) {
      taskActionError.value = error?.message || "打开试验数据目录失败";
    } finally {
      const nextKeys = new Set(openingExperimentKeys.value);
      nextKeys.delete(key);
      openingExperimentKeys.value = nextKeys;
    }
  };

  const copyExperimentUrl = async (taskCode, experimentCode) => {
    const key = experimentKey(taskCode, experimentCode);
    if (!taskCode || !experimentCode || sharingExperimentKeys.value.has(key)) {
      return;
    }
    taskActionError.value = "";
    taskActionSuccess.value = "";
    shareFallbackUrl.value = "";
    sharingExperimentKeys.value = new Set([...sharingExperimentKeys.value, key]);
    try {
      const result = await shareTestDataExperiment(taskCode, experimentCode);
      const url = String(result?.url || "").trim();
      if (!url) {
        throw new Error("后端未返回可用的下载地址");
      }
      try {
        if (!globalThis.navigator?.clipboard?.writeText) {
          throw new Error("当前浏览器不支持自动复制");
        }
        await globalThis.navigator.clipboard.writeText(url);
        taskActionSuccess.value = "局域网下载地址已复制到剪贴板";
      } catch {
        shareFallbackUrl.value = url;
        taskActionSuccess.value = "下载地址已生成，请从下方手动复制";
      }
    } catch (error) {
      taskActionError.value = error?.message || "生成下载地址失败";
    } finally {
      const nextKeys = new Set(sharingExperimentKeys.value);
      nextKeys.delete(key);
      sharingExperimentKeys.value = nextKeys;
    }
  };

  const searchTaskOutputs = () => {
    clearTaskClickTimer();
    expandedTaskCode.value = "";
    return loadTaskOutputs({ page: 1, query: tasksQuery.value });
  };
  const goToTaskPage = (page) => {
    const nextPage = Math.max(1, Math.min(tasksPageCount.value, Number(page) || 1));
    if (nextPage !== tasksPage.value) {
      clearTaskClickTimer();
      expandedTaskCode.value = "";
      return loadTaskOutputs({ page: nextPage, query: tasksQuery.value });
    }
    return Promise.resolve();
  };

  onMounted(() => {
    void Promise.all([loadSettings(), loadFailedExports(), loadTaskOutputs()]);
  });
  onBeforeUnmount(clearTaskClickTimer);

  return {
    browseDirectory,
    copyExperimentUrl,
    copyTaskUrl,
    defaultPath,
    directorySelecting,
    expandedTaskCode,
    exportsError,
    exportsLoading,
    failedCount,
    failedExports,
    goToTaskPage,
    handleTaskClick,
    handleTaskDoubleClick,
    isOpeningExperiment,
    isRetrying,
    isSharingExperiment,
    isOpeningTask,
    isSharingTask,
    isTaskExpanded,
    loadFailedExports,
    loadSettings,
    loadTaskOutputs,
    openExperimentFolder,
    openTaskFolder,
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
    searchTaskOutputs,
    shareFallbackUrl,
    taskActionError,
    taskActionSuccess,
    taskOutputs,
    tasksError,
    tasksLoading,
    tasksPage,
    tasksPageCount,
    tasksQuery,
    tasksTotal,
    toggleTaskExpansion,
    writable,
  };
}

export { useDataPage };
