<template>
  <div class="staging-management-page">
    <Teleport v-if="canTeleportOverviewAction" to=".header-actions">
      <button
        ref="overviewHeaderActionRef"
        class="action-btn secondary zancun-header-action-button"
        data-testid="zancun-open-overview"
        type="button"
        @click="openOverviewModal"
      >
        查看暂存信息清单
      </button>
    </Teleport>

    <section class="grid cols-3 stagger">
      <div v-for="metric in metrics" :key="metric.label" class="card">
        <div class="muted">{{ metric.label }}</div>
        <div class="kpi">{{ metric.value }}</div>
        <div v-if="metric.caption" class="muted">{{ metric.caption }}</div>
      </div>
    </section>

    <section class="card section zancun-actions-card">
      <div class="zancun-actions-header">
        <div>
          <h3>暂存间控制台</h3>
        </div>
        <span class="pill">标准流程</span>
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

    <AppModal :open="overviewModalOpen" data-testid="zancun-overview-modal" title="暂存信息总览清单" @close="closeOverviewModal">
      <div class="zancun-overview-card">
        <div class="toolbar zancun-overview-toolbar">
          <input
            v-model="overviewQuery"
            class="search-input"
            data-testid="zancun-overview-search"
            placeholder="筛选任务编号/托盘编号/责任人"
          />
          <select v-model="overviewSampleType" class="search-input" data-testid="zancun-overview-type-filter">
            <option value="">全部样品类型</option>
            <option v-for="option in overviewSampleTypeOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
          <select v-model="overviewStatus" class="search-input" data-testid="zancun-overview-status-filter">
            <option value="">全部状态</option>
            <option v-for="option in overviewStatusOptions" :key="option" :value="option">
              {{ option }}
            </option>
          </select>
          <AppPagination
            v-if="overviewPageCount > 1"
            data-testid="zancun-overview-pagination"
            :current-page="overviewCurrentPage"
            :page-count="overviewPageCount"
            @change="setOverviewPage"
          />
        </div>
        <table class="table" data-testid="zancun-overview-table">
          <thead>
            <tr>
              <th>序号</th>
              <th
                data-sort
                :data-sort-dir="overviewSortKey === 'taskCode' ? overviewSortDirection : ''"
                @click="toggleOverviewSort('taskCode')"
              >
                任务编号
              </th>
              <th
                data-sort
                data-testid="zancun-overview-sort-tray"
                :data-sort-dir="overviewSortKey === 'trayCode' ? overviewSortDirection : ''"
                @click="toggleOverviewSort('trayCode')"
              >
                托盘编号
              </th>
              <th>来源</th>
              <th
                data-sort
                :data-sort-dir="overviewSortKey === 'sampleType' ? overviewSortDirection : ''"
                @click="toggleOverviewSort('sampleType')"
              >
                样品类型
              </th>
              <th
                data-sort
                data-testid="zancun-overview-sort-quantity"
                :data-sort-dir="overviewSortKey === 'quantity' ? overviewSortDirection : ''"
                @click="toggleOverviewSort('quantity')"
              >
                数量
              </th>
              <th>当前位置</th>
              <th
                data-sort
                data-testid="zancun-overview-sort-stock-in"
                :data-sort-dir="overviewSortKey === 'stockInAt' ? overviewSortDirection : ''"
                @click="toggleOverviewSort('stockInAt')"
              >
                入库时间
              </th>
              <th
                data-sort
                :data-sort-dir="overviewSortKey === 'status' ? overviewSortDirection : ''"
                @click="toggleOverviewSort('status')"
              >
                状态
              </th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="overviewRows.length === 0">
              <td colspan="10" class="muted">暂无暂存信息</td>
            </tr>
            <tr v-for="(row, index) in overviewRows" :key="row.id">
              <td>{{ (overviewCurrentPage - 1) * overviewPageSize + index + 1 }}</td>
              <td>{{ row.taskCode }}</td>
              <td :data-testid="`zancun-overview-row-tray-${index}`">{{ row.trayCode }}</td>
              <td>{{ row.source }}</td>
              <td><span class="pill">{{ row.sampleType }}</span></td>
              <td>{{ row.quantity }}</td>
              <td>{{ row.location }}</td>
              <td>{{ row.stockInAtDisplay }}</td>
              <td><span :class="row.statusClass">{{ row.status }}</span></td>
              <td>
                <button class="action-link" type="button">查看</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <button class="action-btn secondary" data-testid="zancun-overview-close" type="button" @click="closeOverviewModal">
          关闭清单
        </button>
      </template>
    </AppModal>

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
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";

import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import {
  applyZancunInventoryAction,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunScanDetail,
  createZancunOverviewRows,
} from "./model";

