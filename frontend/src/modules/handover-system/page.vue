<template>
  <div class="transfer-area-screen">
    <header class="page-header transfer-system-header">
      <div class="transfer-system-header__meta">
        <div class="eyebrow">接驳区系统</div>
        <h1 class="transfer-system-title">接驳区工作台</h1>
        <p class="subtitle transfer-system-subtitle">处理接驳区到样确认、托盘分装与交接。</p>
      </div>
      <div class="header-actions transfer-system-actions">
        <button class="action-btn secondary" data-testid="handover-logout" type="button" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <div class="transfer-area-shell">
      <template v-if="viewMode === 'overview'">
        <section class="card transfer-overview-shell">
          <div class="transfer-overview-title-row">
            <h2 class="transfer-overview-page-title">接驳任务总览</h2>
          </div>

          <div class="transfer-overview-shell__head">
            <div>
              <h2>总任务清单</h2>
              <div class="muted">样品送达后可调整托盘分装，保存托盘后即可确认入库，打印条码为可选操作。</div>
            </div>
            <div class="transfer-overview-kpis">
              <article class="transfer-overview-kpi">
                <span class="muted">未入库任务</span>
                <strong>{{ pendingTaskCount }}</strong>
              </article>
              <article class="transfer-overview-kpi">
                <span class="muted">已入库任务</span>
                <strong>{{ storedTaskCount }}</strong>
              </article>
            </div>
          </div>

          <div class="transfer-overview-toolbar">
            <input
              v-model="searchText"
              class="search-input"
              type="text"
              placeholder="筛选任务编号、实验类型、样品编号"
            />
            <select v-model="taskTypeFilter" class="transfer-overview-select">
              <option value="">全部类型</option>
              <option v-for="type in taskTypeOptions" :key="type" :value="type">{{ type }}</option>
            </select>
            <div class="transfer-overview-status-actions">
              <button class="action-btn secondary" type="button" :class="{ 'is-active': taskStatusFilter === pendingStatus }" @click="setTaskStatusFilter(pendingStatus)">未入库</button>
              <button class="action-btn secondary" type="button" :class="{ 'is-active': taskStatusFilter === storedStatus }" @click="setTaskStatusFilter(storedStatus)">已入库</button>
              <button class="action-btn secondary" type="button" :class="{ 'is-active': taskStatusFilter === '' }" @click="setTaskStatusFilter('')">全部</button>
            </div>
          </div>

          <div class="transfer-table">
            <div class="transfer-table__head transfer-table__head--compact">
              <div>序号</div>
              <div>任务编号</div>
              <div>任务信息</div>
              <div>样品编号</div>
              <div>样品数</div>
            </div>
            <div class="transfer-table__body">
              <div v-if="isBootstrapLoading" class="transfer-table__empty" data-testid="transfer-loading-state">
                <strong>正在加载接驳任务</strong>
                <span>正在读取接驳区任务与样品快照，请稍候。</span>
              </div>

              <div v-else-if="bootstrapError" class="transfer-table__empty transfer-table__empty--error" data-testid="transfer-bootstrap-error">
                <strong>接驳任务加载失败</strong>
                <span>{{ bootstrapError }}</span>
                <div class="transfer-empty-actions">
                  <button class="action-btn secondary" type="button" @click="reloadBootstrap">重新加载</button>
                </div>
              </div>

              <template v-else-if="pagedTaskOverview.length">
                <button
                  v-for="task in pagedTaskOverview"
                  :key="task.taskId"
                  class="transfer-table__row transfer-table__row--compact"
                  :data-testid="`transfer-task-row-${task.taskId}`"
                  type="button"
                  @click="openTask(task)"
                >
                  <div>{{ task.seq }}</div>
                  <div class="transfer-table__main">{{ task.taskNo }}</div>
                  <div class="transfer-table__name">
                    <strong>{{ task.experimentTypeText || task.taskType || "-" }}</strong>
                    <span class="muted">{{ task.taskProgress || task.taskStatus || "-" }}</span>
                  </div>
                  <div class="transfer-table__codes">
                    <span v-for="sampleCode in task.sampleCodes || []" :key="sampleCode" class="transfer-sample-code-chip">{{ sampleCode }}</span>
                  </div>
                  <div class="transfer-table__count">{{ task.sampleCount || 0 }}</div>
                </button>
              </template>

              <div v-else class="transfer-table__empty" data-testid="transfer-empty-state">
                <strong>{{ taskOverview.length ? "当前筛选条件下没有任务" : "当前没有接驳任务" }}</strong>
                <span>{{ taskOverview.length ? "切换到已入库或全部视图，或清空筛选条件后重试。" : "新任务到样后会自动出现在这里。" }}</span>
                <div class="transfer-empty-actions">
                  <button
                    v-if="taskOverview.length && taskStatusFilter !== storedStatus"
                    class="action-btn secondary"
                    data-testid="transfer-empty-show-stored"
                    type="button"
                    @click="setTaskStatusFilter(storedStatus)"
                  >
                    查看已入库
                  </button>
                  <button
                    v-if="taskOverview.length && taskStatusFilter !== ''"
                    class="action-btn secondary"
                    type="button"
                    @click="setTaskStatusFilter('')"
                  >
                    查看全部
                  </button>
                  <button
                    v-if="searchText || taskTypeFilter"
                    class="action-btn secondary"
                    type="button"
                    @click="clearFilters"
                  >
                    清空筛选
                  </button>
                  <button class="action-btn secondary" type="button" @click="reloadBootstrap">重新加载</button>
                </div>
              </div>
            </div>
          </div>

          <div class="card transfer-overview-pagination">
            <div class="muted">第 {{ currentTaskPage }} / {{ taskPageCount }} 页，共 {{ filteredTaskOverview.length }} 条任务</div>
            <div class="transfer-overview-pagination__actions">
              <button class="action-btn secondary" type="button" :disabled="currentTaskPage <= 1" @click="changePage(-1)">上一页</button>
              <button class="action-btn secondary" type="button" :disabled="currentTaskPage >= taskPageCount" @click="changePage(1)">下一页</button>
            </div>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="card transfer-detail-shell">
          <div class="transfer-detail-shell__top">
            <button class="action-btn secondary" type="button" @click="backToOverview">返回总览</button>
            <div class="transfer-detail-shell__title">
              <h2>托盘分装与入库</h2>
              <div class="muted">{{ currentTask?.taskNo || "--" }} | {{ currentTask?.experimentTypeText || currentTask?.taskType || "--" }}</div>
            </div>
          </div>

          <section class="transfer-task-header">
            <div class="transfer-task-header__summary">
              <div class="transfer-task-summary-card__label">任务基本信息</div>
              <strong>{{ currentTask?.taskNo || "--" }}</strong>
              <div class="transfer-task-header__name">{{ currentTask?.experimentTypeText || currentTask?.taskType || "--" }}</div>
            </div>
            <div class="transfer-task-header__meta">
              <article class="transfer-task-meta-item">
                <span>实验类型</span>
                <strong>{{ currentTask?.experimentTypeText || currentTask?.taskType || "--" }}</strong>
              </article>
              <article class="transfer-task-meta-item">
                <span>状态</span>
                <strong>{{ currentTask?.taskStatus || "--" }}</strong>
              </article>
              <article class="transfer-task-meta-item">
                <span>流程</span>
                <strong>{{ currentTask?.taskProgress || "--" }}</strong>
              </article>
              <article class="transfer-task-meta-item">
                <span>样品送达时间</span>
                <strong>{{ currentTask?.receivedTime || "未送达" }}</strong>
              </article>
              <article class="transfer-task-meta-item">
                <span>托盘数</span>
                <strong>{{ assignedTrays.length }}</strong>
              </article>
              <article class="transfer-task-meta-item">
                <span>已打印托盘</span>
                <strong>{{ printedTrayCount }} / {{ loadedTrayCount }}</strong>
              </article>
            </div>
          </section>

          <section class="transfer-tray-panel">
            <div class="transfer-panel-title transfer-panel-title--tray">
              <div>
                <h3>托盘栏位</h3>
                <div class="muted">点击样品后再点击托盘可移入；点击一个样品再点击另一个样品可交换位置。</div>
              </div>

              <div class="transfer-tray-toolbar">
                <div class="transfer-tray-limit-toolbar">
                  <span class="transfer-tray-limit-toolbar__label">统一上限</span>
                  <div class="transfer-tray-limit-stepper">
                    <input data-testid="transfer-tray-limit-input" type="number" min="1" step="1" :value="trayLimit" @change="setTrayLimit($event.target.value)" />
                    <button class="action-btn secondary transfer-tray-limit-btn" type="button" :disabled="isStoredTask" @click="decreaseTrayLimit">-</button>
                    <button class="action-btn secondary transfer-tray-limit-btn" type="button" :disabled="isStoredTask" @click="increaseTrayLimit">+</button>
                  </div>
                </div>

                <div class="transfer-panel-title__actions">
                  <span class="transfer-count-chip">剩余空托盘 {{ remainingTrayCount }}</span>
                  <button class="action-btn secondary transfer-use-tray-btn" type="button" :disabled="isStoredTask || remainingTrayCount <= 0 || trayCapacityExceeded" @click="addInventoryTray">新增托盘</button>
                </div>
              </div>
            </div>

            <div class="form-actions transfer-tray-actions transfer-tray-actions--top">
              <button class="action-btn transfer-print-all-btn" type="button" :disabled="!canPrint || printingAllBarcodes" @click="printAllTrayBarcodes">
                {{ printingAllBarcodes ? "生成中..." : `打印条形码（${loadedTrayCount}）` }}
              </button>
              <button class="action-btn secondary" type="button" :disabled="isStoredTask || allocationSaved || trayCapacityExceeded" @click="persistAllocation()">保存托盘</button>
              <button class="action-btn" type="button" :disabled="!canConfirm" @click="confirmStorage">确认入库</button>
              <button class="action-btn secondary" type="button" :disabled="!selectedTaskId" @click="reloadWorkspace">重新入库</button>
            </div>

            <div v-if="trayCapacityExceeded" class="form-alert" data-testid="transfer-tray-capacity-warning">{{ trayCapacityWarning }}</div>

            <div v-if="selectedSampleLabel" class="transfer-selected-sample-hint">
              已选样品：{{ selectedSampleLabel }}
            </div>

            <div class="transfer-tray-list transfer-tray-list--two-columns" data-testid="transfer-tray-list">
              <div
                v-for="(tray, index) in assignedTrays"
                :key="tray.trayId"
                class="sample-tray-card transfer-tray-card"
                :data-testid="`transfer-tray-card-${index}`"
                :class="{ 'is-active': index === activeTrayIndex, 'is-locked': isStoredTask }"
                @click="setActiveTray(index)"
                @dragover.prevent="allowTrayDrag"
                @drop.prevent="handleTrayDrop(index)"
              >
                <div class="sample-tray-card-head">
                  <span>{{ tray.trayNo }}</span>
                  <span>托盘 #{{ index + 1 }}</span>
                </div>
                <div class="sample-tray-card-meta">当前样品 {{ tray.samples.length }} / {{ trayLimit }}</div>
                <div class="sample-tray-card-meta">托盘状态 {{ tray.trayStatus || "已预分配" }}</div>

                <div class="sample-tray-samples">
                  <span v-if="tray.samples.length === 0" class="sample-tray-empty">暂无样品</span>
                  <button
                    v-for="sample in tray.samples"
                    :key="sample.sampleId"
                    type="button"
                    class="sample-tray-sample-tag sample-tray-chip--with-status"
                    :class="{ 'is-selected': isSampleSelected(sample.sampleId) }"
                    :draggable="!isStoredTask"
                    @dragstart.stop="startDragging(sample.sampleId, index)"
                    @click.stop="selectTraySample(sample.sampleId, index)"
                  >
                    <span class="sample-tray-chip__code">{{ sample.sampleNo }}</span>
                    <span class="sample-tray-chip__status">{{ sample.sampleStatus || "未入库" }}</span>
                  </button>
                </div>

                <div class="transfer-tray-card__footer">
                  <div class="transfer-tray-card__count">条码：{{ tray.barcode?.barcodeNo || "未打印" }}</div>
                  <div class="transfer-tray-card__actions">
                    <button class="sample-tray-remove" type="button" :disabled="isStoredTask" @click.stop="removeTray(index)">删除托盘</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="helper transfer-helper">默认上限为 4，保存托盘后即可确认入库；已入库任务仍可打印条码，但不允许再调整托盘。</div>

            <div class="form-field">
              <label>托盘预览</label>
              <textarea class="sample-codes-input" data-testid="transfer-tray-preview" readonly :value="trayPreviewText"></textarea>
            </div>

            <div class="form-alert" :class="{ 'is-hidden': !feedback }">{{ feedback }}</div>
          </section>
        </section>
      </template>
    </div>

    <div v-if="barcodeModalVisible" class="transfer-modal">
      <div class="transfer-modal__backdrop" @click="closeBarcodeModal"></div>
      <div class="transfer-modal__panel" data-testid="barcode-modal">
        <div class="transfer-modal__head">
          <div>
            <h3>条形码信息</h3>
            <div class="muted">{{ currentTask?.taskNo || "--" }} | {{ currentTask?.experimentTypeText || currentTask?.taskType || "--" }}</div>
          </div>
          <button class="action-btn secondary" type="button" @click="closeBarcodeModal">关闭</button>
        </div>
        <div class="transfer-modal__list">
          <article v-for="item in barcodePreviewItems" :key="item.barcodeId" class="transfer-modal__item">
            <strong>{{ item.barcodeNo }}</strong>
            <div v-if="item.barcodeSvg" class="transfer-modal__barcode" v-html="item.barcodeSvg"></div>
            <div>托盘：{{ item.trayNo }}</div>
            <div>内容：{{ item.barcodeContent }}</div>
            <div>样品：{{ item.samples.join(" / ") || "-" }}</div>
          </article>
        </div>
        <div class="transfer-modal__actions">
          <button class="action-btn" type="button" data-testid="barcode-modal-confirm-print" @click="confirmBarcodePrint">确认打印</button>
        </div>
      </div>
    </div>

    <ModuleExitDialog
      :current-module="'handover'"
      :open="exitDialogOpen"
      @close="closeExitDialog"
      @logout="confirmLogout"
      @switch-module="switchModule"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import ModuleExitDialog from "@/components/shared/ModuleExitDialog.vue";
