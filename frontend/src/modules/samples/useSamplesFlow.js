// 负责样品流转页的筛选、批量接样、详情编辑和暂存派发流程。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import { SAMPLES_UPDATED_EVENT } from "./sampleEvents";
import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { formatLocalDateTime } from "@/lib/dateTime.js";
import { serverNowDate } from "@/lib/serverClock.js";
import { readTasks, updateTask as updateTaskByApi } from "@/lib/tasksApi";
import {
  DETAIL_STATUS_OPTIONS,
  buildTrayFlowView,
  buildSamplesFlowView,
  buildSamplesTrayOverviewView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  getSampleTrayList,
  normalizeSamplesSnapshot,
  submitSamplesBatchIntake,
  TRAY_STATUS_OPTIONS,
  updateTrayStatus,
  updateSampleDetail,
} from "./samplesFlowModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const DEFAULT_LABELS = {
  intakeLocation: "\u63A5\u9A73\u533A",
  unpackingLocation: "\u62C6\u7BB1\u64CD\u4F5C\u95F4",
  preRetentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u6682\u5B58\u95F4\uFF09",
  retentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u6682\u5B58\u95F4\uFF09",
  postRetentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4\uFF09",
  sampleReceived: "\u5DF2\u63A5\u6536",
  sampleTesting: "\u8BD5\u9A8C\u4E2D",
  sampleStored: "\u5230\u8D27",
};

