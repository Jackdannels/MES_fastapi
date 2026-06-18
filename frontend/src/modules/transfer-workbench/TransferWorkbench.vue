<template>
  <div class="transfer-area-screen" :class="{ 'is-embedded': embedded }">
    <header v-if="showModeHeader" class="page-header transfer-system-header">
      <div class="transfer-system-header__meta">
        <div class="eyebrow">{{ modeConfig.eyebrow }}</div>
        <h1 class="transfer-system-title">{{ modeConfig.headerTitle }}</h1>
        <p class="subtitle transfer-system-subtitle">{{ modeConfig.headerSubtitle }}</p>
      </div>
      <div class="header-actions transfer-system-actions">
        <button
          class="action-btn secondary"
          :class="{ 'is-active': activeWorkbenchView === 'overview' }"
          data-testid="handover-nav-overview"
          type="button"
          @click="setActiveWorkbenchView('overview')"
        >
          任务总览
        </button>
        <button
          class="action-btn secondary"
          :class="{ 'is-active': activeWorkbenchView === 'dispatch' }"
          data-testid="handover-nav-dispatch"
          type="button"
          @click="setActiveWorkbenchView('dispatch')"
        >
          样品出库
        </button>
        <button
          v-if="mode === 'handover'"
          class="action-btn tray-error-sample-trigger"
          data-testid="handover-error-sample"
          type="button"
          @click="errorSample.open()"
        >
          出错样品处理
        </button>
        <button class="action-btn secondary" data-testid="handover-logout" type="button" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <div class="transfer-area-shell" :class="{ 'is-embedded': embedded }">
      <template v-if="showDispatchPanel">
        <TransferDispatchPanel :dispatch-state="transferDispatch" />
      </template>

      <template v-else-if="viewMode === 'overview'">
        <section class="card transfer-overview-shell">
          <div v-if="showOverviewIntro" class="transfer-overview-title-row">
            <h2
              class="transfer-overview-page-title"
              :class="{ 'transfer-overview-page-title--compact': mode === 'pre-allocation' }"
            >
              {{ modeConfig.overviewTitle }}
            </h2>
          </div>

          <div class="transfer-overview-shell__head">
            <div v-if="showOverviewIntro">
              <h2>总任务清单</h2>
              <div class="muted">{{ modeConfig.overviewHint }}</div>
            </div>
            <div class="transfer-overview-kpis transfer-overview-status-actions">
              <button
                class="transfer-overview-kpi transfer-overview-kpi--filter"
                :class="{ 'is-active': taskStatusFilter === pendingStatus }"
                data-testid="transfer-filter-pending"
                type="button"
                @click="setTaskStatusFilter(pendingStatus)"
              >
                <span class="muted">未入库</span>
                <strong>{{ pendingTaskCount }}</strong>
              </button>
              <button
                class="transfer-overview-kpi transfer-overview-kpi--filter"
                :class="{ 'is-active': taskStatusFilter === storedStatus }"
                data-testid="transfer-filter-stored"
                type="button"
                @click="setTaskStatusFilter(storedStatus)"
              >
                <span class="muted">到货</span>
                <strong>{{ storedTaskCount }}</strong>
              </button>
              <button
                class="transfer-overview-kpi transfer-overview-kpi--filter"
                :class="{ 'is-active': taskStatusFilter === '' }"
                data-testid="transfer-filter-all"
                type="button"
                @click="setTaskStatusFilter('')"
              >
                <span class="muted">全部</span>
                <strong>{{ taskOverview.length }}</strong>
              </button>
            </div>
          </div>

          <div class="transfer-overview-toolbar-frame">
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
            </div>
            <AppFeedback
              class="transfer-overview-feedback"
              :message="feedback"
              :tone="feedbackTone"
              data-testid="transfer-overview-feedback"
              @close="clearWorkbenchFeedback"
            />
          </div>

          <div class="transfer-table">
            <div class="transfer-table__head transfer-table__head--compact">
              <div>序号</div>
              <button
                class="transfer-table__sort"
                data-sort
                :data-sort-dir="overviewTaskNoSortDirection"
                data-testid="transfer-sort-task-no"
                type="button"
                @click="toggleOverviewTaskNoSort"
              >
                任务编号
              </button>
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

              <template v-else-if="pagedTaskOverviewRows.length">
                <div
                  v-for="task in pagedTaskOverviewRows"
                  :key="task.rowKey"
                  class="transfer-table__row transfer-table__row--compact"
                  :class="{ 'transfer-table__row--placeholder': task.isPlaceholder }"
                  :data-testid="task.isPlaceholder ? `transfer-task-placeholder-${task.placeholderIndex}` : `transfer-task-row-${task.taskId}`"
                  :role="task.isPlaceholder ? 'presentation' : 'button'"
                  :tabindex="task.isPlaceholder ? -1 : 0"
                  @click="task.isPlaceholder ? undefined : openTask(task)"
                  @keydown.enter.prevent="task.isPlaceholder ? undefined : openTask(task)"
                  @keydown.space.prevent="task.isPlaceholder ? undefined : openTask(task)"
                >
                  <template v-if="!task.isPlaceholder">
                    <div>{{ task.seq }}</div>
                    <div class="transfer-table__main">{{ task.taskNo }}</div>
                    <div class="transfer-table__name">
                      <strong>{{ task.experimentTypeText || task.taskType || "-" }}</strong>
                      <span class="muted">{{ task.taskProgress || task.taskStatus || "-" }}</span>
                    </div>
                    <div class="transfer-table__codes">
                      <span
                        v-for="sampleCode in visibleOverviewSampleCodes(task)"
                        :key="sampleCode"
                        class="transfer-sample-code-chip"
                      >
                        {{ sampleCode }}
                      </span>
                    </div>
                    <div class="transfer-table__count">
                      <strong>{{ task.sampleCount || 0 }}</strong>
                      <button
                        v-if="overviewSampleOverflowCount(task) > 0"
                        class="transfer-sample-code-overflow"
                        :data-testid="`transfer-sample-code-overflow-${task.taskId}`"
                        :aria-label="`查看 ${task.taskNo || '任务'} 的全部样品编号`"
                        type="button"
                        @click.stop="openSampleCodesModal(task)"
                      >
                        +{{ overviewSampleOverflowCount(task) }}
                      </button>
                    </div>
                  </template>
                </div>
              </template>

              <div v-else class="transfer-table__empty" data-testid="transfer-empty-state">
                <strong>{{ taskOverview.length ? "当前筛选条件下没有任务" : "当前没有接驳任务" }}</strong>
                <span>{{ taskOverview.length ? "切换到到货或全部视图，或清空筛选条件后重试。" : "新任务到样后会自动出现在这里。" }}</span>
                <div class="transfer-empty-actions">
                  <button
                    v-if="taskOverview.length && taskStatusFilter !== storedStatus"
                    class="action-btn secondary"
                    data-testid="transfer-empty-show-stored"
                    type="button"
                    @click="setTaskStatusFilter(storedStatus)"
                  >
                    查看到货
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
            <AppPagination :current-page="currentTaskPage" :page-count="taskPageCount" @change="setTaskPage" />
          </div>
        </section>
      </template>

      <template v-else>
        <section class="card transfer-detail-shell" @click="handleDetailShellClick">
          <div class="transfer-detail-shell__top">
            <button class="action-btn secondary" type="button" @click="backToOverview">返回总览</button>
            <div class="transfer-detail-shell__title">
              <h2>{{ modeConfig.detailTitle }}</h2>
              <div class="muted">{{ isExperimentMode ? `${currentExperimentName} 托盘选择模式` : modeConfig.detailHint }}</div>
            </div>
          </div>

          <section class="transfer-task-header">
            <div class="transfer-task-header__summary">
              <div class="transfer-task-summary-card__label">任务编号</div>
              <strong data-testid="transfer-task-code" @click.stop="setAssignmentMode('task')">{{ currentTask?.taskNo || "--" }}</strong>
            </div>
            <div v-if="experiments.length" class="transfer-task-header__experiments">
              <button
                v-for="experiment in experiments"
                :key="experiment.experimentCode"
                class="transfer-task-experiment-pill"
                :class="{ active: activeAssignmentMode === experiment.experimentCode, 'is-disabled': experimentSelectionLocked }"
                :data-testid="`transfer-experiment-tab-${experiment.experimentCode}`"
                :aria-disabled="experimentSelectionLocked ? 'true' : 'false'"
                :title="experiment.experimentCode"
                type="button"
                @click.stop="setAssignmentMode(experiment.experimentCode)"
              >
                {{ resolveExperimentDisplayName(experiment) }}
              </button>
            </div>
          </section>

          <section class="transfer-tray-panel">
            <div class="transfer-panel-title transfer-panel-title--tray">
              <div>
                <h3>托盘栏位</h3>
                <div class="muted">
                  {{ trayInteractionHint }}
                </div>
              </div>

              <div class="transfer-tray-toolbar">
                <div class="transfer-tray-limit-toolbar">
                  <span class="transfer-tray-limit-toolbar__label">统一上限</span>
                  <div class="transfer-tray-limit-stepper">
                    <AppNumberInput :key="trayLimitInputKey" data-testid="transfer-tray-limit-input" min="1" :max="MAX_TRAY_LIMIT" step="1" :disabled="taskEditingLocked" :model-value="trayLimit" @change="setTrayLimit" />
                  </div>
                </div>

                <div class="transfer-panel-title__actions">
                  <span class="transfer-count-chip">剩余空托盘 {{ remainingTrayCount }}</span>
                  <button class="action-btn secondary transfer-use-tray-btn" type="button" :disabled="taskEditingLocked || remainingTrayCount <= 0 || trayCapacityExceeded" @click="addInventoryTray">新增托盘</button>
                </div>
              </div>
            </div>

            <div class="form-actions transfer-tray-actions transfer-tray-actions--top">
              <button class="action-btn transfer-print-all-btn" data-testid="transfer-print-barcodes" type="button" :disabled="!canPrint || printingAllBarcodes" @click="printAllTrayBarcodes">
                {{ printingAllBarcodes ? "生成中..." : `打印条形码（${loadedTrayCount}）` }}
              </button>
              <button class="action-btn secondary" data-testid="transfer-save-trays" type="button" :disabled="!canSaveAllocation" @click="persistAllocation()">保存托盘</button>
              <button v-if="modeConfig.allowConfirm" class="action-btn" type="button" :disabled="!canConfirm" @click="confirmStorage">确认入库</button>
              <button
                v-if="modeConfig.allowReset"
                class="action-btn secondary"
                :disabled="!canResetWorkspace"
                @click="reloadWorkspace"
              >
                {{ modeConfig.resetActionLabel }}
              </button>
            </div>

            <div v-if="trayCapacityExceeded" class="form-alert" data-testid="transfer-tray-capacity-warning">{{ trayCapacityWarning }}</div>
            <div v-else-if="allocationValidationMessage" class="form-alert" data-testid="transfer-allocation-validation">{{ allocationValidationMessage }}</div>

            <div
              v-if="selectionHintText"
              class="transfer-selected-sample-hint"
              :data-testid="lockedOperationHint ? 'transfer-locked-operation-hint' : 'transfer-selection-hint'"
            >
              {{ selectionHintText }}
            </div>

            <div class="transfer-tray-list transfer-tray-list--two-columns" data-testid="transfer-tray-list">
              <div
                v-for="(tray, index) in assignedTrays"
                :key="tray.trayId"
                class="sample-tray-card transfer-tray-card"
                :data-testid="`transfer-tray-card-${index}`"
                :class="{ 'is-active': index === activeTrayIndex, 'is-locked': taskEditingLocked, 'is-selected': isTraySelectedForCurrentExperiment(tray.trayNo) }"
                @click="setActiveTray(index)"
                @dragover.prevent="allowTrayDrag"
                @drop.prevent="handleTrayDrop(index)"
              >
                <div class="sample-tray-card-head">
                  <span>{{ tray.trayNo }}</span>
                  <button
                    v-if="isExperimentMode"
                    class="transfer-tray-select-toggle"
                    :class="{ 'is-selected': isTraySelectedForCurrentExperiment(tray.trayNo) }"
                    :data-testid="`transfer-tray-select-${index}`"
                    :aria-pressed="isTraySelectedForCurrentExperiment(tray.trayNo) ? 'true' : 'false'"
                    :disabled="allocationReadOnly"
                    type="button"
                    @click.stop="toggleExperimentTraySelection(index)"
                  >
                    <span class="transfer-tray-select-toggle__icon">{{ isTraySelectedForCurrentExperiment(tray.trayNo) ? "✓" : "" }}</span>
                  </button>
                </div>
                <div class="transfer-tray-card__subhead-row">
                  <div class="transfer-tray-card__subhead">托盘 #{{ index + 1 }}</div>
                  <div v-if="tray.experimentLabels?.length" class="transfer-tray-experiment-tags">
                    <span
                      v-for="(label, labelIndex) in tray.experimentLabels"
                      :key="`${tray.trayNo}-${label}`"
                      class="transfer-tray-experiment-tag"
                      :class="resolveExperimentTagTone(tray.experimentCodes?.[labelIndex] || label)"
                    >
                      {{ label }}
                    </span>
                  </div>
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
                    :draggable="canDragSamples"
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
                    <button
                      class="sample-tray-remove"
                      :class="{ 'is-disabled': taskEditingLocked }"
                      type="button"
                      :aria-disabled="taskEditingLocked ? 'true' : 'false'"
                      :disabled="isStoredTask || Boolean(reloadBlockedReason)"
                      @click.stop="removeTray(index)"
                    >
                      删除托盘
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="helper transfer-helper">{{ modeConfig.detailHelper }}</div>

            <div class="form-field">
              <label>托盘预览</label>
              <div class="transfer-tray-preview" data-testid="transfer-tray-preview">
                <div
                  v-for="tray in trayPreviewRows"
                  :key="tray.trayNo"
                  class="transfer-tray-preview__row"
                >
                  <span class="transfer-tray-preview__code">{{ tray.trayNo }}</span>
                  <span class="transfer-tray-preview__separator"> | </span>
                  <span class="transfer-tray-preview__meta">{{ tray.loadText }}</span>
                  <span class="transfer-tray-preview__separator"> | </span>
                  <span class="transfer-tray-preview__samples">{{ tray.sampleText }}</span>
                </div>
              </div>
            </div>

            <AppFeedback
              :message="feedback"
              :tone="feedbackTone"
              data-testid="transfer-detail-feedback"
              @close="clearWorkbenchFeedback"
            />
          </section>
        </section>
      </template>
    </div>

    <div v-if="barcodeModalVisible" class="transfer-modal">
      <div class="transfer-modal__backdrop" @click="closeBarcodeModal"></div>
      <div class="transfer-modal__panel transfer-barcode-preview-modal" data-testid="barcode-modal">
        <div class="transfer-modal__head">
          <div>
            <h3>条形码信息</h3>
            <div class="muted">{{ currentTask?.taskNo || "--" }} | {{ currentTask?.experimentTypeText || currentTask?.taskType || "--" }}</div>
          </div>
          <button class="action-btn secondary" type="button" @click="closeBarcodeModal">关闭</button>
        </div>
        <div class="transfer-barcode-preview-summary">
          <span>待打印托盘</span>
          <strong>{{ barcodePreviewItems.length }}</strong>
          <span>当前任务</span>
          <strong>{{ currentTask?.taskNo || "--" }}</strong>
        </div>
        <div class="transfer-modal__list transfer-barcode-preview-list">
          <article v-for="item in barcodePreviewItems" :key="item.barcodeId" class="transfer-modal__item transfer-barcode-preview-card">
            <div class="transfer-barcode-preview-card__top">
              <div>
                <span class="transfer-barcode-preview-card__eyebrow">托盘条码</span>
                <strong>{{ item.barcodeDisplayNo }}</strong>
              </div>
              <span class="transfer-barcode-preview-count">{{ item.samples.length }} 件样品</span>
            </div>
            <div v-if="item.barcodeSvg" class="transfer-modal__barcode transfer-barcode-preview-code" v-html="item.barcodeSvg"></div>
            <div class="transfer-barcode-preview-meta">
              <div>
                <span>托盘</span>
                <strong>{{ item.trayNo }}</strong>
              </div>
              <div>
                <span>样品数：</span>
                <strong>{{ item.samples.length }}</strong>
              </div>
            </div>
            <div class="transfer-barcode-preview-detail">
              <span>内容：</span>
              <strong>{{ item.summaryText || "-" }}</strong>
            </div>
            <div class="transfer-barcode-preview-samples">
              <span>样品编号：</span>
              <strong>{{ item.sampleText || "-" }}</strong>
            </div>
            <div v-if="item.experimentLabels?.length" class="transfer-modal__experiment-tags">
              <span
                v-for="(label, labelIndex) in item.experimentLabels"
                :key="`${item.barcodeId}-${label}-${labelIndex}`"
                class="transfer-tray-experiment-tag"
                :class="resolveExperimentTagTone(item.experimentCodes?.[labelIndex] || label)"
              >
                {{ label }}
              </span>
            </div>
          </article>
        </div>
        <div class="transfer-modal__actions">
          <button class="action-btn" type="button" data-testid="barcode-modal-confirm-print" @click="confirmBarcodePrint">确认打印</button>
        </div>
      </div>
    </div>

    <div v-if="sampleCodesModalVisible" class="transfer-modal transfer-modal--compact">
      <div class="transfer-modal__backdrop" @click="closeSampleCodesModal"></div>
      <div class="transfer-modal__panel transfer-sample-codes-modal" data-testid="transfer-sample-codes-modal">
        <div class="transfer-modal__head">
          <div>
            <h3>全部样品编号</h3>
            <div class="muted">
              {{ sampleCodesModalTask?.taskNo || "--" }} | 共 {{ sampleCodesModalSampleCodes.length }} 个样品
            </div>
          </div>
          <button class="action-btn secondary" type="button" @click="closeSampleCodesModal">关闭</button>
        </div>
        <div class="transfer-sample-codes-modal__grid">
          <span
            v-for="sampleCode in sampleCodesModalSampleCodes"
            :key="sampleCode"
            class="transfer-sample-code-chip"
          >
            {{ sampleCode }}
          </span>
        </div>
      </div>
    </div>

    <ModuleExitDialog
      v-if="showModeHeader"
      :current-module="'handover'"
      :open="exitDialogOpen"
      @close="closeExitDialog"
      @logout="confirmLogout"
      @switch-module="switchModule"
    />
    <TrayErrorSampleDialog :model="errorSample" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppNumberInput from "@/components/shared/AppNumberInput.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import ModuleExitDialog from "@/components/shared/ModuleExitDialog.vue";