import { logoutSession, resolveModuleHome, switchSessionModule } from "@/auth";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";

const API_BASE_URL = getFrontendApiBaseUrl();
const router = useRouter();
const pendingStatus = "未入库";
const storedStatus = "已入库";
const TASK_TRAY_CODE_PATTERN = /-TP-(\d+)$/;

const viewMode = ref("overview");
const searchText = ref("");
const taskTypeFilter = ref("");
const taskStatusFilter = ref(pendingStatus);
const taskOverview = ref([]);
const selectedTaskId = ref(null);
const currentTask = ref(null);
const assignedTrays = ref([]);
const availableInventory = ref([]);
const trayLimit = ref(4);
const activeTrayIndex = ref(-1);
const draggingSampleId = ref(null);
const draggingFromTrayIndex = ref(-1);
const selectedSampleId = ref(null);
const selectedSampleTrayIndex = ref(-1);
const isBootstrapLoading = ref(false);
const bootstrapError = ref("");
const allocationSaved = ref(false);
const feedback = ref("");
const printingAllBarcodes = ref(false);
const barcodeModalVisible = ref(false);
const barcodePreviewItems = ref([]);
const barcodePrintConfirmed = ref(false);
const taskPage = ref(1);
const overviewPageSize = ref(3);
const pendingTaskCount = ref(0);
const storedTaskCount = ref(0);
const exitDialogOpen = ref(false);

