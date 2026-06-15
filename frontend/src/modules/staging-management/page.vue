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
          <h3>{{ roomCopy.consoleTitle }}</h3>
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
        </div>

        <div class="zancun-inventory-columns">
          <section class="zancun-inventory-column" data-testid="zancun-current-staging-column">
            <div class="zancun-inventory-column__head">
              <h4>{{ roomCopy.currentColumnTitle }}</h4>
              <span class="pill">{{ roomCopy.currentPillPrefix }} {{ currentStagingTotalCount }}</span>
              <AppPagination
                class="zancun-current-staging-pagination"
                data-testid="zancun-current-staging-pagination"
                :current-page="currentStagingCurrentPage"
                :page-count="currentStagingPageCount"
                @change="setCurrentStagingPage"
              />
            </div>
            <div class="zancun-console-list">
              <div
                v-for="slot in currentStagingSlots"
                :key="slot.key"
                :class="['zancun-console-slot', { 'zancun-console-slot--placeholder': !slot.row }]"
                :data-testid="slot.row ? 'zancun-current-staging-row' : undefined"
              >
                <template v-if="slot.row">
                  <div class="zancun-console-slot__main">
                    <strong>{{ slot.row.trayCode }}</strong>
                    <span class="muted">{{ slot.row.taskCode }}</span>
                  </div>
                  <div class="zancun-console-slot__meta">
                    <span>{{ slot.row.sampleType }}</span>
                    <span>数量 {{ slot.row.quantity }}</span>
                    <span>{{ slot.row.location }}</span>
                    <span :class="slot.row.statusClass">{{ slot.row.statusLabel || slot.row.status }}</span>
                  </div>
                </template>
                <div v-else class="zancun-console-slot__empty muted">
                  {{ slot.emptyMessage }}
                </div>
              </div>
            </div>
          </section>

          <section class="zancun-inventory-column" data-testid="zancun-planned-inbound-column">
            <div class="zancun-inventory-column__head">
              <h4>{{ roomCopy.plannedTitle }}</h4>
              <span class="pill">{{ roomCopy.plannedPillPrefix }} {{ plannedInboundTotalCount }}</span>
              <AppPagination
                class="zancun-planned-inbound-pagination"
                data-testid="zancun-planned-inbound-pagination"
                :current-page="overviewCurrentPage"
                :page-count="overviewPageCount"
                @change="setOverviewPage"
              />
            </div>
            <div class="zancun-console-list">
              <div
                v-for="slot in plannedInboundSlots"
                :key="slot.key"
                :class="['zancun-console-slot', { 'zancun-console-slot--placeholder': !slot.row }]"
                :data-testid="slot.row ? 'zancun-planned-inbound-row' : undefined"
              >
                <template v-if="slot.row">
                  <div class="zancun-console-slot__main">
                    <strong>{{ slot.row.trayCode }}</strong>
                    <span class="muted">{{ slot.row.taskCode }}</span>
                  </div>
                  <div class="zancun-console-slot__meta">
                    <span>{{ slot.row.sampleType }}</span>
                    <span>数量 {{ slot.row.quantity }}</span>
                    <span>{{ slot.row.location }}</span>
                    <span>{{ slot.row.inboundKindLabel }}</span>
                    <span :class="slot.row.statusClass">{{ slot.row.statusLabel || slot.row.status }}</span>
                  </div>
                </template>
                <div v-else class="zancun-console-slot__empty muted">
                  {{ slot.emptyMessage }}
                </div>
              </div>
            </div>
          </section>
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
          <div class="zancun-scan-code-row">
            <input
              ref="scanInputRef"
              v-model="scanForm.code"
              data-testid="zancun-scan-code"
              type="text"
              placeholder="请扫描或输入托盘编号"
              @keyup="handleScanKeyup"
            />
            <button
              v-if="activeScanMode === 'stockIn'"
              class="action-btn zancun-scan-submit-btn"
              data-testid="zancun-scan-submit"
              type="button"
              :disabled="scanSubmitting"
              @click="submitStockInScan"
            >
              {{ scanSubmitting ? "入库中..." : "入库" }}
            </button>
          </div>
        </div>
        <AppFeedback :message="scanWarning" tone="warning" @close="scanWarning = ''" />
      </div>
      <template #footer>
        <button class="action-btn zancun-scan-complete-btn" data-testid="zancun-scan-complete" type="button" @click="handleScanFooter">
          {{ activeScanMode === "stockIn" ? "入库完成" : "扫码完成" }}
        </button>
      </template>
    </AppModal>

    <AppModal
      :open="destinationModalOpen"
      :title="roomCopy.destinationTitle"
      data-testid="zancun-destination-modal"
      @close="cancelDestinationAction"
    >
      <div class="zancun-destination-panel">
        <article class="zancun-destination-summary">
          <div>
            <strong>{{ activeDetail.trayCode }}</strong>
            <div class="muted">{{ activeDetail.taskCode }} / {{ activeDetail.sampleType }}</div>
          </div>
          <span class="pill">样品数 {{ activeDetail.quantity || 0 }}</span>
        </article>

        <article
          v-for="(destination, index) in activeDetail.targetDestinations"
          :key="`${destination.targetExperimentCode || index}-${destination.targetLabCode || destination.targetLabId || destination.targetLab}`"
          class="zancun-destination-card"
          :class="{ 'is-disabled': !destination.scheduled, 'is-recommended': destination.preferred }"
          :data-testid="`zancun-destination-card-${index}`"
        >
          <div class="zancun-destination-card__main">
            <h4>{{ destination.targetLab || "暂无目标实验室" }}</h4>
            <div class="muted">
              {{ destination.targetExperimentName || "待确认实验" }}
              <span v-if="destination.preferred" class="pill">推荐</span>
            </div>
            <div v-if="destination.targetUnavailableReason" class="muted zancun-destination-warning">
              {{ destination.targetUnavailableReason }}
            </div>
          </div>
          <button
            class="action-btn secondary zancun-destination-card__action"
            :data-testid="`zancun-destination-submit-${index}`"
            type="button"
            :disabled="!destination.targetLab || !destination.scheduled"
            @click="confirmDestinationAction(destination)"
          >
            送至{{ destination.targetLab || "目标实验室" }}
          </button>
        </article>

        <article
          v-if="activeRoom === 'staging'"
          class="zancun-destination-card zancun-destination-card--return"
          :class="manufacturerReturnSafe ? 'is-safe' : 'is-danger'"
          data-testid="zancun-manufacturer-return-card"
        >
          <div class="zancun-destination-card__main">
            <h4>厂家收回</h4>
            <div class="muted">{{ manufacturerReturnSafe ? "全部实验已完成" : "尚有未完成实验" }}</div>
          </div>
          <button
            class="action-btn secondary zancun-destination-card__action zancun-manufacturer-return"
            :class="manufacturerReturnSafe ? 'is-safe' : 'is-danger'"
            data-testid="zancun-manufacturer-return"
            type="button"
            @click="confirmManufacturerReturn"
          >
            厂家收回
          </button>
        </article>
      </div>
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
        <div v-if="activeDetailMode === 'stockOut'" class="form-field">
          <label>目标实验室</label>
          <input :value="activeDetail.targetLab || '暂无后续实验室'" data-testid="zancun-detail-target-lab" type="text" readonly />
        </div>
        <div v-if="activeDetailMode === 'stockOut'" class="form-field">
          <label>目标实验</label>
          <input :value="activeDetail.targetExperimentName || '待确认实验'" type="text" readonly />
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

    <AppModal :open="returnDangerModalOpen" data-testid="zancun-return-danger-modal" title="危险操作确认" @close="closeReturnDanger">
      <div class="form-grid">
        <div class="laboratory-danger-panel zancun-return-danger-panel">
          <strong>危险操作确认</strong>
          <p>该托盘中样品尚有未完成实验，是否立即厂家收回！</p>
        </div>
      </div>
      <template #footer>
        <button class="action-btn secondary" data-testid="zancun-return-danger-cancel" type="button" @click="closeReturnDanger">取消</button>
        <button class="action-btn danger" data-testid="zancun-return-danger-confirm" type="button" @click="confirmDangerManufacturerReturn">
          确认厂家收回
        </button>
      </template>
    </AppModal>
  </div>