import TrayErrorSampleDialog from "@/components/shared/TrayErrorSampleDialog.vue";
import { logoutSession, resolveModuleHome, switchSessionModule } from "@/auth";
import { buildApiUrl, getFrontendApiBaseUrl } from "@/lib/apiBase";
import { buildExperimentTypeOptions, matchesExperimentTypeFilter } from "@/lib/experimentTypes";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { useTrayErrorSampleHandling } from "@/composables/useTrayErrorSampleHandling";
import { useFeedback } from "@/composables/useFeedback";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import { buildCode128Svg } from "../handover-system/barcode.js";
import TransferDispatchPanel from "./TransferDispatchPanel.vue";
import { useTransferDispatch } from "./useTransferDispatch";

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
  mode: {
    type: String,
    default: "handover",
  },
  showHeader: {
    type: Boolean,
    default: true,
  },
});

const API_BASE_URL = getFrontendApiBaseUrl();
const router = useRouter();
const pendingStatus = "未入库";
const storedStatus = "到货";
const MAX_TRAY_LIMIT = 99;

const activeWorkbenchView = ref("overview");
const viewMode = ref("overview");
const searchText = ref("");
const taskTypeFilter = ref("");
const taskStatusFilter = ref(pendingStatus);
const taskOverview = ref([]);
const selectedTaskId = ref(null);
const currentTask = ref(null);
const assignedTrays = ref([]);
const experiments = ref([]);
const activeAssignmentMode = ref("task");
const draftExperimentTraySelections = ref({});
const availableInventory = ref([]);
const trayLimit = ref(4);
const trayLimitInputVersion = ref(0);
const trayLimitInputKey = computed(() => `tray-limit-${trayLimit.value}-${trayLimitInputVersion.value}`);
const overviewTaskNoSortDirection = ref("");
const activeTrayIndex = ref(-1);
const armedTrayIndex = ref(-1);
const draggingSampleId = ref(null);
const draggingFromTrayIndex = ref(-1);
const selectedSampleId = ref(null);
const selectedSampleTrayIndex = ref(-1);
const isBootstrapLoading = ref(false);
const bootstrapError = ref("");
const allocationSaved = ref(false);
const workbenchFeedback = useFeedback();
const feedback = workbenchFeedback.message;
const feedbackTone = workbenchFeedback.tone;
const showWorkbenchFeedback = workbenchFeedback.show;
const clearWorkbenchFeedback = workbenchFeedback.clear;
const printingAllBarcodes = ref(false);
const barcodeModalVisible = ref(false);
const barcodePreviewItems = ref([]);
const barcodePrintConfirmed = ref(false);
const sampleCodesModalVisible = ref(false);
const sampleCodesModalTask = ref(null);
const lockedOperationHint = ref("");
const SAVED_ALLOCATION_HINT = "托盘已保存，若想更改请重新入库";
const taskPage = ref(1);
const overviewPageSize = ref(3);
const pendingTaskCount = ref(0);
const storedTaskCount = ref(0);
const exitDialogOpen = ref(false);
const transferDispatch = useTransferDispatch();
let flushPendingStorageRefresh = () => false;
let hasPendingSamplesRefresh = false;

