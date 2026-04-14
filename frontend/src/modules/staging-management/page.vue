<template>
  <div class="staging-management-page">
    <section class="grid cols-3 stagger">
      <button
        v-for="metric in metrics"
        :key="metric.label"
        :class="['card', 'zancun-metric-card', { 'is-active': activeMetricMode === metric.mode }]"
        :data-testid="metric.testId"
        type="button"
        @click="selectMetricMode(metric.mode)"
      >
        <div class="muted">{{ metric.label }}</div>
        <div class="kpi">{{ metric.value }}</div>
        <div v-if="metric.caption" class="muted">{{ metric.caption }}</div>
      </button>
    </section>

    <section class="card section zancun-actions-card">
      <div class="zancun-actions-header">
        <div class="zancun-actions-header__main">
          <h3>暂存间控制台</h3>
          <div class="zancun-current-view" data-testid="zancun-current-view">
            <span class="zancun-current-view__label">当前查看</span>
            <strong class="zancun-current-view__value">{{ activeMetricLabel }}</strong>
          </div>
        </div>
        <span class="pill">标准流程</span>
      </div>

      <div class="zancun-console-panel">
        <div class="toolbar zancun-console-toolbar">
          <input
            v-model="overviewQuery"
            class="search-input"
            data-testid="zancun-console-search"
            placeholder="筛选任务编号/托盘编号/责任人"
          />
          <div class="zancun-console-pagination">
            <button
              class="action-btn secondary"
              data-testid="zancun-console-prev-page"
              type="button"
              :disabled="overviewCurrentPage <= 1"
              @click="setOverviewPage(overviewCurrentPage - 1)"
            >
              上一页
            </button>
            <span class="muted">第 {{ overviewCurrentPage }} / {{ overviewPageCount }} 页</span>
            <button
              class="action-btn secondary"
              data-testid="zancun-console-next-page"
              type="button"
              :disabled="overviewCurrentPage >= overviewPageCount"
              @click="setOverviewPage(overviewCurrentPage + 1)"
            >
              下一页
            </button>
          </div>
        </div>

        <div class="zancun-console-list">
          <div
            v-for="(row, index) in traySlots"
            :key="row?.id || `empty-${index}`"
            class="zancun-console-slot"
            :data-testid="`zancun-console-slot-${index}`"
          >
            <template v-if="row">
              <div class="zancun-console-slot__main">
                <strong>{{ row.trayCode }}</strong>
                <span class="muted">{{ row.taskCode }}</span>
              </div>
              <div class="zancun-console-slot__meta">
                <span>{{ row.sampleType }}</span>
                <span>数量 {{ row.quantity }}</span>
                <span>{{ row.location }}</span>
                <span :class="row.statusClass">{{ row.status }}</span>
              </div>
            </template>
            <template v-else>
              <div class="zancun-console-slot__empty muted">当前页暂无更多托盘</div>
            </template>
          </div>
        </div>
      </div>

      <div class="zancun-actions-grid">
        <article v-for="action in actions" :key="action.title" :class="['zancun-action-item', action.cardClass]">
          <div class="zancun-action-copy">
            <span :class="action.statusClass">{{ action.tag }}</span>
            <h4>{{ action.title }}</h4>
          </div>
          <button :class="action.buttonClass" :data-testid="action.testId" type="button" @click="action.onClick">
            {{ action.buttonText }}
          </button>
        </article>
      </div>
    </section>

    <AppModal
      :open="scanModalOpen"
      :title="activeScanMode === 'stockIn' ? '扫码入库' : '扫码出库'"
      data-testid="zancun-scan-modal"
      @close="cancelScan"
    >
      <div class="zancun-scan-panel">
        <p class="muted">
          {{ activeScanMode === "stockIn" ? "请扫描待入库托盘编号。" : "请扫描待出库托盘编号。" }}
        </p>
        <div class="zancun-scan-indicator">
          {{ activeScanMode === "stockIn" ? "扫码入库进行中" : "扫码出库进行中" }}
        </div>
        <div class="form-field">
          <label>托盘编号</label>
          <input
            ref="scanInputRef"
            v-model="scanForm.code"
            data-testid="zancun-scan-code"
            type="text"
            placeholder="请扫描或输入托盘编号"
          />
        </div>
        <div class="form-alert" :class="{ 'is-hidden': !scanWarning }">{{ scanWarning }}</div>
      </div>
      <template #footer>
        <button class="action-btn zancun-scan-complete-btn" data-testid="zancun-scan-complete" type="button" @click="completeScan">
          扫码完成
        </button>
      </template>
    </AppModal>

    <AppModal
      :open="detailModalOpen"
      :title="activeDetailMode === 'stockIn' ? '入库物品详细信息' : '出库物品详细信息'"
      data-testid="zancun-detail-modal"
      @close="cancelDetailAction"
    >
      <div class="form-grid zancun-detail-grid">
        <div class="form-field">
          <label>托盘编号</label>
          <input :value="activeDetail.trayCode" data-testid="zancun-detail-tray" type="text" readonly />
        </div>
        <div class="form-field">
          <label>任务编号</label>
          <input :value="activeDetail.taskCode" type="text" readonly />
        </div>
        <div class="form-field">
          <label>样品类型</label>
          <input :value="activeDetail.sampleType" type="text" readonly />
        </div>
        <div class="form-field">
          <label>来源</label>
          <input :value="activeDetail.source" type="text" readonly />
        </div>
        <div class="form-field">
          <label>数量</label>
          <input :value="String(activeDetail.quantity || '')" type="text" readonly />
        </div>
        <div class="form-field">
          <label>当前位置</label>
          <input :value="activeDetail.location" type="text" readonly />
        </div>
        <div class="form-field">
          <label>责任人</label>
          <input :value="activeDetail.owner" type="text" readonly />
        </div>
        <div class="form-field">
          <label>入库时间</label>
          <input :value="activeDetail.stockInAtDisplay" type="text" readonly />
        </div>
        <div class="form-field">
          <label>确认状态</label>
          <input :value="activeDetail.nextStatus" type="text" readonly />
        </div>
      </div>
      <template #footer>
        <button class="action-btn" data-testid="zancun-detail-confirm" type="button" @click="confirmDetailAction">
          {{ activeDetailMode === "stockIn" ? "确认入库" : "确认出库" }}
        </button>
        <button class="action-btn secondary" data-testid="zancun-detail-cancel" type="button" @click="cancelDetailAction">
          {{ activeDetailMode === "stockIn" ? "取消入库" : "取消出库" }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";

import AppModal from "@/components/shared/AppModal.vue";
import { useScanInputFocus } from "@/composables/useScanInputFocus";
import { readStorageSnapshot, writeStorageUpdates } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";
import {
  applyZancunInventoryAction,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunRowsFromSnapshot,
  buildZancunScanDetail,
} from "./model";

const snapshot = ref({
  [STORAGE_KEYS.tasks]: [],
  [STORAGE_KEYS.samples]: [],
  [STORAGE_KEYS.staging_events]: [],
});
const overviewQuery = ref("");
const activeMetricMode = ref("all");
const overviewCurrentPage = ref(1);
const overviewPageSize = 5;
const scanInputRef = ref(null);
const { focusScanInput } = useScanInputFocus(scanInputRef);

const nowValue = () => new Date().toISOString();

const overviewSourceRows = computed(() =>
  buildZancunRowsFromSnapshot(snapshot.value, {
    now: nowValue(),
  }),
);

const overviewView = computed(() =>
  buildZancunOverviewView({
    filters: {
      metricMode: activeMetricMode.value,
      query: overviewQuery.value,
    },
    page: overviewCurrentPage.value,
    pageSize: overviewPageSize,
    rows: overviewSourceRows.value,
    sort: {
      direction: "asc",
      key: "trayCode",
    },
  }),
);

const metrics = computed(() => {
  const summary = buildZancunMetrics({
    now: nowValue(),
    rows: overviewSourceRows.value,
    stagingEvents: snapshot.value[STORAGE_KEYS.staging_events],
  });
  return [
    {
      caption: "",
      label: "暂存间中样品数量",
      mode: "active",
      testId: "zancun-metric-active",
      value: String(summary.totalQuantity),
    },
    {
      caption: "",
      label: "今日已入库",
      mode: "stockedInToday",
      testId: "zancun-metric-stocked-in",
      value: String(summary.stockedInTodayCount),
    },
    {
      caption: "",
      label: "今日已出库",
      mode: "stockedOutToday",
      testId: "zancun-metric-stocked-out",
      value: String(summary.stockedOutTodayCount),
    },
  ];
});

const activeMetricLabel = computed(() => {
  const matchedMetric = metrics.value.find((metric) => metric.mode === activeMetricMode.value);
  if (matchedMetric) {
    return matchedMetric.label;
  }
  return "全部托盘";
});

const overviewRows = computed(() => overviewView.value.rows);
const overviewPageCount = computed(() => overviewView.value.pageCount);
const traySlots = computed(() =>
  Array.from({ length: overviewPageSize }, (_, index) => overviewRows.value[index] || null),
);

watch([overviewQuery, activeMetricMode], () => {
  overviewCurrentPage.value = 1;
});

watch(
  () => overviewView.value.currentPage,
  (nextPage) => {
    if (overviewCurrentPage.value !== nextPage) {
      overviewCurrentPage.value = nextPage;
    }
  },
);

const setOverviewPage = (page) => {
  overviewCurrentPage.value = page;
};

const selectMetricMode = (mode) => {
  activeMetricMode.value = String(mode || "").trim() || "all";
};

const scanModalOpen = ref(false);
const detailModalOpen = ref(false);
const activeScanMode = ref("stockIn");
const activeDetailMode = ref("stockIn");
const scanWarning = ref("");

const scanForm = reactive({
  code: "",
});

const activeDetail = reactive({
  location: "",
  nextStatus: "",
  owner: "",
  quantity: "",
  sampleType: "",
  source: "",
  status: "",
  stockInAt: "",
  stockInAtDisplay: "",
  taskCode: "",
  trayCode: "",
});

const resetScanForm = () => {
  scanForm.code = "";
};

const resetDetail = () => {
  activeDetail.location = "";
  activeDetail.nextStatus = "";
  activeDetail.owner = "";
  activeDetail.quantity = "";
  activeDetail.sampleType = "";
  activeDetail.source = "";
  activeDetail.status = "";
  activeDetail.stockInAt = "";
  activeDetail.stockInAtDisplay = "";
  activeDetail.taskCode = "";
  activeDetail.trayCode = "";
};

const loadSnapshot = async () => {
  const nextSnapshot = await readStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.staging_events,
  ]);
  snapshot.value = {
    [STORAGE_KEYS.tasks]: nextSnapshot[STORAGE_KEYS.tasks] || [],
    [STORAGE_KEYS.samples]: nextSnapshot[STORAGE_KEYS.samples] || [],
    [STORAGE_KEYS.staging_events]: nextSnapshot[STORAGE_KEYS.staging_events] || [],
  };
};