</template>

<script setup>
defineOptions({
  name: "StagingManagementPage",
});

import { computed, getCurrentInstance, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppModal from "@/components/shared/AppModal.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import { useScanInputFocus } from "@/composables/useScanInputFocus";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { formatLocalDateTime } from "@/lib/dateTime";
import { writeStorageUpdates } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import {
  applyZancunInventoryAction,
  buildZancunInventorySections,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunRowsFromSnapshot,
  buildZancunScanDetail,
} from "./model";

const ROOM_PAGE_COPY = {
  staging: {
    activeMetricLabel: "暂存间中样品数量",
    consoleTitle: "暂存间控制台",
    currentColumnTitle: "暂存间样品",
    currentEmptyMessage: "当前页暂无暂存间样品",
    currentPillPrefix: "当前在库",
    destinationTitle: "选择目标实验室",
    moduleSource: "staging-management",
    plannedEmptyMessage: "当前页暂无允许暂存托盘",
    plannedPillPrefix: "允许暂存",
    plannedTitle: "允许暂存",
  },
  appearance: {
    activeMetricLabel: "外观检测间中样品数量",
    consoleTitle: "外观检测间控制台",
    currentColumnTitle: "外观检测间样品",
    currentEmptyMessage: "当前页暂无外观检测间样品",
    currentPillPrefix: "当前在库",
    destinationTitle: "选择目标去向",
    moduleSource: "appearance-inspection",
    plannedEmptyMessage: "当前页暂无待检测托盘",
    plannedPillPrefix: "待入库",
    plannedTitle: "计划入库",
  },
};

const instance = getCurrentInstance();
const resolveActiveRoom = () => {
  const route = instance?.proxy?.$route || {};
  const routeRoom = String(route?.meta?.storageRoom || "").trim();
  if (routeRoom) {
    return routeRoom;
  }

  const routePath = String(route?.path || window.location?.pathname || "").trim();
  return routePath.includes("appearance-inspection") ? "appearance" : "staging";
};
const activeRoom = computed(resolveActiveRoom);
const roomCopy = computed(() => ROOM_PAGE_COPY[activeRoom.value] || ROOM_PAGE_COPY.staging);
const snapshot = ref({
  [STORAGE_KEYS.tasks]: [],
  [STORAGE_KEYS.schedules]: [],
  [STORAGE_KEYS.experiments]: [],
  [STORAGE_KEYS.experiment_trays]: [],
  [STORAGE_KEYS.experiment_run_trays]: [],
  [STORAGE_KEYS.samples]: [],
  [STORAGE_KEYS.staging_events]: [],
});
const overviewQuery = ref("");
const activeMetricMode = ref("all");
const overviewCurrentPage = ref(1);
const overviewPageSize = 4;
const currentStagingCurrentPage = ref(1);
const scanInputRef = ref(null);
const { focusScanInput } = useScanInputFocus(scanInputRef);
const STORAGE_API_URL = buildApiUrl("/api/storage", getFrontendApiBaseUrl());
const STAGING_SNAPSHOT_KEYS = [
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.staging_events,
];
const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source, key);