const normalizeTaskStatus = (status) => {
  const text = String(status || "").trim();
  if (text.includes(storedStatus)) return storedStatus;
  if (text.includes(pendingStatus)) return pendingStatus;
  return text;
};

const normalizeTaskRecord = (task) => ({
  ...task,
  taskStatus: normalizeTaskStatus(task?.taskStatus),
});

const updateOverviewTaskStatus = (taskId, status, progress) => {
  const normalizedStatus = normalizeTaskStatus(status);
  taskOverview.value = taskOverview.value.map((task) => (
    task.taskId === taskId
      ? {
          ...task,
          taskStatus: normalizedStatus,
          taskProgress: progress ?? task.taskProgress,
        }
      : task
  ));
  pendingTaskCount.value = taskOverview.value.filter((task) => normalizeTaskStatus(task.taskStatus) === pendingStatus).length;
  storedTaskCount.value = taskOverview.value.filter((task) => normalizeTaskStatus(task.taskStatus) === storedStatus).length;
};

const fetchJson = async (path, options) => {
  const response = await fetch(buildApiUrl(path, API_BASE_URL), options);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.message || `请求失败（${response.status}）`);
  }
  return payload || {};
};

const handleLogout = () => {
  exitDialogOpen.value = true;
};

const closeExitDialog = () => {
  exitDialogOpen.value = false;
};