const openScanModal = async (mode) => {
  activeScanMode.value = mode === "stockOut" ? "stockOut" : "stockIn";
  scanWarning.value = "";
  resetScanForm();
  scanModalOpen.value = true;
  await focusScanInput();
};

const cancelScan = () => {
  scanModalOpen.value = false;
  scanWarning.value = "";
  resetScanForm();
};

const openDetailModal = (detail, mode) => {
  Object.assign(activeDetail, detail);
  activeDetailMode.value = mode === "stockOut" ? "stockOut" : "stockIn";
  detailModalOpen.value = true;
};

const closeDetailModal = () => {
  detailModalOpen.value = false;
  resetDetail();
};

const completeScan = () => {
  if (!String(scanForm.code ?? "").trim()) {
    scanWarning.value = "请先完成扫码或输入托盘编号。";
    return;
  }

  const detail = buildZancunScanDetail(overviewSourceRows.value, scanForm.code, activeScanMode.value);
  if (!detail.found) {
    scanWarning.value = activeScanMode.value === "stockIn" ? "未找到对应的入库托盘。" : "未找到对应的出库托盘。";
    return;
  }

  cancelScan();
  openDetailModal(detail, activeScanMode.value);
};

const cancelDetailAction = () => {
  closeDetailModal();
};