const readRawStorageSnapshot = async () => {
  const response = await fetch(STORAGE_API_URL, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to read storage snapshot: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  return payload && typeof payload === "object" ? payload : {};
};

const mergeArraySnapshot = (previousSnapshot, nextSnapshot, keys) => {
  const source = nextSnapshot && typeof nextSnapshot === "object" ? nextSnapshot : {};
  const merged = { ...(previousSnapshot || {}) };
  keys.forEach((key) => {
    if (hasOwn(source, key) && Array.isArray(source[key])) {
      merged[key] = source[key];
    }
  });
  return merged;
};

const nowValue = () => formatLocalDateTime();

const overviewSourceRows = computed(() =>
  buildZancunRowsFromSnapshot(snapshot.value, {
    now: nowValue(),
    room: activeRoom.value,
  }),
);

const overviewView = computed(() =>
  buildZancunOverviewView({
    filters: {
      metricMode: activeMetricMode.value,
      query: overviewQuery.value,
    },
    page: 1,
    pageSize: Math.max(overviewSourceRows.value.length, 1),
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
    room: activeRoom.value,
    rows: overviewSourceRows.value,
    stagingEvents: snapshot.value[STORAGE_KEYS.staging_events],
  });
  return [
    {
      caption: "",
      label: roomCopy.value.activeMetricLabel,
      mode: "active",
      testId: "zancun-metric-active",
      value: String(summary.totalQuantity),
    },
    {
      caption: "",
      label: "今日到货",
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
const inventorySections = computed(() => buildZancunInventorySections(overviewRows.value, { room: activeRoom.value }));
const currentStagingAllRows = computed(() => inventorySections.value.currentStagingRows);
const plannedInboundAllRows = computed(() => inventorySections.value.plannedInboundRows);
const currentStagingTotalCount = computed(() => currentStagingAllRows.value.length);
const plannedInboundTotalCount = computed(() => plannedInboundAllRows.value.length);
const resolvePageCount = (totalCount) => Math.max(1, Math.ceil(totalCount / overviewPageSize));
const normalizePage = (page, pageCount) => {
  const parsedPage = Number.parseInt(String(page ?? 1), 10);
  const safePage = Number.isFinite(parsedPage) ? parsedPage : 1;
  return Math.min(Math.max(safePage, 1), pageCount);
};
const paginateRows = (rows, page) => {
  const currentPage = normalizePage(page, resolvePageCount(rows.length));
  const startIndex = (currentPage - 1) * overviewPageSize;
  return rows.slice(startIndex, startIndex + overviewPageSize);
};
const buildInventorySlots = (rows, emptyMessage) =>
  Array.from({ length: overviewPageSize }, (_, index) => {
    const row = rows[index] || null;
    return {
      emptyMessage: rows.length === 0 && index === 0 ? emptyMessage : "",
      key: row?.trayCode || `placeholder-${emptyMessage}-${index}`,
      row,
    };
  });
const currentStagingPageCount = computed(() => resolvePageCount(currentStagingTotalCount.value));
const overviewPageCount = computed(() => resolvePageCount(plannedInboundTotalCount.value));
const currentStagingRows = computed(() => paginateRows(currentStagingAllRows.value, currentStagingCurrentPage.value));
const plannedInboundRows = computed(() => paginateRows(plannedInboundAllRows.value, overviewCurrentPage.value));
const currentStagingSlots = computed(() => buildInventorySlots(currentStagingRows.value, roomCopy.value.currentEmptyMessage));
const plannedInboundSlots = computed(() => buildInventorySlots(plannedInboundRows.value, roomCopy.value.plannedEmptyMessage));

watch([overviewQuery, activeMetricMode], () => {
  overviewCurrentPage.value = 1;
  currentStagingCurrentPage.value = 1;
});

watch(
  overviewPageCount,
  (nextPage) => {
    const normalizedPage = normalizePage(overviewCurrentPage.value, nextPage);
    if (overviewCurrentPage.value !== normalizedPage) {
      overviewCurrentPage.value = normalizedPage;
    }
  },
);

watch(
  currentStagingPageCount,
  (nextPage) => {
    const normalizedPage = normalizePage(currentStagingCurrentPage.value, nextPage);
    if (currentStagingCurrentPage.value !== normalizedPage) {
      currentStagingCurrentPage.value = normalizedPage;
    }
  },
);

const setOverviewPage = (page) => {
  overviewCurrentPage.value = normalizePage(page, overviewPageCount.value);
};

const setCurrentStagingPage = (page) => {
  currentStagingCurrentPage.value = normalizePage(page, currentStagingPageCount.value);
};

const selectMetricMode = (mode) => {
  activeMetricMode.value = String(mode || "").trim() || "all";
};

const scanModalOpen = ref(false);
const detailModalOpen = ref(false);
const destinationModalOpen = ref(false);
const returnDangerModalOpen = ref(false);
const activeScanMode = ref("stockIn");
const activeDetailMode = ref("stockIn");
const scanWarning = ref("");
const scanSubmitting = ref(false);
let flushPendingStorageRefresh = () => false;
let hasPendingSamplesRefresh = false;

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
  isPostExperimentInbound: false,
  targetExperimentCode: "",
  targetExperimentName: "",
  targetDestinations: [],
  targetIsFallback: false,
  targetLab: "",
  targetLabCode: "",
  targetLabId: "",
  targetUnavailableReason: "",
  trayCode: "",
});

const resetScanForm = () => {
  scanForm.code = "";
};

const resetScanCodeAfterAttempt = () => {
  resetScanForm();
  if (scanInputRef.value) {
    scanInputRef.value.value = "";
  }
  void nextTick().then(() => focusScanInput());
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
  activeDetail.isPostExperimentInbound = false;
  activeDetail.targetExperimentCode = "";
  activeDetail.targetExperimentName = "";
  activeDetail.targetDestinations = [];
  activeDetail.targetIsFallback = false;
  activeDetail.targetLab = "";
  activeDetail.targetLabCode = "";
  activeDetail.targetLabId = "";
  activeDetail.targetUnavailableReason = "";
  activeDetail.trayCode = "";
};

const loadSnapshot = async () => {
  const nextSnapshot = await readRawStorageSnapshot();
  snapshot.value = mergeArraySnapshot(snapshot.value, nextSnapshot, STAGING_SNAPSHOT_KEYS);
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
  flushPendingRealtimeRefresh();
};

const openDestinationModal = (detail) => {
  resetDetail();
  Object.assign(activeDetail, detail);
  activeDetailMode.value = "stockOut";
  destinationModalOpen.value = true;
};

const manufacturerReturnSafe = computed(() =>
  activeRoom.value === "staging"
  && (
    activeDetail.status === "实验后暂存间存放"
    || activeDetail.isPostExperimentInbound
  ),
);

const closeDetailModal = () => {
  detailModalOpen.value = false;
  resetDetail();
  flushPendingRealtimeRefresh();
};

const closeDestinationModal = () => {
  destinationModalOpen.value = false;
  resetDetail();
  flushPendingRealtimeRefresh();
};

const closeReturnDanger = () => {
  returnDangerModalOpen.value = false;
  flushPendingRealtimeRefresh();
};

const persistInventoryResult = async (result) => {
  if (!result.error) {
    snapshot.value = result.snapshot;
    await writeStorageUpdates({
      [STORAGE_KEYS.tasks]: result.snapshot[STORAGE_KEYS.tasks],
      [STORAGE_KEYS.samples]: result.snapshot[STORAGE_KEYS.samples],
      [STORAGE_KEYS.staging_events]: result.snapshot[STORAGE_KEYS.staging_events],
    });
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, { detail: { source: roomCopy.value.moduleSource } }));
  }
  return !result.error;
};