const confirmLogout = async () => {
  closeExitDialog();
  await logoutSession();
  router.replace("/login");
};

const switchModule = async (targetModule) => {
  closeExitDialog();
  const result = await switchSessionModule(targetModule);
  if (!result.ok) {
    return;
  }
  await router.push(resolveModuleHome(targetModule));
};

const taskTypeOptions = computed(() => [...new Set(taskOverview.value.map((task) => task.taskType).filter(Boolean))]);
const filteredTaskOverview = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  return taskOverview.value.filter((task) => {
    const typeMatch = !taskTypeFilter.value || task.taskType === taskTypeFilter.value;
    const statusMatch = !taskStatusFilter.value || normalizeTaskStatus(task.taskStatus) === taskStatusFilter.value;
    const searchTextPool = [
      task.taskNo,
      task.taskType,
      task.experimentTypeText,
      task.taskProgress,
      task.sampleCodesText,
      ...(Array.isArray(task.sampleCodes) ? task.sampleCodes : []),
    ].join(" ").toLowerCase();
    return typeMatch && statusMatch && (!query || searchTextPool.includes(query));
  });
});
const taskPageCount = computed(() => Math.max(1, Math.ceil(filteredTaskOverview.value.length / overviewPageSize.value)));
const currentTaskPage = computed(() => Math.min(taskPage.value, taskPageCount.value));
const pagedTaskOverview = computed(() => filteredTaskOverview.value.slice((currentTaskPage.value - 1) * overviewPageSize.value, currentTaskPage.value * overviewPageSize.value));
const remainingTrayCount = computed(() => availableInventory.value.length);
const totalAssignedSampleCount = computed(() => assignedTrays.value.reduce((sum, tray) => sum + tray.samples.length, 0));
const minimumTrayCount = computed(() => Math.max(1, Math.ceil(totalAssignedSampleCount.value / Math.max(1, trayLimit.value))));
const loadedTrayCount = computed(() => assignedTrays.value.filter((tray) => tray.samples.length > 0).length);
const printedTrayCount = computed(() => assignedTrays.value.filter((tray) => tray.samples.length > 0 && tray.barcode?.barcodeNo).length);
const isStoredTask = computed(() => normalizeTaskStatus(currentTask.value?.taskStatus) === storedStatus);
const hasTrayCapacityLimit = computed(() => currentTask.value?.maxAssignableTrayCount != null);
const maxAssignableTrayCount = computed(() => {
  const parsed = Number.parseInt(currentTask.value?.maxAssignableTrayCount, 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return loadedTrayCount.value + remainingTrayCount.value;
});
const trayCapacityExceeded = computed(() => (
  Boolean(selectedTaskId.value)
  && hasTrayCapacityLimit.value
  && loadedTrayCount.value > maxAssignableTrayCount.value
));
const trayCapacityWarning = computed(() => (
  String(currentTask.value?.trayCapacityMessage || "").trim()
  || `系统剩余托盘不足，当前最多可分配 ${maxAssignableTrayCount.value} 个托盘。`
));
const canPrint = computed(() => (
  Boolean(selectedTaskId.value)
  && Boolean(currentTask.value?.receivedTime)
  && loadedTrayCount.value > 0
  && allocationSaved.value
  && !trayCapacityExceeded.value
));
const canConfirm = computed(() => (
  Boolean(selectedTaskId.value)
  && Boolean(currentTask.value?.receivedTime)
  && loadedTrayCount.value > 0
  && allocationSaved.value
  && !isStoredTask.value
  && !trayCapacityExceeded.value
));
const trayPreviewText = computed(() => assignedTrays.value.map((tray) => `${tray.trayNo} | ${tray.samples.length} / ${trayLimit.value} | ${tray.samples.map((sample) => sample.sampleNo).join(" / ") || "暂无样品"}`).join("\n"));
const selectedSampleLabel = computed(() => {
  for (const tray of assignedTrays.value) {
    const sample = tray.samples.find((item) => item.sampleId === selectedSampleId.value);
    if (sample) return sample.sampleNo;
  }
  return "";
});

const clearFilters = () => {
  searchText.value = "";
  taskTypeFilter.value = "";
  taskStatusFilter.value = "";
  taskPage.value = 1;
};

const currentTaskCode = computed(() => String(currentTask.value?.taskNo || "").trim());

const traySerialFromCode = (trayCode) => {
  const text = String(trayCode || "").trim();
  const taskMatch = text.match(TASK_TRAY_CODE_PATTERN);
  if (taskMatch) return Number.parseInt(taskMatch[1], 10);
  return 0;
};

const encodeTaskTrayId = (serial) => 1000 + serial;
const sampleSort = (left, right) => String(left?.sampleNo || "").localeCompare(String(right?.sampleNo || ""));
const sortTrayRefs = (trays) => trays.slice().sort((left, right) => (
  traySerialFromCode(left?.trayNo) - traySerialFromCode(right?.trayNo)
  || String(left?.trayNo || "").localeCompare(String(right?.trayNo || ""))
));

const createTaskTrayRef = (serial, limit) => ({
  trayId: encodeTaskTrayId(serial),
  trayNo: `${currentTaskCode.value || "TASK"}-TP-${String(serial).padStart(3, "0")}`,
  trayType: "标准托盘",
  capacity: limit,
  currentTaskId: selectedTaskId.value,
});

const createInventorySlot = (slot, index, limit) => ({
  trayId: Number.parseInt(slot?.trayId, 10) || 5000 + index + 1,
  trayNo: String(slot?.trayNo || `INVENTORY-${index + 1}`),
  trayType: slot?.trayType || "标准托盘",
  capacity: Number.parseInt(slot?.capacity, 10) || limit,
  currentTaskId: null,
});

const normalizeInventoryRefs = (inventory, limit) => inventory.map((slot, index) => createInventorySlot(slot, index, limit));
const buildInventorySlots = (count, limit) => normalizeInventoryRefs(Array.from({ length: count }, () => ({})), limit);
const normalizeEditableTrays = (trays, limit) => trays.map((tray, index) => createEditableTray(createTaskTrayRef(index + 1, limit), limit, tray.samples));

const collectOrderedSamples = (sourceTrays = assignedTrays.value) => sourceTrays
  .flatMap((tray) => tray.samples.map((sample) => ({ ...sample })))
  .sort(sampleSort);

const createEditableTray = (trayRef, limit, samples = []) => {
  const normalizedSamples = normalizeTraySamples(samples);
  return {
    trayId: trayRef.trayId,
    trayNo: trayRef.trayNo,
    trayType: trayRef.trayType || "标准托盘",
    trayStatus: "已预分配",
    capacity: limit,
    loadQty: normalizedSamples.length,
    samples: normalizedSamples,
    barcode: null,
    barcodeData: null,
  };
};

const refreshEditableTrayState = (message = "") => {
  assignedTrays.value = normalizeEditableTrays(assignedTrays.value, trayLimit.value);
  availableInventory.value = buildInventorySlots(availableInventory.value.length, trayLimit.value);
  barcodePrintConfirmed.value = false;
  allocationSaved.value = false;
  if (message) {
    feedback.value = message;
  }
};

const rebalanceTrayLayout = ({ limit = trayLimit.value, excludeTrayId = null, message = "" } = {}) => {
  const normalizedLimit = Math.max(1, Number.parseInt(limit, 10) || 1);
  const orderedSamples = collectOrderedSamples();
  const requiredCount = Math.max(1, Math.ceil(orderedSamples.length / normalizedLimit));
  const totalTrayPoolCount = Math.max(requiredCount, assignedTrays.value.length + availableInventory.value.length);
  const nextAssigned = Array.from({ length: requiredCount }, (_, index) => createEditableTray(createTaskTrayRef(index + 1, normalizedLimit), normalizedLimit, []));

  orderedSamples.forEach((sample, index) => {
    nextAssigned[Math.floor(index / normalizedLimit)].samples.push({
      ...sample,
      sampleStatus: pendingStatus,
    });
  });

  assignedTrays.value = nextAssigned.map((tray) => createEditableTray(tray, normalizedLimit, tray.samples));
  availableInventory.value = buildInventorySlots(totalTrayPoolCount - requiredCount, normalizedLimit);
  trayLimit.value = normalizedLimit;
  activeTrayIndex.value = assignedTrays.value.length ? 0 : -1;
  clearSelectedSample();
  barcodePrintConfirmed.value = false;
  allocationSaved.value = false;
  if (message) {
    feedback.value = message;
  }
};

const resetInteractiveState = () => {
  activeTrayIndex.value = assignedTrays.value.length ? 0 : -1;
  draggingSampleId.value = null;
  draggingFromTrayIndex.value = -1;
  selectedSampleId.value = null;
  selectedSampleTrayIndex.value = -1;
  barcodePrintConfirmed.value = false;
};

const applyWorkspace = (workspace) => {
  currentTask.value = workspace?.task ? normalizeTaskRecord(workspace.task) : null;
  trayLimit.value = workspace?.task?.trayLimit || 4;
  assignedTrays.value = (workspace?.assignedTrays || []).map((tray) => ({
    ...tray,
    samples: Array.isArray(tray.samples)
      ? tray.samples.map((sample) => ({
          ...sample,
          sampleStatus: normalizeTaskStatus(workspace?.task?.taskStatus) === storedStatus ? storedStatus : (sample.sampleStatus || pendingStatus),
        }))
      : [],
    trayStatus: normalizeTaskStatus(workspace?.task?.taskStatus) === storedStatus ? storedStatus : tray.trayStatus,
  }));
  availableInventory.value = normalizeInventoryRefs(workspace?.trayInventory || [], trayLimit.value);
  allocationSaved.value = Boolean(workspace?.allocationSaved);
  resetInteractiveState();
};

const loadBootstrap = async () => {
  isBootstrapLoading.value = true;
  bootstrapError.value = "";
  try {
    const payload = await fetchJson("/api/transfer-area/bootstrap");
    taskOverview.value = (payload.taskOverview || []).map((task) => normalizeTaskRecord(task));
    pendingTaskCount.value = payload.pendingTaskCount || 0;
    storedTaskCount.value = payload.storedTaskCount || 0;
  } catch (error) {
    bootstrapError.value = error instanceof Error ? error.message : "请稍后重试";
    taskOverview.value = [];
    pendingTaskCount.value = 0;
    storedTaskCount.value = 0;
  } finally {
    isBootstrapLoading.value = false;
  }
};

const loadWorkspace = async (taskId = selectedTaskId.value) => {
  if (!taskId) return;
  const knownStatus = normalizeTaskStatus(
    currentTask.value?.taskId === taskId
      ? currentTask.value?.taskStatus
      : taskOverview.value.find((task) => task.taskId === taskId)?.taskStatus
  );
  const payload = await fetchJson(`/api/transfer-area/tasks/${taskId}/workspace`);
  applyWorkspace(payload);
  if (knownStatus === storedStatus && currentTask.value && normalizeTaskStatus(currentTask.value.taskStatus) !== storedStatus) {
    currentTask.value = {
      ...currentTask.value,
      taskStatus: storedStatus,
      taskProgress: currentTask.value.taskProgress || "已确认入库",
    };
  }
};

const openTask = async (task) => {
  selectedTaskId.value = task.taskId;
  feedback.value = "";
  barcodeModalVisible.value = false;
  barcodePreviewItems.value = [];
  viewMode.value = "detail";
  await loadWorkspace(task.taskId);
};

const setTaskStatusFilter = (status) => {
  taskStatusFilter.value = status;
  taskPage.value = 1;
};

const reloadBootstrap = async () => {
  await loadBootstrap();
};

const changePage = (offset) => {
  taskPage.value = Math.min(taskPageCount.value, Math.max(1, taskPage.value + offset));
};

const backToOverview = async () => {
  barcodeModalVisible.value = false;
  await loadBootstrap();
  viewMode.value = "overview";
};

const clearSelectedSample = () => {
  selectedSampleId.value = null;
  selectedSampleTrayIndex.value = -1;
};

const isSampleSelected = (sampleId) => selectedSampleId.value === sampleId;
const normalizeTraySamples = (samples) => samples.slice().sort((a, b) => String(a.sampleNo || "").localeCompare(String(b.sampleNo || "")));

const setActiveTray = (index) => {
  if (selectedSampleId.value != null && selectedSampleTrayIndex.value >= 0 && selectedSampleTrayIndex.value !== index) {
    placeSelectedSampleToTray(index);
    return;
  }
  activeTrayIndex.value = index;
};

const setTrayLimit = (value) => {
  if (isStoredTask.value) return;
  const nextLimit = Math.max(1, Number.parseInt(value, 10) || 1);
  rebalanceTrayLayout({ limit: nextLimit, message: `已按统一上限 ${nextLimit} 重新分配托盘。` });
};

const increaseTrayLimit = () => {
  if (isStoredTask.value) return;
  rebalanceTrayLayout({ limit: trayLimit.value + 1, message: `已按统一上限 ${trayLimit.value + 1} 重新分配托盘。` });
};

const decreaseTrayLimit = () => {
  if (isStoredTask.value) return;
  const nextLimit = Math.max(1, trayLimit.value - 1);
  rebalanceTrayLayout({ limit: nextLimit, message: `已按统一上限 ${nextLimit} 重新分配托盘。` });
};

const allowTrayDrag = () => !isStoredTask.value;

const startDragging = (sampleId, trayIndex) => {
  if (isStoredTask.value) return;
  draggingSampleId.value = sampleId;
  draggingFromTrayIndex.value = trayIndex;
  selectedSampleId.value = sampleId;
  selectedSampleTrayIndex.value = trayIndex;
};

const placeSelectedSampleToTray = (targetIndex) => {
  if (isStoredTask.value || selectedSampleId.value == null || selectedSampleTrayIndex.value < 0) return;
  const sourceTray = assignedTrays.value[selectedSampleTrayIndex.value];
  const targetTray = assignedTrays.value[targetIndex];
  if (!sourceTray || !targetTray || sourceTray === targetTray) return;
  if (targetTray.samples.length >= trayLimit.value) {
    feedback.value = "目标托盘已达到上限。";
    return;
  }
  const sampleIndex = sourceTray.samples.findIndex((sample) => sample.sampleId === selectedSampleId.value);
  if (sampleIndex < 0) return;
  const [sample] = sourceTray.samples.splice(sampleIndex, 1);
  targetTray.samples = normalizeTraySamples([...targetTray.samples, sample]);
  refreshEditableTrayState(`已将 ${sample.sampleNo} 移动到 ${targetTray.trayNo}`);
  activeTrayIndex.value = targetIndex;
  clearSelectedSample();
};

const swapTraySamples = (sourceSampleId, sourceTrayIndex, targetSampleId, targetTrayIndex) => {
  if (isStoredTask.value) return;
  const sourceTray = assignedTrays.value[sourceTrayIndex];
  const targetTray = assignedTrays.value[targetTrayIndex];
  if (!sourceTray || !targetTray) return;
  const sourceIndex = sourceTray.samples.findIndex((sample) => sample.sampleId === sourceSampleId);
  const targetIndex = targetTray.samples.findIndex((sample) => sample.sampleId === targetSampleId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const sourceSample = sourceTray.samples[sourceIndex];
  const targetSample = targetTray.samples[targetIndex];
  sourceTray.samples.splice(sourceIndex, 1, targetSample);
  targetTray.samples.splice(targetIndex, 1, sourceSample);
  refreshEditableTrayState(`已交换 ${sourceSample.sampleNo} 与 ${targetSample.sampleNo}`);
  activeTrayIndex.value = targetTrayIndex;
  clearSelectedSample();
};

const selectTraySample = (sampleId, trayIndex) => {
  if (isStoredTask.value) return;
  if (selectedSampleId.value == null) {
    selectedSampleId.value = sampleId;
    selectedSampleTrayIndex.value = trayIndex;
    activeTrayIndex.value = trayIndex;
    return;
  }
  if (selectedSampleId.value === sampleId) {
    clearSelectedSample();
    return;
  }
  swapTraySamples(selectedSampleId.value, selectedSampleTrayIndex.value, sampleId, trayIndex);
};

const handleTrayDrop = (targetIndex) => {
  if (isStoredTask.value || draggingSampleId.value == null || draggingFromTrayIndex.value < 0) return;
  selectedSampleId.value = draggingSampleId.value;
  selectedSampleTrayIndex.value = draggingFromTrayIndex.value;
  placeSelectedSampleToTray(targetIndex);
  draggingSampleId.value = null;
  draggingFromTrayIndex.value = -1;
};

const addInventoryTray = () => {
  if (isStoredTask.value) return;
  if (trayCapacityExceeded.value) {
    feedback.value = trayCapacityWarning.value;
    return;
  }
  if (availableInventory.value.length <= 0) {
    feedback.value = "当前没有可用空托盘。";
    return;
  }
  assignedTrays.value = normalizeEditableTrays(assignedTrays.value, trayLimit.value);
  const nextSerial = assignedTrays.value.length + 1;
  availableInventory.value = availableInventory.value.slice(1);
  assignedTrays.value.push({
    ...createTaskTrayRef(nextSerial, trayLimit.value),
    trayStatus: "已预分配",
    samples: [],
    barcode: null,
    barcodeData: null,
    loadQty: 0,
  });
  refreshEditableTrayState("已新增空托盘，可继续调整样品摆放。");
  activeTrayIndex.value = assignedTrays.value.length - 1;
};

const removeTray = (index) => {
  const tray = assignedTrays.value[index];
  if (!tray || isStoredTask.value) return;
  if (assignedTrays.value.length <= minimumTrayCount.value) {
    feedback.value = "当前托盘数量已是最小值，不能继续删除。";
    return;
  }
  rebalanceTrayLayout({
    limit: trayLimit.value,
    excludeTrayId: tray.trayId,
    message: `已删除 ${tray.trayNo}，并自动重新分配样品。`,
  });
};

const buildAllocationPayload = () => ({
  trayLimit: trayLimit.value,
  trays: assignedTrays.value.map((tray) => ({
    trayId: tray.trayId,
    sampleIds: tray.samples.map((sample) => sample.sampleId),
  })),
});

const buildBarcodeSvg = (value) => {
  const text = String(value || "--");
  const bars = Array.from(text).flatMap((char, index) => {
    const code = char.charCodeAt(0) + index;
    return code.toString(2).padStart(8, "0").split("").map((bit) => Number(bit));
  });
  const moduleWidth = 2;
  const height = 72;
  const quiet = 12;
  const width = (bars.length + quiet * 2) * moduleWidth;
  let cursor = quiet * moduleWidth;
  const rects = bars.map((bit) => {
    const rect = bit ? `<rect x="${cursor}" y="0" width="${moduleWidth}" height="${height}" fill="#0f172a" />` : "";
    cursor += moduleWidth;
    return rect;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-label="${text}">${rects}</svg>`;
};

const persistAllocation = async (showMessage = true) => {
  if (!selectedTaskId.value || isStoredTask.value) return false;
  if (trayCapacityExceeded.value) {
    if (showMessage) feedback.value = trayCapacityWarning.value;
    return false;
  }
  try {
    const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAllocationPayload()),
    });
    applyWorkspace(payload.workspace);
    if (showMessage) feedback.value = payload.message;
    return true;
  } catch (error) {
    if (showMessage) {
      feedback.value = error instanceof Error ? error.message : "托盘分配保存失败，请重试。";
    }
    return false;
  }
};

const closeBarcodeModal = () => {
  barcodeModalVisible.value = false;
};

const buildPrintDocument = () => {
  const cards = barcodePreviewItems.value.map((item) => `
    <article class="print-card">
      <header>
        <strong>${item.barcodeNo}</strong>
        <span>${item.trayNo}</span>
      </header>
      <div class="print-barcode">${item.barcodeSvg || ""}</div>
      <div class="print-meta">内容：${item.barcodeContent || "-"}</div>
      <div class="print-meta">样品：${item.samples.join(" / ") || "-"}</div>
    </article>
  `).join("");

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <title>接驳区条码打印</title>
        <style>
          body { font-family: "IBM Plex Sans", "Microsoft YaHei", sans-serif; padding: 24px; color: #10233f; }
          h1 { margin: 0 0 8px; font-size: 24px; }
          p { margin: 0 0 18px; color: #475569; }
          .print-grid { display: grid; gap: 16px; }
          .print-card { border: 1px solid #cbd5e1; border-radius: 16px; padding: 16px; break-inside: avoid; }
          .print-card header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
          .print-barcode { margin: 12px 0; }
          .print-meta { margin-top: 6px; font-size: 14px; }
        </style>
      </head>
      <body>
        <h1>接驳区条码打印</h1>
        <p>${currentTask.value?.taskNo || "--"} | ${currentTask.value?.experimentTypeText || currentTask.value?.taskType || "--"}</p>
        <section class="print-grid">${cards}</section>
      </body>
    </html>
  `;
};

const printBarcodePreview = async () => {
  const printFrame = document.createElement("iframe");
  printFrame.setAttribute("aria-hidden", "true");
  printFrame.style.position = "fixed";
  printFrame.style.right = "0";
  printFrame.style.bottom = "0";
  printFrame.style.width = "0";
  printFrame.style.height = "0";
  printFrame.style.border = "0";
  document.body.appendChild(printFrame);

  const frameDocument = printFrame.contentDocument || printFrame.contentWindow?.document;
  const frameWindow = printFrame.contentWindow;
  if (!frameDocument || !frameWindow) {
    document.body.removeChild(printFrame);
    throw new Error("打印载体初始化失败");
  }

  if (typeof frameDocument.open === "function") {
    frameDocument.open();
  }
  frameDocument.write(buildPrintDocument());
  frameDocument.close();
  await Promise.resolve();
  await nextTick();

  if (typeof frameWindow.focus === "function") {
    try {
      frameWindow.focus();
    } catch {}
  }
  if (typeof frameWindow.print === "function") {
    try {
      frameWindow.print();
    } catch {}
  }

  window.setTimeout(() => {
    if (printFrame.parentNode) {
      printFrame.parentNode.removeChild(printFrame);
    }
  }, 0);
};

const confirmBarcodePrint = async () => {
  if (!barcodePreviewItems.value.length) {
    feedback.value = "当前没有可打印的条码。";
    return;
  }
  try {
    await printBarcodePreview();
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "打印失败，请重试。";
    return;
  }
  barcodePrintConfirmed.value = true;
  barcodeModalVisible.value = false;
  feedback.value = "已发起条码打印。";
};

const printAllTrayBarcodes = async () => {
  if (!canPrint.value) return;
  printingAllBarcodes.value = true;
  try {
    if (!isStoredTask.value) {
      const saved = await persistAllocation(false);
      if (!saved) return;
    }
    const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/print-barcodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcodeType: "CODE128" }),
    });
    applyWorkspace(payload.workspace);
    barcodePreviewItems.value = (payload.barcodes || []).map((barcode) => {
      const tray = assignedTrays.value.find((item) => item.trayId === barcode.objectId);
      const barcodeValue = barcode.barcodeNo || tray?.trayNo || barcode.barcodeContent || "--";
      return {
        ...barcode,
        trayNo: tray?.trayNo || "--",
        samples: tray?.samples?.map((sample) => sample.sampleNo) || [],
        barcodeSvg: buildBarcodeSvg(barcodeValue),
      };
    });
    barcodePrintConfirmed.value = false;
    barcodeModalVisible.value = true;
    feedback.value = payload.message;
  } finally {
    printingAllBarcodes.value = false;
  }
};