const DEFAULT_LOCATION_OPTIONS = [
  "\u63A5\u9A73\u533A",
  "\u62C6\u7BB1\u64CD\u4F5C\u95F4",
  "\u51B2\u51FB\u4E00\u5BA4",
  "\u51B2\u51FB\u4E8C\u5BA4",
  "\u632F\u52A8\u4E00\u5BA4",
  "\u632F\u52A8\u4E8C\u5BA4",
  "\u56DB\u7EFC\u5408\u5B9E\u9A8C\u5BA4",
  "\u6E29\u5EA6\u51B2\u51FB\u4E00\u5BA4",
  "\u6E29\u5EA6\u51B2\u51FB\u4E8C\u5BA4",
  "\u9AD8\u4F4E\u6E29\u6E7F\u70ED\u4E00\u5BA4",
  "\u76D0\u96FE\u8BD5\u9A8C\u5BA4",
  "\u9709\u83CC\u8BD5\u9A8C\u5BA4",
  "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u6682\u5B58\u95F4\uFF09",
  "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4\uFF09",
];
const parseCodeList = (value) =>
  Array.from(
    new Set(
      String(value ?? "")
        .split(/[\s,\uFF0C;\uFF1B]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

// 输出样品流转表格和暂存派发动作所需的响应式状态。
function useSamplesFlow() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.samples,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_runs,
    STORAGE_KEYS.experiment_run_steps,
    STORAGE_KEYS.experiment_run_trays,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.schedules,
  ]);

  const rawTasks = ref([]);
  const rawSamples = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentRuns = ref([]);
  const rawExperimentRunSteps = ref([]);
  const rawExperimentRunTrays = ref([]);
  const rawExperimentTrays = ref([]);
  const rawSchedules = ref([]);
  const loading = ref(false);
  const warning = ref("");

  const query = ref("");
  const selectedTaskCode = ref("");
  const selectedStatus = ref("");
  const sortKey = ref("");
  const sortDirection = ref("asc");
  const currentPage = ref(1);
  const pageSize = 8;
  const stagingQuery = ref("");
  const stagingSelectedTaskCode = ref("");
  const stagingSelectedStatus = ref("");
  const stagingCurrentPage = ref(1);
  const stagingSelectedCodes = ref([]);

  const batchModal = useDialogState();
  const detailDrawer = useDialogState();
  let flushPendingStorageRefresh = () => false;
  let hasPendingSamplesRefresh = false;

  const batchForm = reactive({
    location: DEFAULT_LABELS.intakeLocation,
    owner: "",
    codes: "",
  });

  const detailForm = reactive({
    code: "",
    status: "",
    remark: "",
  });

  const stagingForm = reactive({
    codes: "",
    targetLab: "",
    owner: "",
  });

  const view = computed(() =>
    buildSamplesFlowView({
      samples: rawSamples.value,
      tasks: rawTasks.value,
      filters: {
        query: query.value,
        taskCode: selectedTaskCode.value,
        status: selectedStatus.value,
      },
      sort: {
        key: sortKey.value,
        direction: sortDirection.value,
      },
      page: currentPage.value,
      pageSize,
    }),
  );

  // 暂存区派发面板与主列表共享一份样品快照，但筛选口径不同。
  const sampleRows = computed(() => view.value.rows);
  const trayOverviewView = computed(() =>
    buildSamplesTrayOverviewView({
      tasks: rawTasks.value,
      samples: rawSamples.value,
    }),
  );
  const trayRows = computed(() => trayOverviewView.value.rows);
  const pageCount = computed(() => view.value.totalPages);
  const taskOptions = computed(() => view.value.taskOptions);
  const statusOptions = computed(() => view.value.statusOptions);
  const stagingView = computed(() =>
    buildSamplesStagingView({
      labels: DEFAULT_LABELS,
      filters: {
        query: stagingQuery.value,
        taskCode: stagingSelectedTaskCode.value,
        status: stagingSelectedStatus.value,
      },
      page: stagingCurrentPage.value,
      pageSize,
      samples: rawSamples.value,
      selectedCodes: stagingSelectedCodes.value,
    }),
  );
  const stagingRows = computed(() => stagingView.value.rows);
  const stagingCount = computed(() => stagingView.value.count);
  const stagingPageCount = computed(() => stagingView.value.totalPages);
  const stagingTaskOptions = computed(() => stagingView.value.taskOptions);
  const stagingStatusOptions = computed(() => stagingView.value.statusOptions);
  const stagingLabOptions = computed(() => stagingView.value.labOptions);
  const detailSample = computed(() => detailDrawer.payload.value || null);
  const detailSampleTray = computed(() => getSampleTrayList(detailSample.value)[0] || null);
  const detailSampleTrayCode = computed(() => String(detailSampleTray.value?.tray_code || "").trim());
  const detailSampleTaskCode = computed(() => String(detailSample.value?.task_code || "").trim());
  const detailSampleTrayRow = computed(() =>
    trayRows.value.find((row) =>
      String(row?.trayCode || "").trim() === detailSampleTrayCode.value
      && String(row?.taskCode || "").trim() === detailSampleTaskCode.value,
    ) || null,
  );
  const detailSampleTrayFlow = computed(() => {
    const trayCode = detailSampleTrayCode.value;
    const sample = detailSample.value;
    if (!sample || !trayCode) {
      return {
        currentStatus: "当前样品未绑定托盘",
        steps: [],
      };
    }
    const trayRow = detailSampleTrayRow.value;
    const status = String(trayRow?.status || detailSampleTray.value?.status || "").trim();
    return buildTrayFlowView({
      experimentRuns: rawExperimentRuns.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      experimentRunTrays: rawExperimentRunTrays.value,
      experimentTrays: rawExperimentTrays.value,
      experiments: rawExperiments.value,
      location: status === "已到达暂存间" ? DEFAULT_LABELS.preRetentionLocation : "",
      samples: rawSamples.value,
      schedules: rawSchedules.value,
      taskCode: String(trayRow?.taskCode || detailSampleTaskCode.value || "").trim(),
      trayCode,
      status,
    });
  });
  const stagingAllSelected = computed(
    () => stagingRows.value.length > 0 && stagingRows.value.every((row) => row.selected),
  );
  const locationOptions = computed(() =>
    Array.from(
      new Set([
        ...DEFAULT_LOCATION_OPTIONS,
        ...rawSamples.value.map((sample) => String(sample?.location ?? "").trim()),
      ]),
    )
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "zh-Hans-CN")),
  );

  const buildFailureMessage = (prefix, error) => {
    const detail = String(error instanceof Error ? error.message : "").trim();
    return detail ? `${prefix}，${detail}` : prefix;
  };

  const clearWarning = () => {
    warning.value = "";
  };

  const selectArraySnapshot = (value, currentValue, preserveExisting, transform = (items) => items) => {
    if (Array.isArray(value)) {
      return transform(value);
    }
    return preserveExisting ? currentValue : [];
  };

  const load = async ({ silent = false } = {}) => {
    // 托盘流程需要同时读取实验、排程和运行记录，保持中控与试验间/可视化口径一致。
    const showBlockingLoading = !silent || (rawTasks.value.length === 0 && rawSamples.value.length === 0);
    if (showBlockingLoading) {
      loading.value = true;
    }
    try {
      const [tasks, snapshot] = await Promise.all([readTasks(), loadSnapshot()]);
      const preserveExisting = Boolean(silent);
      rawTasks.value = selectArraySnapshot(tasks, rawTasks.value, preserveExisting);
      rawSamples.value = selectArraySnapshot(
        snapshot?.[STORAGE_KEYS.samples],
        rawSamples.value,
        preserveExisting,
        (items) => normalizeSamplesSnapshot(items, DEFAULT_LABELS),
      );
      rawExperiments.value = selectArraySnapshot(snapshot?.[STORAGE_KEYS.experiments], rawExperiments.value, preserveExisting);
      rawExperimentRuns.value = selectArraySnapshot(snapshot?.[STORAGE_KEYS.experiment_runs], rawExperimentRuns.value, preserveExisting);
      rawExperimentRunSteps.value = selectArraySnapshot(
        snapshot?.[STORAGE_KEYS.experiment_run_steps],
        rawExperimentRunSteps.value,
        preserveExisting,
      );
      rawExperimentRunTrays.value = selectArraySnapshot(
        snapshot?.[STORAGE_KEYS.experiment_run_trays],
        rawExperimentRunTrays.value,
        preserveExisting,
      );
      rawExperimentTrays.value = selectArraySnapshot(
        snapshot?.[STORAGE_KEYS.experiment_trays],
        rawExperimentTrays.value,
        preserveExisting,
      );
      rawSchedules.value = selectArraySnapshot(snapshot?.[STORAGE_KEYS.schedules], rawSchedules.value, preserveExisting);
      warning.value = "";
    } catch (error) {
      warning.value = buildFailureMessage("样品数据加载失败，请稍后重试", error);
    } finally {
      if (showBlockingLoading) {
        loading.value = false;
      }
    }
  };

  const refreshRealtime = () => load({ silent: true });

  const resetPage = () => {
    currentPage.value = 1;
  };

  const setQuery = (value) => {
    query.value = String(value ?? "");
    resetPage();
  };

  const setTaskFilter = (value) => {
    selectedTaskCode.value = String(value ?? "");
    resetPage();
  };

  const setStatusFilter = (value) => {
    selectedStatus.value = String(value ?? "");
    resetPage();
  };

  const toggleSort = (key) => {
    const nextKey = String(key ?? "").trim();
    if (!nextKey) {
      return;
    }
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    } else {
      sortKey.value = nextKey;
      sortDirection.value = "asc";
    }
    resetPage();
  };

  const setPage = (page) => {
    const nextPage = Number.parseInt(String(page ?? ""), 10);
    if (!Number.isFinite(nextPage)) {
      return;
    }
    currentPage.value = Math.min(Math.max(nextPage, 1), pageCount.value);
  };

  const setStagingQuery = (value) => {
    stagingQuery.value = String(value ?? "");
    stagingCurrentPage.value = 1;
  };

  const setStagingTaskFilter = (value) => {
    stagingSelectedTaskCode.value = String(value ?? "");
    stagingCurrentPage.value = 1;
  };

  const setStagingStatusFilter = (value) => {
    stagingSelectedStatus.value = String(value ?? "");
    stagingCurrentPage.value = 1;
  };

  const setStagingPage = (page) => {
    const nextPage = Number.parseInt(String(page ?? ""), 10);
    if (!Number.isFinite(nextPage)) {
      return;
    }
    stagingCurrentPage.value = Math.min(Math.max(nextPage, 1), stagingPageCount.value);
  };

  const resetStaging = () => {
    // 重置暂存派发表单时，同时清空勾选集合和提示文案。
    stagingForm.codes = "";
    stagingForm.targetLab = "";
    stagingForm.owner = "";
    stagingSelectedCodes.value = [];
    warning.value = "";
  };

  const clearStagingInputs = () => {
    stagingForm.codes = "";
    stagingForm.targetLab = "";
    stagingForm.owner = "";
    stagingSelectedCodes.value = [];
  };

  const toggleStagingSelection = (code, checked) => {
    const normalized = String(code ?? "").trim();
    if (!normalized) {
      return;
    }
    const selected = new Set(stagingSelectedCodes.value);
    if (checked) {
      selected.add(normalized);
    } else {
      selected.delete(normalized);
    }
    stagingSelectedCodes.value = Array.from(selected);
  };

  const toggleAllStagingSelection = (checked) => {
    stagingSelectedCodes.value = checked ? stagingRows.value.map((row) => String(row.code ?? "").trim()).filter(Boolean) : [];
  };

  const submitStagingDispatch = async () => {
    const result = dispatchStagingSamples({
      labels: DEFAULT_LABELS,
      now: formatLocalDateTime(),
      payload: stagingForm,
      samples: rawSamples.value,
      selectedCodes: stagingSelectedCodes.value,
    });

    if (result.error && result.dispatchedCodes.length === 0) {
      // 全部失败时保留表单输入，方便用户修正后重试。
      warning.value = result.error;
      return;
    }

    rawSamples.value = result.samples;
    await persistSnapshot({
      [STORAGE_KEYS.samples]: result.samples,
    });
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));

    clearStagingInputs();
    warning.value = result.error;
  };

  const openBatchModal = () => {
    batchForm.location = DEFAULT_LABELS.intakeLocation;
    batchForm.owner = "";
    batchForm.codes = "";
    warning.value = "";
    batchModal.openWith(true);
  };

  const closeBatchModal = () => {
    batchModal.close();
    flushPendingRealtimeRefresh();
  };

  const submitBatch = async () => {
    const now = serverNowDate();
    const nowIso = formatLocalDateTime(now);
    const arrivalTime = formatLocalDateTime(now);
    const result = submitSamplesBatchIntake({
      samples: rawSamples.value,
      payload: batchForm,
      labels: DEFAULT_LABELS,
      now: nowIso,
    });
    if (result.error) {
      warning.value = result.error;
      return;
    }
    const affectedTaskCodes = Array.from(
      new Set(
        result.samples
          .filter((sample) => parseCodeList(batchForm.codes).includes(String(sample?.code ?? "").trim()))
          .map((sample) => String(sample?.task_code ?? "").trim())
          .filter(Boolean),
      ),
    );
    const nextTasks = rawTasks.value.map((task) => ({ ...task }));
    for (const taskCode of affectedTaskCodes) {
      const task = nextTasks.find((item) => String(item?.code ?? "").trim() === taskCode);
      if (!task) {
        continue;
      }
      task.arrival_at = arrivalTime;
      task.updated_at = nowIso;
      await updateTaskByApi(task.id || task.code, task);
    }
    // 批量接样成功后关闭弹窗，但不额外广播事件，因为当前页已持有最新数据。
    rawTasks.value = await readTasks();
    rawSamples.value = result.samples;
    await persistSnapshot({
      [STORAGE_KEYS.samples]: result.samples,
    });
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    warning.value = "";
    batchModal.close();
    flushPendingRealtimeRefresh();
  };

  const openDetailDrawer = (sampleId) => {
    const selected = rawSamples.value.find((sample) => String(sample?.id ?? sample?.code) === String(sampleId));
    if (!selected) {
      return;
    }
    // 明细抽屉默认展示当前样品状态，备注从空白开始录入。
    detailForm.code = selected.code || "";
    detailForm.status = selected.status || "\u5230\u8D27";
    detailForm.remark = "";
    detailDrawer.openWith(selected);
    warning.value = "";
  };

  const closeDetailDrawer = () => {
    detailDrawer.close();
    flushPendingRealtimeRefresh();
  };

  const saveDetail = async () => {
    const currentSample = detailDrawer.payload.value;
    if (!currentSample) {
      return;
    }
    const result = updateSampleDetail({
      sample: currentSample,
      payload: {
        status: detailForm.status,
        remark: detailForm.remark,
      },
      labels: DEFAULT_LABELS,
      now: formatLocalDateTime(),
    });
    if (result.error) {
      warning.value = result.error;
      return;
    }

    // 明细保存采用按 id/code 替换单条记录的方式更新本地列表。
    rawSamples.value = rawSamples.value.map((sample) =>
      String(sample?.id ?? sample?.code) === String(currentSample.id ?? currentSample.code) ? result.sample : sample,
    );
    await persistSnapshot({
      [STORAGE_KEYS.samples]: rawSamples.value,
    });
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    warning.value = "";
    detailDrawer.close();
    flushPendingRealtimeRefresh();
  };

  const updateTrayStatusInline = async (trayCode, status) => {
    const result = updateTrayStatus({
      trayCode,
      status,
      labels: DEFAULT_LABELS,
      now: formatLocalDateTime(),
      samples: rawSamples.value,
    });
    if (result.error) {
      warning.value = result.error;
      return;
    }
    rawSamples.value = result.samples;
    await persistSnapshot({
      [STORAGE_KEYS.samples]: result.samples,
    });
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    warning.value = "";
  };

  watch(
    () => view.value.currentPage,
    (nextPage) => {
      if (currentPage.value !== nextPage) {
        currentPage.value = nextPage;
      }
    },
  );

  watch(
    stagingRows,
    (rows) => {
      // 筛选变化后自动剔除已不在当前结果集里的勾选项。
      const valid = new Set(rows.map((row) => String(row.code ?? "").trim()).filter(Boolean));
      const nextSelected = stagingSelectedCodes.value.filter((code) => valid.has(String(code ?? "").trim()));
      const changed =
        nextSelected.length !== stagingSelectedCodes.value.length ||
        nextSelected.some((code, index) => code !== stagingSelectedCodes.value[index]);
      if (changed) {
        stagingSelectedCodes.value = nextSelected;
      }
    },
    { deep: true },
  );

  const isRealtimeRefreshPaused = () => Boolean(batchModal.open.value || detailDrawer.open.value);

  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = flushPendingStorageRefresh();
    if (!hasPendingSamplesRefresh || isRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void refreshRealtime();
    }
    return true;
  };

  const handleSamplesUpdated = (event) => {
    if (isRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    storageRefresh.requestRefresh({
      ...(event?.detail || {}),
      keys: [STORAGE_KEYS.samples],
      immediate: true,
    });
  };

  const storageRefresh = useStorageSnapshotRefresh({
    keys: [
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.experiment_runs,
      STORAGE_KEYS.experiment_run_steps,
      STORAGE_KEYS.experiment_run_trays,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.schedules,
    ],
    refresh: refreshRealtime,
    paused: isRealtimeRefreshPaused,
  });
  flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

  onMounted(() => {
    void load();
    // 与收样页通过全局事件同步，保持不同子视图间的数据一致。
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  onBeforeUnmount(() => {
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  return {
    batchForm,
    batchModalOpen: batchModal.open,
    clearWarning,
    closeBatchModal,
    closeDetailDrawer,
    currentPage,
    detailDrawerOpen: detailDrawer.open,
    detailForm,
    detailSample,
    detailSampleTrayCode,
    detailSampleTrayFlow,
    detailStatusOptions: DETAIL_STATUS_OPTIONS,
    loading,
    locationOptions,
    openBatchModal,
    openDetailDrawer,
    pageCount,
    query,
    rawSamples,
    rawExperiments,
    rawExperimentRuns,
    rawExperimentRunSteps,
    rawExperimentRunTrays,
    rawExperimentTrays,
    rawSchedules,
    rawTasks,
    sampleRows,
    saveDetail,
    selectedStatus,
    selectedTaskCode,
    setPage,
    setQuery,
    setStatusFilter,
    setStagingPage,
    setStagingQuery,
    setStagingStatusFilter,
    setStagingTaskFilter,
    setTaskFilter,
    trayRows,
    trayStatusOptions: TRAY_STATUS_OPTIONS,
    stagingAllSelected,
    stagingCount,
    stagingCurrentPage,
    stagingForm,
    stagingLabOptions,
    stagingPageCount,
    stagingQuery,
    stagingRows,
    stagingSelectedCodes,
    stagingSelectedStatus,
    stagingSelectedTaskCode,
    stagingStatusOptions,
    stagingTaskOptions,
    sortDirection,
    sortKey,
    statusOptions,
    submitStagingDispatch,
    submitBatch,
    taskOptions,
    toggleAllStagingSelection,
    toggleStagingSelection,
    toggleSort,
    updateTrayStatusInline,
    warning,
    resetStaging,
  };
}

export { useSamplesFlow };