const resolveScannedDetail = () => {
  if (!String(scanForm.code ?? "").trim()) {
    scanWarning.value = "请先完成扫码或输入托盘编号。";
    resetScanCodeAfterAttempt();
    return null;
  }

  const detail = buildZancunScanDetail(overviewSourceRows.value, scanForm.code, activeScanMode.value, { room: activeRoom.value });
  if (!detail.found) {
    scanWarning.value = activeScanMode.value === "stockIn" ? "未找到对应的入库托盘。" : "未找到对应的出库托盘。";
    resetScanCodeAfterAttempt();
    return null;
  }

  return detail;
};

const submitStockInScan = async () => {
  if (scanSubmitting.value) {
    return;
  }
  const scannedCode = String(scanForm.code ?? "").trim();
  if (!scannedCode) {
    scanWarning.value = "请先完成扫码或输入托盘编号。";
    resetScanCodeAfterAttempt();
    return;
  }
  const detail = buildZancunScanDetail(overviewSourceRows.value, scannedCode, activeScanMode.value, { room: activeRoom.value });

  scanSubmitting.value = true;
  try {
    const result = applyZancunInventoryAction({
      now: nowValue(),
      payload: {
        code: detail.found ? detail.trayCode : scannedCode,
        mode: "stockIn",
        room: activeRoom.value,
      },
      room: activeRoom.value,
      snapshot: snapshot.value,
    });
    if (await persistInventoryResult(result)) {
      scanWarning.value = "";
      resetScanForm();
      if (scanInputRef.value) {
        scanInputRef.value.value = "";
      }
      await nextTick();
      await focusScanInput();
    } else {
      scanWarning.value = result.error;
      resetScanCodeAfterAttempt();
    }
  } finally {
    scanSubmitting.value = false;
  }
};

