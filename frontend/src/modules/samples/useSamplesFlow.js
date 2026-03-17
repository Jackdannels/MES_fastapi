// 负责样品流转页的筛选、批量接样、详情编辑和暂存派发流程。
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import { SAMPLES_UPDATED_EVENT } from "./useSampleIntake";
import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import {
  DETAIL_STATUS_OPTIONS,
  buildSamplesFlowView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  submitSamplesBatchIntake,
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
  sampleStored: "\u5DF2\u5165\u5E93",
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

// 输出样品流转表格和暂存派发动作所需的响应式状态。
function useSamplesFlow() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.samples]);

  const rawTasks = ref([]);
  const rawSamples = ref([]);
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
  const stagingSelectedCodes = ref([]);

  const batchModal = useDialogState();
  const detailDrawer = useDialogState();

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
  const pageCount = computed(() => view.value.totalPages);
  const taskOptions = computed(() => view.value.taskOptions);
  const statusOptions = computed(() => view.value.statusOptions);
  const stagingView = computed(() =>
    buildSamplesStagingView({
      labels: DEFAULT_LABELS,
      query: stagingQuery.value,
      samples: rawSamples.value,
      selectedCodes: stagingSelectedCodes.value,
    }),
  );
  const stagingRows = computed(() => stagingView.value.rows);
  const stagingCount = computed(() => stagingView.value.count);
  const stagingLabOptions = computed(() => stagingView.value.labOptions);
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

  const load = async () => {
    // 当前页面只消费任务与样品快照，不依赖排程和流数据。
    loading.value = true;
    const snapshot = await loadSnapshot();
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    loading.value = false;
  };

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
      now: new Date().toISOString(),
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
  };

  const submitBatch = async () => {
    const result = submitSamplesBatchIntake({
      samples: rawSamples.value,
      payload: batchForm,
      labels: DEFAULT_LABELS,
      now: new Date().toISOString(),
    });
    if (result.error) {
      warning.value = result.error;
      return;
    }
    // 批量接样成功后关闭弹窗，但不额外广播事件，因为当前页已持有最新数据。
    rawSamples.value = result.samples;
    await persistSnapshot({
      [STORAGE_KEYS.samples]: result.samples,
    });
    warning.value = "";
    batchModal.close();
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
      now: new Date().toISOString(),
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
    warning.value = "";
    detailDrawer.close();
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

  onMounted(() => {
    void load();
    // 与收样页通过全局事件同步，保持不同子视图间的数据一致。
    window.addEventListener(SAMPLES_UPDATED_EVENT, load);
  });

  onBeforeUnmount(() => {
    window.removeEventListener(SAMPLES_UPDATED_EVENT, load);
  });

  return {
    batchForm,
    batchModalOpen: batchModal.open,
    closeBatchModal,
    closeDetailDrawer,
    currentPage,
    detailDrawerOpen: detailDrawer.open,
    detailForm,
    detailStatusOptions: DETAIL_STATUS_OPTIONS,
    loading,
    locationOptions,
    openBatchModal,
    openDetailDrawer,
    pageCount,
    query,
    sampleRows,
    saveDetail,
    selectedStatus,
    selectedTaskCode,
    setPage,
    setQuery,
    setStatusFilter,
    setStagingQuery,
    setTaskFilter,
    stagingAllSelected,
    stagingCount,
    stagingForm,
    stagingLabOptions,
    stagingQuery,
    stagingRows,
    stagingSelectedCodes,
    sortDirection,
    sortKey,
    statusOptions,
    submitStagingDispatch,
    submitBatch,
    taskOptions,
    toggleAllStagingSelection,
    toggleStagingSelection,
    toggleSort,
    warning,
    resetStaging,
  };
}

export { useSamplesFlow };