watch([searchText, taskTypeFilter], () => {
  taskPage.value = 1;
});

const errorSample = useTrayErrorSampleHandling({
  onChanged: () => refreshTransferWorkspaceAfterTrayChange(),
  onClose: async () => {
    await refreshTransferWorkspaceAfterTrayChange();
    flushPendingRealtimeRefresh();
  },
});
const MODE_CONFIGS = {
  handover: {
    allowConfirm: true,
    allowReset: true,
    detailHelper: "默认上限为 4，完成实验匹配并保存托盘后即可确认入库；到货任务仍可打印条码，但不允许再调整托盘。",
    detailHint: "支持触控先点托盘再点样品，也支持样品换位",
    detailTitle: "托盘分装与入库",
    eyebrow: "接驳区系统",
    headerSubtitle: "处理接驳区到样确认、托盘分装与交接。",
    headerTitle: "接驳区工作台",
    overviewHint: "样品送达后可调整托盘分装，完成实验匹配并保存托盘后即可确认入库，打印条码为可选操作。",
    overviewTitle: "接驳任务总览",
    printTitle: "接驳区条码打印",
    resetActionLabel: "重新入库",
  },
  "pre-allocation": {
    allowConfirm: false,
    allowReset: true,
    detailHelper: "当前为预接驳预分装模式，可保存托盘方案与打印条码；正式入库由接驳区工作台执行。到货任务仅允许查看与打印。",
    detailHint: "支持鼠标拖拽与点击快速调整托盘",
    detailTitle: "任务样品分配管理",
    eyebrow: "样品管理",
    headerSubtitle: "在中控系统中预分配托盘方案，并同步给接驳区工作台。",
    headerTitle: "样品预分装",
    overviewHint: "通过总任务清单进入任务样品分配管理。可保存托盘方案、打印条码并同步至接驳区，正式入库由接驳区执行。",
    overviewTitle: "样品预分装",
    printTitle: "样品预分装条码打印",
    resetActionLabel: "重新分配",
  },
};
const EXPERIMENT_TAG_TONES = [
  { bg: "rgba(14, 165, 233, 0.14)", border: "rgba(14, 165, 233, 0.45)", color: "#7dd3fc" },
  { bg: "rgba(16, 185, 129, 0.14)", border: "rgba(16, 185, 129, 0.4)", color: "#86efac" },
  { bg: "rgba(245, 158, 11, 0.16)", border: "rgba(245, 158, 11, 0.44)", color: "#facc15" },
  { bg: "rgba(244, 114, 182, 0.15)", border: "rgba(236, 72, 153, 0.42)", color: "#f9a8d4" },
  { bg: "rgba(168, 85, 247, 0.16)", border: "rgba(147, 51, 234, 0.44)", color: "#c4b5fd" },
  { bg: "rgba(239, 68, 68, 0.13)", border: "rgba(239, 68, 68, 0.38)", color: "#fca5a5" },
];
const XML_ESCAPE_MAP = {
  "&": "&amp;",
  "\"": "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};

const normalizeTaskStatus = (status) => {
  const text = String(status || "").trim();
  if (text === storedStatus) return storedStatus;
  if (text === pendingStatus) return pendingStatus;
  return text;
};
const BARCODE_SAMPLE_PREVIEW_LIMIT = 8;
const OVERVIEW_SAMPLE_CODE_LIMIT = 12;

const normalizeText = (value) => String(value || "").trim();

const splitSampleCodesText = (value) => normalizeText(value)
  .split(/[、,，/|\s]+/u)
  .map((sampleCode) => normalizeText(sampleCode))
  .filter(Boolean);

const normalizeSampleCodeList = (sampleCodes) => (Array.isArray(sampleCodes)
  ? sampleCodes.map((sampleCode) => normalizeText(sampleCode)).filter(Boolean)
  : []);

const resolveOverviewSampleCodes = (task, { full = false } = {}) => {
  if (!full) {
    const previewCodes = normalizeSampleCodeList(task?.sampleCodePreview);
    if (previewCodes.length) {
      return previewCodes;
    }
  }
  const sampleCodes = normalizeSampleCodeList(task?.sampleCodes);
  if (sampleCodes.length && (!full || !task?.sampleCodeSearchText)) {
    return sampleCodes;
  }
  const searchCodes = splitSampleCodesText(task?.sampleCodeSearchText);
  if (searchCodes.length) {
    return searchCodes;
  }
  return splitSampleCodesText(task?.sampleCodesText);
};

const resolveOverviewSampleCodeCount = (task) => {
  const explicitCount = Number.parseInt(task?.sampleCodeCount, 10);
  if (Number.isFinite(explicitCount) && explicitCount >= 0) {
    return explicitCount;
  }
  return resolveOverviewSampleCodes(task, { full: true }).length;
};

const visibleOverviewSampleCodes = (task) => resolveOverviewSampleCodes(task).slice(0, OVERVIEW_SAMPLE_CODE_LIMIT);

const overviewSampleOverflowCount = (task) => Math.max(0, resolveOverviewSampleCodeCount(task) - visibleOverviewSampleCodes(task).length);

const sampleCodesModalSampleCodes = computed(() => resolveOverviewSampleCodes(sampleCodesModalTask.value, { full: true }));

const buildOverviewSearchText = (task) => {
  const sampleSearchText = normalizeText(task?.sampleCodeSearchText)
    || normalizeText(task?.sampleCodesText)
    || normalizeSampleCodeList(task?.sampleCodes).join(" ");
  return [
    task?.taskNo,
    task?.taskType,
    task?.experimentTypeText,
    task?.taskProgress,
    sampleSearchText,
  ].join(" ").toLowerCase();
};

const normalizeTaskRecord = (task) => {
  const sampleCodePreview = normalizeSampleCodeList(task?.sampleCodePreview).length
    ? normalizeSampleCodeList(task?.sampleCodePreview)
    : normalizeSampleCodeList(task?.sampleCodes).slice(0, OVERVIEW_SAMPLE_CODE_LIMIT);
  return {
    ...task,
    taskStatus: normalizeTaskStatus(task?.taskStatus),
    sampleCodePreview,
    sampleCodeSearchText: normalizeText(task?.sampleCodeSearchText) || normalizeText(task?.sampleCodesText),
    overviewSearchText: buildOverviewSearchText({
      ...task,
      sampleCodePreview,
      sampleCodeSearchText: normalizeText(task?.sampleCodeSearchText) || normalizeText(task?.sampleCodesText),
    }),
  };
};

const resolveExperimentDisplayName = (experiment) =>
  normalizeText(experiment?.requiredDevice || experiment?.required_device || experiment?.experimentType || experiment?.experiment_type)
  || normalizeText(experiment?.experimentName || experiment?.experiment_name)
  || normalizeText(experiment?.experimentCode || experiment?.experiment_code)
  || "实验";

const encodeHtml = (value) => String(value || "").replace(/[&"<>]/g, (char) => XML_ESCAPE_MAP[char] || char);

const formatSampleCodePreview = (sampleCodes, limit = BARCODE_SAMPLE_PREVIEW_LIMIT) => {
  const codes = Array.isArray(sampleCodes)
    ? sampleCodes.map((sampleCode) => normalizeText(sampleCode)).filter(Boolean)
    : [];
  if (!codes.length) {
    return "-";
  }
  const visibleCodes = codes.slice(0, limit);
  return `${visibleCodes.join(" / ")}${codes.length > limit ? " / ..." : ""}`;
};

const closeSampleCodesModal = () => {
  sampleCodesModalVisible.value = false;
  sampleCodesModalTask.value = null;
  flushPendingRealtimeRefresh();
};

const openSampleCodesModal = (task) => {
  sampleCodesModalTask.value = task;
  sampleCodesModalVisible.value = true;
};

const resolveExperimentTagToneIndex = (value) => {
  const text = String(value || "").trim();
  const hash = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return hash % EXPERIMENT_TAG_TONES.length;
};

const resolveExperimentTagTone = (value) => {
  return `transfer-tray-experiment-tag--tone-${resolveExperimentTagToneIndex(value) + 1}`;
};

const buildExperimentTagPrintCss = () => EXPERIMENT_TAG_TONES.map((tone, index) => `
          .transfer-tray-experiment-tag--tone-${index + 1} {
            --tray-experiment-bg: ${tone.bg};
            --tray-experiment-border: ${tone.border};
            --tray-experiment-color: ${tone.color};
          }
`).join("");

const buildPrintExperimentTags = (item) => {
  const tags = (item.experimentLabels || []).map((label, index) => `
        <span class="transfer-tray-experiment-tag ${resolveExperimentTagTone(item.experimentCodes?.[index] || label)}">${encodeHtml(label)}</span>
      `).join("");
  if (!tags) {
    return "";
  }
  return `<div class="transfer-tray-experiment-tags print-experiment-tags">${tags}</div>`;
};

const normalizeTrayLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Math.min(MAX_TRAY_LIMIT, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
};

const formatApiErrorDetail = (detail) => {
  if (typeof detail === "string") {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (item && typeof item === "object") {
          const path = Array.isArray(item.loc) ? item.loc.join(".") : "";
          const message = String(item.msg || item.message || item.detail || "").trim();
          return [path, message].filter(Boolean).join(": ");
        }
        return "";
      })
      .filter(Boolean)
      .join("；");
  }
  if (detail && typeof detail === "object") {
    return String(detail.message || detail.msg || detail.detail || "").trim();
  }
  return "";
};

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
    throw new Error(formatApiErrorDetail(payload?.detail) || formatApiErrorDetail(payload?.message) || `请求失败（${response.status}）`);
  }
  return payload || {};
};