const completeScan = async () => {
  const detail = resolveScannedDetail();
  if (!detail) {
    return;
  }

  if (activeScanMode.value === "stockIn") {
    await submitStockInScan();
    return;
  }

  if (!["到货", "已到达暂存间", "实验后暂存间存放", "外观检测间存放", "实验前外观检测存放"].includes(detail.status)) {
    scanWarning.value = activeRoom.value === "appearance" ? "该托盘尚未完成外观检测间扫码入库。" : "该托盘尚未完成暂存间扫码入库。";
    resetScanCodeAfterAttempt();
    return;
  }

  cancelScan();
  openDestinationModal(detail);
};

const handleScanEnter = async () => {
  if (activeScanMode.value === "stockIn") {
    await submitStockInScan();
    return;
  }
  await completeScan();
};

const handleScanKeyup = async (event) => {
  if (event?.key !== "Enter") {
    return;
  }
  event.preventDefault?.();
  await handleScanEnter();
};

const handleScanFooter = async () => {
  if (activeScanMode.value === "stockIn") {
    cancelScan();
    return;
  }
  await completeScan();
};

const cancelDetailAction = () => {
  closeDetailModal();
};

const cancelDestinationAction = () => {
  closeDestinationModal();
};

const confirmDestinationAction = async (destination = null) => {
  const target = destination || activeDetail.targetDestinations?.[0] || activeDetail;
  if (!target?.scheduled) {
    return;
  }
  const result = applyZancunInventoryAction({
    now: nowValue(),
      payload: {
        code: activeDetail.trayCode,
        mode: "stockOut",
        room: activeRoom.value,
        targetExperimentCode: target.targetExperimentCode,
        targetExperimentName: target.targetExperimentName,
        targetLab: target.targetLab,
        targetLabCode: target.targetLabCode,
        targetLabId: target.targetLabId,
        targetType: target.targetType,
      },
      room: activeRoom.value,
      snapshot: snapshot.value,
  });

  await persistInventoryResult(result);
  closeDestinationModal();
  if (!result.error) {
    await openScanModal("stockOut");
  }
};