const confirmStorage = async () => {
  if (!canConfirm.value) return;
  const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/confirm-storage`, { method: "POST" });
  const confirmedTaskId = selectedTaskId.value;
  const confirmedProgress = payload?.workspace?.task?.taskProgress || "已确认入库";
  applyWorkspace(payload.workspace);
  if (currentTask.value) {
    currentTask.value = {
      ...currentTask.value,
      taskStatus: storedStatus,
      taskProgress: confirmedProgress,
    };
  }
  if (confirmedTaskId) {
    updateOverviewTaskStatus(confirmedTaskId, storedStatus, confirmedProgress);
  }
  feedback.value = payload.message;
  await loadBootstrap();
  if (confirmedTaskId) {
    updateOverviewTaskStatus(confirmedTaskId, storedStatus, confirmedProgress);
  }
  taskStatusFilter.value = storedStatus;
};

const reloadWorkspace = async () => {
  if (!selectedTaskId.value) return;
  feedback.value = "";
  barcodeModalVisible.value = false;
  barcodePreviewItems.value = [];
  if (normalizeTaskStatus(currentTask.value?.taskStatus) === storedStatus) {
    const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/reload`, { method: "POST" });
    applyWorkspace(payload.workspace);
    updateOverviewTaskStatus(selectedTaskId.value, pendingStatus, payload?.workspace?.task?.taskProgress || "样品已送达，待打印条形码");
    feedback.value = payload.message;
    await loadBootstrap();
    taskStatusFilter.value = pendingStatus;
    return;
  }
  await loadWorkspace();
  await loadBootstrap();
  if (normalizeTaskStatus(currentTask.value?.taskStatus) === storedStatus) {
    taskStatusFilter.value = storedStatus;
  }
};

onMounted(loadBootstrap);
</script>

<style scoped src="./styles.css"></style>