const confirmDetailAction = async () => {
  const result = applyZancunInventoryAction({
    now: nowValue(),
    payload: {
      code: activeDetail.trayCode,
      mode: activeDetailMode.value,
    },
    snapshot: snapshot.value,
  });

  if (!result.error) {
    snapshot.value = result.snapshot;
    await writeStorageUpdates({
      [STORAGE_KEYS.samples]: result.snapshot[STORAGE_KEYS.samples],
      [STORAGE_KEYS.staging_events]: result.snapshot[STORAGE_KEYS.staging_events],
    });
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
  }

  closeDetailModal();
};

const actions = [
  {
    buttonClass: "action-btn secondary zancun-action-button zancun-action-button--stock-in",
    buttonText: "扫码入库",
    cardClass: "zancun-action-item--stock-in",
    onClick: () => void openScanModal("stockIn"),
    statusClass: "status running",
    tag: "入库",
    testId: "zancun-stock-in",
    title: "入库",
  },
  {
    buttonClass: "action-btn danger zancun-action-button zancun-action-button--stock-out",
    buttonText: "扫码出库",
    cardClass: "zancun-action-item--stock-out",
    onClick: () => void openScanModal("stockOut"),
    statusClass: "status warn",
    tag: "出库",
    testId: "zancun-stock-out",
    title: "出库",
  },
];

onMounted(() => {
  void loadSnapshot();
});
</script>