const confirmManufacturerReturn = async () => {
  if (activeRoom.value !== "staging") {
    return;
  }

  if (!manufacturerReturnSafe.value) {
    returnDangerModalOpen.value = true;
    return;
  }

  await submitManufacturerReturn();
};

const submitManufacturerReturn = async () => {
  if (activeRoom.value !== "staging") {
    return;
  }

  returnDangerModalOpen.value = false;

  const result = applyZancunInventoryAction({
    now: nowValue(),
      payload: {
        code: activeDetail.trayCode,
        mode: "manufacturerReturn",
        room: activeRoom.value,
      },
      room: activeRoom.value,
      snapshot: snapshot.value,
  });

  await persistInventoryResult(result);
  closeDestinationModal();
};

const confirmDangerManufacturerReturn = async () => {
  await submitManufacturerReturn();
};

const confirmDetailAction = async () => {
  const result = applyZancunInventoryAction({
    now: nowValue(),
    payload: {
      code: activeDetail.trayCode,
      mode: activeDetailMode.value,
      room: activeRoom.value,
    },
    room: activeRoom.value,
    snapshot: snapshot.value,
  });

  if (!result.error) {
    snapshot.value = result.snapshot;
    await writeStorageUpdates({
      [STORAGE_KEYS.tasks]: result.snapshot[STORAGE_KEYS.tasks],
      [STORAGE_KEYS.samples]: result.snapshot[STORAGE_KEYS.samples],
      [STORAGE_KEYS.staging_events]: result.snapshot[STORAGE_KEYS.staging_events],
    });
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, { detail: { source: roomCopy.value.moduleSource } }));
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

const handleSamplesUpdated = (event) => {
  if (event?.detail?.source === roomCopy.value.moduleSource) {
    return;
  }
  if (isRealtimeRefreshPaused()) {
    hasPendingSamplesRefresh = true;
    return;
  }
  hasPendingSamplesRefresh = false;
  void loadSnapshot();
};

const isRealtimeRefreshPaused = () => Boolean(
  scanModalOpen.value
  || detailModalOpen.value
  || destinationModalOpen.value
  || returnDangerModalOpen.value
  || scanSubmitting.value
);

const flushPendingRealtimeRefresh = () => {
  const flushedStorage = flushPendingStorageRefresh();
  if (!hasPendingSamplesRefresh || isRealtimeRefreshPaused()) {
    return flushedStorage;
  }
  hasPendingSamplesRefresh = false;
  if (!flushedStorage) {
    void loadSnapshot();
  }
  return true;
};

const storageRefresh = useStorageSnapshotRefresh({
  keys: STAGING_SNAPSHOT_KEYS,
  refresh: loadSnapshot,
  paused: isRealtimeRefreshPaused,
});
flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

onMounted(() => {
  void loadSnapshot();
  if (typeof window !== "undefined") {
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  }
});
</script>