const overviewSourceRows = ref(createZancunOverviewRows());
const overviewQuery = ref("");
const overviewSampleType = ref("");
const overviewStatus = ref("");
const overviewSortKey = ref("stockInAt");
const overviewSortDirection = ref("desc");
const overviewCurrentPage = ref(1);
const overviewPageSize = 6;

const overviewView = computed(() =>
  buildZancunOverviewView({
    filters: {
      query: overviewQuery.value,
      sampleType: overviewSampleType.value,
      status: overviewStatus.value,
    },
    page: overviewCurrentPage.value,
    pageSize: overviewPageSize,
    rows: overviewSourceRows.value,
    sort: {
      direction: overviewSortDirection.value,
      key: overviewSortKey.value,
    },
  }),
);

const metrics = computed(() => {
  const summary = buildZancunMetrics(overviewSourceRows.value);
  return [
    {
      caption: "",
      label: "暂存间中样品数量",
      value: String(summary.totalQuantity),
    },
    {
      caption: "",
      label: "今日待入库",
      value: String(summary.pendingStockInCount),
    },
    {
      caption: "",
      label: "今日待出库",
      value: String(summary.pendingStockOutCount),
    },
  ];
});

const overviewRows = computed(() => overviewView.value.rows);
const overviewPageCount = computed(() => overviewView.value.pageCount);
const overviewSampleTypeOptions = computed(() => overviewView.value.sampleTypeOptions);
const overviewStatusOptions = computed(() => overviewView.value.statusOptions);
const overviewModalOpen = ref(false);
const canTeleportOverviewAction = ref(false);
const overviewHeaderActionRef = ref(null);

const moveOverviewActionNextToRefresh = async () => {
  if (typeof document === "undefined") {
    return;
  }

  const headerActions = document.querySelector(".header-actions");
  if (!headerActions) {
    return;
  }

  canTeleportOverviewAction.value = true;
  await nextTick();

  const overviewButton = overviewHeaderActionRef.value;
  if (!overviewButton) {
    return;
  }

  const refreshButton = Array.from(headerActions.querySelectorAll("button.action-btn")).find((button) =>
    String(button.textContent ?? "").includes("刷新"),
  );

  if (refreshButton?.nextSibling) {
    headerActions.insertBefore(overviewButton, refreshButton.nextSibling);
    return;
  }

  if (refreshButton) {
    headerActions.appendChild(overviewButton);
  }
};

watch([overviewQuery, overviewSampleType, overviewStatus], () => {
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

const toggleOverviewSort = (key) => {
  const normalized = String(key ?? "").trim();
  if (!normalized) {
    return;
  }

  if (overviewSortKey.value === normalized) {
    overviewSortDirection.value = overviewSortDirection.value === "asc" ? "desc" : "asc";
    overviewCurrentPage.value = 1;
    return;
  }

  overviewSortKey.value = normalized;
  overviewSortDirection.value = normalized === "stockInAt" ? "desc" : "asc";
  overviewCurrentPage.value = 1;
};

const openOverviewModal = () => {
  overviewModalOpen.value = true;
};

const closeOverviewModal = () => {
  overviewModalOpen.value = false;
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

const openScanModal = (mode) => {
  activeScanMode.value = mode === "stockOut" ? "stockOut" : "stockIn";
  scanWarning.value = "";
  resetScanForm();
  scanModalOpen.value = true;
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
  cancelScan();
  openDetailModal(detail, activeScanMode.value);
};

const cancelDetailAction = () => {
  closeDetailModal();
};

const confirmDetailAction = () => {
  const result = applyZancunInventoryAction({
    payload: {
      code: activeDetail.trayCode,
      mode: activeDetailMode.value,
    },
    rows: overviewSourceRows.value,
  });

  if (!result.error) {
    overviewSourceRows.value = result.rows;
  }

  closeDetailModal();
};

const actions = [
  {
    buttonClass: "action-btn secondary zancun-action-button zancun-action-button--stock-in",
    buttonText: "扫码入库",
    cardClass: "zancun-action-item--stock-in",
    onClick: () => openScanModal("stockIn"),
    statusClass: "status running",
    tag: "入库",
    testId: "zancun-stock-in",
    title: "入库",
  },
  {
    buttonClass: "action-btn danger zancun-action-button zancun-action-button--stock-out",
    buttonText: "扫码出库",
    cardClass: "zancun-action-item--stock-out",
    onClick: () => openScanModal("stockOut"),
    statusClass: "status warn",
    tag: "出库",
    testId: "zancun-stock-out",
    title: "出库",
  },
];

onMounted(() => {
  void moveOverviewActionNextToRefresh();
});
</script>