const isArchivedWorkspaceError = (error) => String(error instanceof Error ? error.message : error || "").includes("归档");

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
  const module = typeof targetModule === "string" ? targetModule : targetModule?.module;
  const labName = typeof targetModule === "object" && targetModule !== null ? targetModule.labName : "";
  const result = await switchSessionModule(module);
  if (!result.ok) {
    return;
  }
  if (module === "laboratory" && labName) {
    await router.push({ path: "/laboratory", query: { lab: labName } });
    return;
  }
  await router.push(resolveModuleHome(module));
};

const modeConfig = computed(() => MODE_CONFIGS[props.mode] || MODE_CONFIGS.handover);
const showModeHeader = computed(() => props.showHeader && props.mode === "handover");
const showDispatchPanel = computed(() => props.mode === "handover" && activeWorkbenchView.value === "dispatch");
const showOverviewIntro = computed(() => props.mode !== "pre-allocation");
const taskTypeOptions = computed(() =>
  buildExperimentTypeOptions(taskOverview.value.map((task) => task.experimentTypeText || task.taskType)),
);
const filteredTaskOverview = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  return taskOverview.value.filter((task) => {
    const typeMatch = matchesExperimentTypeFilter(taskTypeFilter.value, task.experimentTypeText, task.taskType);
    const statusMatch = !taskStatusFilter.value || normalizeTaskStatus(task.taskStatus) === taskStatusFilter.value;
    const searchTextPool = task.overviewSearchText || buildOverviewSearchText(task);
    return typeMatch && statusMatch && (!query || searchTextPool.includes(query));
  });
});
const sortedTaskOverview = computed(() => {
  const rows = filteredTaskOverview.value.slice();
  if (!overviewTaskNoSortDirection.value) {
    return rows;
  }
  const directionFactor = overviewTaskNoSortDirection.value === "desc" ? -1 : 1;
  return rows.sort((left, right) => {
    const taskNoCompare = String(left?.taskNo || "").localeCompare(String(right?.taskNo || ""), "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    });
    if (taskNoCompare !== 0) {
      return taskNoCompare * directionFactor;
    }
    const leftSeq = Number.parseInt(left?.seq, 10);
    const rightSeq = Number.parseInt(right?.seq, 10);
    return ((Number.isFinite(leftSeq) ? leftSeq : 0) - (Number.isFinite(rightSeq) ? rightSeq : 0)) * directionFactor;
  });
});
const taskPageCount = computed(() => Math.max(1, Math.ceil(sortedTaskOverview.value.length / overviewPageSize.value)));
const currentTaskPage = computed(() => Math.min(taskPage.value, taskPageCount.value));
const pagedTaskOverview = computed(() => sortedTaskOverview.value.slice((currentTaskPage.value - 1) * overviewPageSize.value, currentTaskPage.value * overviewPageSize.value));
const pagedTaskOverviewRows = computed(() => {
  const rows = pagedTaskOverview.value.map((task) => ({ ...task, rowKey: `task-${task.taskId}` }));
  if (!rows.length) {
    return rows;
  }
  const placeholderCount = Math.max(0, overviewPageSize.value - rows.length);
  return [
    ...rows,
    ...Array.from({ length: placeholderCount }, (_, index) => ({
      isPlaceholder: true,
      placeholderIndex: index + 1,
      rowKey: `placeholder-${currentTaskPage.value}-${index}`,
    })),
  ];
});
const rawAvailableInventoryCount = computed(() => availableInventory.value.length);
const totalAssignedSampleCount = computed(() => assignedTrays.value.reduce((sum, tray) => sum + tray.samples.length, 0));
const minimumTrayCount = computed(() => Math.max(1, Math.ceil(totalAssignedSampleCount.value / Math.max(1, trayLimit.value))));
const loadedTrayCount = computed(() => assignedTrays.value.filter((tray) => tray.samples.length > 0).length);
const isStoredTask = computed(() => normalizeTaskStatus(currentTask.value?.taskStatus) === storedStatus);
const isExperimentMode = computed(() => activeAssignmentMode.value !== "task");
const currentExperimentCode = computed(() => (isExperimentMode.value ? activeAssignmentMode.value : ""));
const currentExperimentName = computed(() => resolveExperimentDisplayName(experiments.value.find((item) => item.experimentCode === currentExperimentCode.value)));
const allocationReadOnly = computed(() => isStoredTask.value || allocationSaved.value);
const experimentSelectionLocked = computed(() => allocationReadOnly.value);
const taskEditingLocked = computed(() => allocationReadOnly.value || isExperimentMode.value);
const canDragSamples = computed(() => props.mode === "pre-allocation" && !taskEditingLocked.value);
const parseNonNegativeCount = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const explicitMaxAssignableTrayCount = computed(() => parseNonNegativeCount(currentTask.value?.maxAssignableTrayCount));
const explicitRemainingTrayCount = computed(() => parseNonNegativeCount(currentTask.value?.remainingTrayCount));
const hasTrayCapacityLimit = computed(() => explicitMaxAssignableTrayCount.value != null || explicitRemainingTrayCount.value != null);
const maxAssignableTrayCount = computed(() => {
  if (explicitMaxAssignableTrayCount.value != null) {
    return explicitMaxAssignableTrayCount.value;
  }
  if (explicitRemainingTrayCount.value != null) {
    return explicitRemainingTrayCount.value;
  }
  return loadedTrayCount.value + rawAvailableInventoryCount.value;
});
const remainingTrayCount = computed(() => {
  const remainingAfterCurrentTask = Math.max(0, maxAssignableTrayCount.value - loadedTrayCount.value);
  return Math.min(rawAvailableInventoryCount.value, remainingAfterCurrentTask);
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
  && loadedTrayCount.value > 0
  && allocationSaved.value
  && hasCompleteExperimentTrayAllocation.value
  && !trayCapacityExceeded.value
));
const loadedTrayNos = computed(() => assignedTrays.value
  .filter((tray) => Array.isArray(tray.samples) && tray.samples.length > 0)
  .map((tray) => tray.trayNo));
const requiresExperimentTrayAllocation = computed(() => experiments.value.length > 0);
const everyExperimentHasTray = computed(() => experiments.value.every((experiment) => (
  (draftExperimentTraySelections.value[experiment.experimentCode] || []).length > 0
)));
const everyLoadedTrayHasExperiment = computed(() => loadedTrayNos.value.every((trayNo) => (
  experiments.value.some((experiment) => (draftExperimentTraySelections.value[experiment.experimentCode] || []).includes(trayNo))
)));
const hasCompleteExperimentTrayAllocation = computed(() => (
  loadedTrayNos.value.length > 0
  && (!requiresExperimentTrayAllocation.value || (everyExperimentHasTray.value && everyLoadedTrayHasExperiment.value))
));
const allocationValidationMessage = computed(() => {
  if (!selectedTaskId.value || isStoredTask.value) {
    return "";
  }
  if (trayCapacityExceeded.value) {
    return trayCapacityWarning.value;
  }
  if (!requiresExperimentTrayAllocation.value) {
    return "";
  }
  if (!everyExperimentHasTray.value) {
    return "每个实验都必须至少分配一个托盘。";
  }
  if (!everyLoadedTrayHasExperiment.value) {
    return "有样品的托盘必须至少分配一个实验。";
  }
  return "";
});
const canSaveAllocation = computed(() => (
  Boolean(selectedTaskId.value)
  && !isStoredTask.value
  && !allocationSaved.value
  && !trayCapacityExceeded.value
  && (props.mode === "pre-allocation" || !isExperimentMode.value)
  && hasCompleteExperimentTrayAllocation.value
));
const canPersistAllocationDraft = computed(() => (
  Boolean(selectedTaskId.value)
  && !isStoredTask.value
  && !allocationSaved.value
  && !trayCapacityExceeded.value
  && hasCompleteExperimentTrayAllocation.value
));
const canConfirm = computed(() => (
  Boolean(selectedTaskId.value)
  && loadedTrayCount.value > 0
  && (allocationSaved.value || (requiresExperimentTrayAllocation.value && canPersistAllocationDraft.value))
  && !isStoredTask.value
  && !trayCapacityExceeded.value
  && hasCompleteExperimentTrayAllocation.value
));
const reloadBlockedReason = computed(() => {
  if (!currentTask.value?.reloadBlocked) {
    return "";
  }
  return props.mode === "pre-allocation"
    ? "该任务已有托盘开始实验，不能重新分配。"
    : "该任务已有托盘开始实验，不能重新入库。";
});
const canResetWorkspace = computed(() => {
  if (!selectedTaskId.value) {
    return false;
  }
  if (reloadBlockedReason.value) {
    return false;
  }
  if (props.mode === "pre-allocation") {
    return !isStoredTask.value;
  }
  return true;
});
const trayPreviewRows = computed(() => assignedTrays.value.map((tray) => ({
  trayNo: tray.trayNo,
  loadText: `${tray.samples.length} / ${trayLimit.value}`,
  sampleText: tray.samples.map((sample) => sample.sampleNo).join(" / ") || "暂无样品",
})));
const selectedSampleLabel = computed(() => {
  for (const tray of assignedTrays.value) {
    const sample = tray.samples.find((item) => item.sampleId === selectedSampleId.value);
    if (sample) return sample.sampleNo;
  }
  return "";
});
const quickMoveTrayLabel = computed(() => assignedTrays.value[armedTrayIndex.value]?.trayNo || "");
const trayInteractionHint = computed(() => {
  if (reloadBlockedReason.value) {
    return `${reloadBlockedReason.value} 当前仅支持查看与打印。`;
  }
  if (isStoredTask.value) {
    return "到货任务仅支持查看与打印。";
  }
  if (allocationSaved.value) {
    return `当前托盘方案已保存，点击${modeConfig.value.resetActionLabel}后才能继续调整。`;
  }
  if (isExperimentMode.value) {
    return `当前为 ${currentExperimentName.value} 托盘选择模式，只能选择托盘编号。`;
  }
  if (props.mode === "pre-allocation") {
    return "支持鼠标拖拽样品到托盘，也支持先点样品再点托盘或先点托盘再点样品快速调整。";
  }
  return "触控可先点目标托盘，再点其他托盘中的样品完成移入；点一个样品再点另一个样品可交换位置。";
});
const selectionHintText = computed(() => {
  if (lockedOperationHint.value) {
    return lockedOperationHint.value;
  }
  if (selectedSampleLabel.value) {
    return `已选样品：${selectedSampleLabel.value}`;
  }
  if (!isExperimentMode.value && quickMoveTrayLabel.value) {
    return `目标托盘：${quickMoveTrayLabel.value}，点击其他托盘中的样品可快速移入。`;
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

const rebuildTrayExperimentLabels = () => {
  const experimentNameMap = Object.fromEntries(experiments.value.map((experiment) => [experiment.experimentCode, resolveExperimentDisplayName(experiment)]));
  assignedTrays.value = assignedTrays.value.map((tray) => {
    const experimentCodes = Object.entries(draftExperimentTraySelections.value)
      .filter(([, trayNos]) => Array.isArray(trayNos) && trayNos.includes(tray.trayNo))
      .map(([experimentCode]) => experimentCode);
    return {
      ...tray,
      experimentCodes,
      experimentLabels: experimentCodes.map((experimentCode) => experimentNameMap[experimentCode] || experimentCode),
    };
  });
};

const resetExperimentAssignmentsForTrayLayout = () => {
  const onlyTrayNo = assignedTrays.value.length === 1 ? assignedTrays.value[0]?.trayNo : "";
  draftExperimentTraySelections.value = Object.fromEntries(
    experiments.value.map((experiment) => [experiment.experimentCode, onlyTrayNo ? [onlyTrayNo] : []]),
  );
  rebuildTrayExperimentLabels();
};

const encodeTaskTrayId = (serial) => 1000 + serial;
const sampleSort = (left, right) => String(left?.sampleNo || "").localeCompare(String(right?.sampleNo || ""));

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
  resetExperimentAssignmentsForTrayLayout();
  barcodePrintConfirmed.value = false;
  allocationSaved.value = false;
  lockedOperationHint.value = "";
  if (message) {
    showWorkbenchFeedback(message, "info");
  }
};

const rebalanceTrayLayout = ({ limit = trayLimit.value, message = "" } = {}) => {
  const normalizedLimit = normalizeTrayLimit(limit);
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
  activeTrayIndex.value = -1;
  armedTrayIndex.value = -1;
  clearSelectedSample();
  resetExperimentAssignmentsForTrayLayout();
  barcodePrintConfirmed.value = false;
  allocationSaved.value = false;
  lockedOperationHint.value = "";
  if (message) {
    showWorkbenchFeedback(message, "info");
  }
};

const resetInteractiveState = () => {
  activeTrayIndex.value = -1;
  armedTrayIndex.value = -1;
  draggingSampleId.value = null;
  draggingFromTrayIndex.value = -1;
  selectedSampleId.value = null;
  selectedSampleTrayIndex.value = -1;
  barcodePrintConfirmed.value = false;
  lockedOperationHint.value = "";
};

const applyWorkspace = (workspace) => {
  currentTask.value = workspace?.task ? normalizeTaskRecord(workspace.task) : null;
  experiments.value = Array.isArray(workspace?.experiments) ? workspace.experiments.map((experiment) => ({ ...experiment })) : [];
  draftExperimentTraySelections.value = Object.fromEntries(
    experiments.value.map((experiment) => [experiment.experimentCode, [...(experiment.assignedTrayNos || [])]]),
  );
  trayLimit.value = normalizeTrayLimit(workspace?.task?.trayLimit || 4);
  assignedTrays.value = (workspace?.assignedTrays || []).map((tray) => ({
    ...tray,
    samples: Array.isArray(tray.samples)
      ? tray.samples.map((sample) => ({
          ...sample,
          sampleStatus: normalizeTaskStatus(workspace?.task?.taskStatus) === storedStatus ? storedStatus : (sample.sampleStatus || pendingStatus),
        }))
      : [],
    trayStatus: normalizeTaskStatus(workspace?.task?.taskStatus) === storedStatus ? storedStatus : tray.trayStatus,
    experimentLabels: Array.isArray(tray.experimentLabels) ? [...tray.experimentLabels] : [],
    experimentCodes: Array.isArray(tray.experimentCodes) ? [...tray.experimentCodes] : [],
  }));
  availableInventory.value = normalizeInventoryRefs(workspace?.trayInventory || [], trayLimit.value);
  allocationSaved.value = Boolean(workspace?.allocationSaved);
  activeAssignmentMode.value = "task";
  rebuildTrayExperimentLabels();
  resetInteractiveState();
};

const applyWorkspaceSaveGuards = (workspace) => {
  if (!workspace?.task || !currentTask.value) {
    return;
  }
  const nextTask = normalizeTaskRecord(workspace.task);
  currentTask.value = {
    ...currentTask.value,
    taskStatus: nextTask.taskStatus,
    taskProgress: nextTask.taskProgress,
    totalTrayCount: nextTask.totalTrayCount,
    remainingTrayCount: nextTask.remainingTrayCount,
    maxAssignableTrayCount: nextTask.maxAssignableTrayCount,
    requiredTrayCount: nextTask.requiredTrayCount,
    trayCapacityExceeded: nextTask.trayCapacityExceeded,
    trayCapacityMessage: nextTask.trayCapacityMessage,
    reloadBlocked: nextTask.reloadBlocked,
    reloadBlockedReason: nextTask.reloadBlockedReason,
  };
  availableInventory.value = normalizeInventoryRefs(workspace.trayInventory || [], trayLimit.value);
  allocationSaved.value = Boolean(workspace.allocationSaved);
};

const clearWorkspace = () => {
  selectedTaskId.value = null;
  currentTask.value = null;
  experiments.value = [];
  draftExperimentTraySelections.value = {};
  trayLimit.value = 4;
  assignedTrays.value = [];
  availableInventory.value = [];
  allocationSaved.value = false;
  activeAssignmentMode.value = "task";
  barcodeModalVisible.value = false;
  barcodePreviewItems.value = [];
  sampleCodesModalVisible.value = false;
  sampleCodesModalTask.value = null;
  resetInteractiveState();
};

const loadBootstrap = async ({ silent = false } = {}) => {
  const showBlockingLoading = !silent || taskOverview.value.length === 0;
  if (showBlockingLoading) {
    isBootstrapLoading.value = true;
  }
  bootstrapError.value = "";
  try {
    const payload = await fetchJson("/api/transfer-area/bootstrap");
    taskOverview.value = (payload.taskOverview || []).map((task) => normalizeTaskRecord(task));
    if (selectedTaskId.value && !taskOverview.value.some((task) => task.taskId === selectedTaskId.value)) {
      clearWorkspace();
      viewMode.value = "overview";
    }
    pendingTaskCount.value = taskOverview.value.filter((task) => normalizeTaskStatus(task.taskStatus) === pendingStatus).length;
    storedTaskCount.value = taskOverview.value.filter((task) => normalizeTaskStatus(task.taskStatus) === storedStatus).length;
  } catch (error) {
    if (showBlockingLoading) {
      bootstrapError.value = error instanceof Error ? error.message : "请稍后重试";
      taskOverview.value = [];
      pendingTaskCount.value = 0;
      storedTaskCount.value = 0;
    }
  } finally {
    if (showBlockingLoading) {
      isBootstrapLoading.value = false;
    }
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

const refreshWorkspaceSaveGuards = async () => {
  if (!selectedTaskId.value) {
    return;
  }
  const workspace = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/workspace`);
  applyWorkspaceSaveGuards(workspace);
};

const openTask = async (task) => {
  selectedTaskId.value = task.taskId;
  clearWorkbenchFeedback();
  barcodeModalVisible.value = false;
  barcodePreviewItems.value = [];
  sampleCodesModalVisible.value = false;
  sampleCodesModalTask.value = null;
  viewMode.value = "detail";
  try {
    await loadWorkspace(task.taskId);
  } catch (error) {
    if (!isArchivedWorkspaceError(error)) {
      throw error;
    }
    showWorkbenchFeedback(error instanceof Error ? error.message : "任务已归档", "error");
    clearWorkspace();
    viewMode.value = "overview";
    await loadBootstrap();
  }
};

const refreshTransferWorkspaceAfterTrayChange = async () => {
  await loadBootstrap({ silent: true });
  if (!selectedTaskId.value) {
    return;
  }
  await loadWorkspace(selectedTaskId.value);
};

const isTransferRealtimeRefreshPaused = () => Boolean(
  barcodeModalVisible.value
  || sampleCodesModalVisible.value
  || printingAllBarcodes.value
  || errorSample.state.open
  || errorSample.state.loading
  || errorSample.state.submitting
  || (viewMode.value === "detail" && selectedTaskId.value && !allocationReadOnly.value)
);

function flushPendingRealtimeRefresh() {
  const flushedStorage = flushPendingStorageRefresh();
  if (!hasPendingSamplesRefresh || isTransferRealtimeRefreshPaused()) {
    return flushedStorage;
  }
  hasPendingSamplesRefresh = false;
  if (!flushedStorage) {
    void refreshTransferWorkspaceAfterTrayChange();
  }
  return true;
}

const handleSamplesUpdated = (event) => {
  const source = String(event?.detail?.source || "").trim();
  if (source === "transfer-workbench" || source === "tray-error-sample") {
    return;
  }
  if (isTransferRealtimeRefreshPaused()) {
    hasPendingSamplesRefresh = true;
    return;
  }
  hasPendingSamplesRefresh = false;
  void refreshTransferWorkspaceAfterTrayChange();
};

const storageRefresh = useStorageSnapshotRefresh({
  keys: [
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.experiment_samples,
    STORAGE_KEYS.staging_events,
  ],
  refresh: refreshTransferWorkspaceAfterTrayChange,
  paused: isTransferRealtimeRefreshPaused,
  debounceMs: 100,
});
flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

const setTaskStatusFilter = (status) => {
  taskStatusFilter.value = status;
  taskPage.value = 1;
};

const setActiveWorkbenchView = (nextView) => {
  if (props.mode !== "handover") {
    return;
  }
  const resolvedView = nextView === "dispatch" ? "dispatch" : "overview";
  if (activeWorkbenchView.value === "dispatch" && resolvedView !== "dispatch") {
    transferDispatch.resetDispatch();
  }
  activeWorkbenchView.value = resolvedView;
  if (resolvedView === "overview") {
    barcodeModalVisible.value = false;
    sampleCodesModalVisible.value = false;
    sampleCodesModalTask.value = null;
    viewMode.value = "overview";
  }
};

const reloadBootstrap = async () => {
  await loadBootstrap();
};

const setTaskPage = (page) => {
  const nextPage = Number.parseInt(page, 10);
  taskPage.value = Math.min(taskPageCount.value, Math.max(1, Number.isFinite(nextPage) ? nextPage : 1));
};

const toggleOverviewTaskNoSort = () => {
  overviewTaskNoSortDirection.value = overviewTaskNoSortDirection.value === "asc" ? "desc" : "asc";
  taskPage.value = 1;
};

const backToOverview = async () => {
  barcodeModalVisible.value = false;
  sampleCodesModalVisible.value = false;
  sampleCodesModalTask.value = null;
  await loadBootstrap();
  viewMode.value = "overview";
  flushPendingRealtimeRefresh();
};

const clearSelectedSample = () => {
  selectedSampleId.value = null;
  selectedSampleTrayIndex.value = -1;
};

const showSavedAllocationHint = () => {
  if (!allocationSaved.value) {
    return false;
  }
  lockedOperationHint.value = SAVED_ALLOCATION_HINT;
  return true;
};

const isSampleSelected = (sampleId) => selectedSampleId.value === sampleId;
const isTraySelectedForCurrentExperiment = (trayNo) => (
  isExperimentMode.value
    && Array.isArray(draftExperimentTraySelections.value[currentExperimentCode.value])
    && draftExperimentTraySelections.value[currentExperimentCode.value].includes(trayNo)
);
const normalizeTraySamples = (samples) => samples.slice().sort((a, b) => String(a.sampleNo || "").localeCompare(String(b.sampleNo || "")));

const setAssignmentMode = (mode) => {
  if (mode && mode !== "task" && showSavedAllocationHint()) {
    return;
  }
  activeAssignmentMode.value = mode || "task";
  clearSelectedSample();
};

const handleDetailShellClick = (event) => {
  if (!isExperimentMode.value) {
    return;
  }
  const target = event?.target;
  if (!(target instanceof Element)) {
    setAssignmentMode("task");
    return;
  }
  if (
    target.closest("button")
    || target.closest("input")
    || target.closest("select")
    || target.closest("textarea")
    || target.closest(".sample-tray-sample-tag")
    || target.closest(".transfer-tray-card")
    || target.closest(".transfer-detail-shell__top")
  ) {
    return;
  }
  setAssignmentMode("task");
};

const toggleExperimentTraySelection = (trayIndex) => {
  if (!isExperimentMode.value || allocationReadOnly.value) {
    showSavedAllocationHint();
    return;
  }
  const tray = assignedTrays.value[trayIndex];
  if (!tray) {
    return;
  }
  const current = new Set(draftExperimentTraySelections.value[currentExperimentCode.value] || []);
  if (current.has(tray.trayNo)) {
    current.delete(tray.trayNo);
  } else {
    current.add(tray.trayNo);
  }
  draftExperimentTraySelections.value = {
    ...draftExperimentTraySelections.value,
    [currentExperimentCode.value]: Array.from(current).sort((left, right) => left.localeCompare(right, "zh-Hans-CN")),
  };
  rebuildTrayExperimentLabels();
  allocationSaved.value = false;
  activeTrayIndex.value = trayIndex;
};

const setActiveTray = (index) => {
  if (isExperimentMode.value) {
    toggleExperimentTraySelection(index);
    return;
  }
  if (taskEditingLocked.value) {
    showSavedAllocationHint();
    return;
  }
  if (selectedSampleId.value != null && selectedSampleTrayIndex.value >= 0 && selectedSampleTrayIndex.value !== index) {
    placeSelectedSampleToTray(index);
    return;
  }
  activeTrayIndex.value = index;
  armedTrayIndex.value = index;
};

const setTrayLimit = (value) => {
  if (taskEditingLocked.value) return;
  const nextLimit = normalizeTrayLimit(value);
  if (nextLimit === trayLimit.value) return;
  const requiredTrayCount = Math.max(1, Math.ceil(totalAssignedSampleCount.value / nextLimit));
  if (nextLimit < trayLimit.value && requiredTrayCount > maxAssignableTrayCount.value) {
    trayLimitInputVersion.value += 1;
    showWorkbenchFeedback(trayCapacityWarning.value, "warning");
    return;
  }
  rebalanceTrayLayout({ limit: nextLimit, message: `已按统一上限 ${nextLimit} 重新分配托盘。` });
};

const allowTrayDrag = () => canDragSamples.value;

const startDragging = (sampleId, trayIndex) => {
  if (!canDragSamples.value) {
    showSavedAllocationHint();
    return;
  }
  draggingSampleId.value = sampleId;
  draggingFromTrayIndex.value = trayIndex;
  selectedSampleId.value = sampleId;
  selectedSampleTrayIndex.value = trayIndex;
};

const placeSelectedSampleToTray = (targetIndex) => {
  if (taskEditingLocked.value) {
    showSavedAllocationHint();
    return;
  }
  if (selectedSampleId.value == null || selectedSampleTrayIndex.value < 0) return;
  const sourceTray = assignedTrays.value[selectedSampleTrayIndex.value];
  const targetTray = assignedTrays.value[targetIndex];
  if (!sourceTray || !targetTray || sourceTray === targetTray) return;
  if (targetTray.samples.length >= trayLimit.value) {
    showWorkbenchFeedback("目标托盘已达到上限。", "warning");
    return;
  }
  const sampleIndex = sourceTray.samples.findIndex((sample) => sample.sampleId === selectedSampleId.value);
  if (sampleIndex < 0) return;
  const [sample] = sourceTray.samples.splice(sampleIndex, 1);
  targetTray.samples = normalizeTraySamples([...targetTray.samples, sample]);
  refreshEditableTrayState(`已将 ${sample.sampleNo} 移动到 ${targetTray.trayNo}`);
  activeTrayIndex.value = targetIndex;
  armedTrayIndex.value = targetIndex;
  draggingSampleId.value = null;
  draggingFromTrayIndex.value = -1;
  clearSelectedSample();
};

const swapTraySamples = (sourceSampleId, sourceTrayIndex, targetSampleId, targetTrayIndex) => {
  if (taskEditingLocked.value) {
    showSavedAllocationHint();
    return;
  }
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
  if (taskEditingLocked.value) {
    showSavedAllocationHint();
    return;
  }
  if (armedTrayIndex.value >= 0 && armedTrayIndex.value !== trayIndex && selectedSampleId.value == null) {
    selectedSampleId.value = sampleId;
    selectedSampleTrayIndex.value = trayIndex;
    placeSelectedSampleToTray(armedTrayIndex.value);
    return;
  }
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
  if (taskEditingLocked.value) {
    showSavedAllocationHint();
    return;
  }
  if (draggingSampleId.value == null || draggingFromTrayIndex.value < 0) return;
  selectedSampleId.value = draggingSampleId.value;
  selectedSampleTrayIndex.value = draggingFromTrayIndex.value;
  placeSelectedSampleToTray(targetIndex);
  draggingSampleId.value = null;
  draggingFromTrayIndex.value = -1;
};

const addInventoryTray = () => {
  if (taskEditingLocked.value) return;
  if (trayCapacityExceeded.value) {
    showWorkbenchFeedback(trayCapacityWarning.value, "warning");
    return;
  }
  if (remainingTrayCount.value <= 0) {
    showWorkbenchFeedback("当前没有可用空托盘。", "warning");
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
  armedTrayIndex.value = -1;
};

const removeTray = (index) => {
  const tray = assignedTrays.value[index];
  if (!tray) return;
  if (taskEditingLocked.value) {
    showSavedAllocationHint();
    return;
  }
  if (assignedTrays.value.length <= minimumTrayCount.value) {
    showWorkbenchFeedback("当前托盘数量已是最小值，不能继续删除。", "warning");
    return;
  }
  rebalanceTrayLayout({
    limit: trayLimit.value,
    message: `已删除 ${tray.trayNo}，并自动重新分配样品。`,
  });
};

const buildAllocationPayload = () => ({
  trayLimit: trayLimit.value,
  trays: assignedTrays.value.map((tray) => ({
    trayId: tray.trayId,
    sampleIds: tray.samples.map((sample) => sample.sampleId),
  })),
  experimentTrays: experiments.value.map((experiment) => ({
    experimentCode: experiment.experimentCode,
    trayIds: assignedTrays.value
      .filter((tray) => (draftExperimentTraySelections.value[experiment.experimentCode] || []).includes(tray.trayNo))
      .map((tray) => tray.trayId),
  })),
});

const buildBarcodeSvg = (value) => {
  return buildCode128Svg(value, { height: 72, moduleWidth: 2, quietZone: 12 });
};

const resolveBarcodeValue = (barcode, tray) => String(
  barcode?.barcodeNo
  || barcode?.barcodeContent
  || tray?.barcode?.barcodeNo
  || tray?.barcode?.barcodeContent
  || tray?.trayNo
  || "--",
).trim() || "--";

const resolveBarcodeDisplayNo = (barcode, tray) => String(
  barcode?.barcodeNo
  || tray?.barcode?.barcodeNo
  || tray?.trayNo
  || resolveBarcodeValue(barcode, tray),
).trim() || "--";

const persistAllocation = async (showMessage = true, { allowExperimentMode = false } = {}) => {
  if (!selectedTaskId.value || isStoredTask.value) return false;
  const canPersist = allowExperimentMode ? canPersistAllocationDraft.value : canSaveAllocation.value;
  if (!canPersist) {
    const message = allocationValidationMessage.value || "托盘分配尚未完成，请检查实验与托盘关系。";
    if (showMessage) showWorkbenchFeedback(message, "warning");
    return false;
  }
  try {
    await refreshWorkspaceSaveGuards();
    const canPersistAfterRefresh = allowExperimentMode ? canPersistAllocationDraft.value : canSaveAllocation.value;
    if (!canPersistAfterRefresh) {
      const message = allocationValidationMessage.value || "托盘分配尚未完成，请检查实验与托盘关系。";
      if (showMessage) showWorkbenchFeedback(message, "warning");
      return false;
    }
    const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/allocate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildAllocationPayload()),
    });
    applyWorkspace(payload.workspace);
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, { detail: { source: "transfer-workbench", reason: "allocate" } }));
    flushPendingRealtimeRefresh();
    if (showMessage) showWorkbenchFeedback(payload.message, "success");
    return true;
  } catch (error) {
    if (showMessage) {
      showWorkbenchFeedback(error instanceof Error ? error.message : "托盘分配保存失败，请重试。", "error");
    }
    return false;
  }
};

const closeBarcodeModal = () => {
  barcodeModalVisible.value = false;
  flushPendingRealtimeRefresh();
};

const buildBarcodeSummaryText = (taskNo, sampleCount) => `任务编号：${taskNo || "--"} | 样品数量：${sampleCount ?? 0}`;

const buildPrintDocument = () => {
  const cards = barcodePreviewItems.value.map((item) => `
    <article class="print-card">
      <header>
        <strong>${encodeHtml(item.barcodeDisplayNo)}</strong>
        <span>${encodeHtml(item.trayNo)}</span>
      </header>
      <div class="print-barcode">${item.barcodeSvg || ""}</div>
      <div class="print-meta">内容：${encodeHtml(item.summaryText || "-")}</div>
      <div class="print-meta">样品编号：${encodeHtml(item.sampleText || "-")}</div>
      ${buildPrintExperimentTags(item)}
    </article>
  `).join("");

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <title>${encodeHtml(modeConfig.value.printTitle)}</title>
        <style>
          body { font-family: "IBM Plex Sans", "Microsoft YaHei", sans-serif; padding: 24px; color: #10233f; }
          h1 { margin: 0 0 8px; font-size: 24px; }
          p { margin: 0 0 18px; color: #64748b; }
          .print-grid { display: grid; gap: 16px; }
          .print-card { border: 1px solid #cbd5e1; border-radius: 16px; padding: 16px; break-inside: avoid; }
          .print-card header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
          .print-barcode { margin: 12px 0; }
          .print-meta { margin-top: 6px; font-size: 14px; }
          .print-experiment-tags { margin-top: 12px; justify-content: flex-start; }
          .transfer-tray-experiment-tags { display: flex; flex-wrap: wrap; gap: 8px; }
          .transfer-tray-experiment-tag {
            display: inline-flex;
            align-items: center;
            min-height: 30px;
            padding: 0 12px;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 700;
            background: var(--tray-experiment-bg, rgba(14, 165, 233, 0.14));
            border: 1px solid var(--tray-experiment-border, rgba(14, 165, 233, 0.45));
            color: var(--tray-experiment-color, #7dd3fc);
          }
${buildExperimentTagPrintCss()}
        </style>
      </head>
      <body>
        <h1>${encodeHtml(modeConfig.value.printTitle)}</h1>
        <p>${encodeHtml(currentTask.value?.taskNo || "--")} | ${encodeHtml(currentTask.value?.experimentTypeText || currentTask.value?.taskType || "--")}</p>
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
    } catch {
      // Some embedded print frames cannot receive focus; printing can continue.
    }
  }
  if (typeof frameWindow.print === "function") {
    try {
      frameWindow.print();
    } catch {
      // Browser print dialogs may be blocked in tests or restricted contexts.
    }
  }

  window.setTimeout(() => {
    if (printFrame.parentNode) {
      printFrame.parentNode.removeChild(printFrame);
    }
  }, 0);
};

const confirmBarcodePrint = async () => {
  if (!barcodePreviewItems.value.length) {
    showWorkbenchFeedback("当前没有可打印的条码。", "warning");
    return;
  }
  try {
    await printBarcodePreview();
  } catch (error) {
    showWorkbenchFeedback(error instanceof Error ? error.message : "打印失败，请重试。", "error");
    return;
  }
  barcodePrintConfirmed.value = true;
  barcodeModalVisible.value = false;
  flushPendingRealtimeRefresh();
  showWorkbenchFeedback("已发起条码打印。", "success");
};

const printAllTrayBarcodes = async () => {
  if (!canPrint.value) return;
  printingAllBarcodes.value = true;
  try {
    if (!isStoredTask.value && !allocationSaved.value) {
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
      const barcodeValue = resolveBarcodeValue(barcode, tray);
      return {
        ...barcode,
        barcodeDisplayNo: resolveBarcodeDisplayNo(barcode, tray),
        barcodeValue,
        trayNo: tray?.trayNo || "--",
        samples: tray?.samples?.map((sample) => sample.sampleNo) || [],
        summaryText: buildBarcodeSummaryText(currentTask.value?.taskNo, tray?.samples?.length || 0),
        sampleText: formatSampleCodePreview(tray?.samples?.map((sample) => sample.sampleNo)),
        experimentLabels: Array.isArray(tray?.experimentLabels) ? [...tray.experimentLabels] : [],
        experimentCodes: Array.isArray(tray?.experimentCodes) ? [...tray.experimentCodes] : [],
        barcodeSvg: buildBarcodeSvg(barcodeValue),
      };
    });
    barcodePrintConfirmed.value = false;
    barcodeModalVisible.value = true;
    sampleCodesModalVisible.value = false;
    sampleCodesModalTask.value = null;
    showWorkbenchFeedback(payload.message, "success");
  } finally {
    printingAllBarcodes.value = false;
    flushPendingRealtimeRefresh();
  }
};

const confirmStorage = async () => {
  if (!canConfirm.value) return;
  if (!allocationSaved.value) {
    const saved = await persistAllocation(false, { allowExperimentMode: true });
    if (!saved) return;
  }
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
  showWorkbenchFeedback(payload.message, "success");
  window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, { detail: { source: "transfer-workbench", reason: "confirm-storage" } }));
  await loadBootstrap();
  if (confirmedTaskId) {
    updateOverviewTaskStatus(confirmedTaskId, storedStatus, confirmedProgress);
  }
  flushPendingRealtimeRefresh();
  taskStatusFilter.value = storedStatus;
};

const reloadWorkspace = async () => {
  if (!canResetWorkspace.value) return;
  clearWorkbenchFeedback();
  barcodeModalVisible.value = false;
  barcodePreviewItems.value = [];
  sampleCodesModalVisible.value = false;
  sampleCodesModalTask.value = null;
  const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/reload`, { method: "POST" });
  applyWorkspace(payload.workspace);
  activeTrayIndex.value = -1;
  updateOverviewTaskStatus(selectedTaskId.value, pendingStatus, payload?.workspace?.task?.taskProgress || "样品已送达，待打印条形码");
  showWorkbenchFeedback(props.mode === "pre-allocation"
    ? (normalizeTaskStatus(payload?.workspace?.task?.taskStatus) === storedStatus ? "到货任务仅支持查看与打印。" : "任务已重新分配，可继续调整托盘方案。")
    : payload.message, normalizeTaskStatus(payload?.workspace?.task?.taskStatus) === storedStatus ? "warning" : "success");
  await loadBootstrap();
  window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT, { detail: { source: "transfer-workbench", reason: "reload" } }));
  flushPendingRealtimeRefresh();
  taskStatusFilter.value = pendingStatus;
};

onMounted(() => {
  void loadBootstrap();
  window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
});

onBeforeUnmount(() => {
  window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
});
</script>

<style scoped src="../handover-system/styles.css"></style>
