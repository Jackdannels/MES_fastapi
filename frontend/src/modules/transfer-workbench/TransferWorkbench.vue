<template>
  <div class="transfer-area-screen" :class="{ 'is-embedded': embedded, 'is-terminal': terminal }">
    <header v-if="showModeHeader" class="page-header transfer-system-header">
      <div class="transfer-system-header__meta">
        <h1 class="transfer-system-title">{{ modeConfig.headerTitle }}</h1>
      </div>
      <div class="header-actions transfer-system-actions">
        <button
          class="action-btn secondary"
          :class="{ 'is-active': activeWorkbenchView === 'overview' }"
          data-testid="handover-nav-overview"
          :disabled="storageOperationPending"
          type="button"
          @click="setActiveWorkbenchView('overview')"
        >
          任务总览
        </button>
        <button
          class="action-btn secondary"
          :class="{ 'is-active': activeWorkbenchView === 'dispatch' }"
          data-testid="handover-nav-dispatch"
          :disabled="storageOperationPending"
          type="button"
          @click="setActiveWorkbenchView('dispatch')"
        >
          样品出库
        </button>
        <button
          v-if="mode === 'handover'"
          class="action-btn tray-error-sample-trigger"
          data-testid="handover-error-sample"
          :disabled="storageOperationPending"
          type="button"
          @click="errorSample.open()"
        >
          出错样品处理
        </button>
        <button class="action-btn secondary" data-testid="handover-logout" type="button" :disabled="storageOperationPending" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <div class="transfer-area-shell" :class="{ 'is-embedded': embedded, 'is-terminal': terminal }">
      <template v-if="showDispatchPanel">
        <TransferDispatchPanel :dispatch-state="transferDispatch" />
      </template>

      <template v-else-if="viewMode === 'overview'">
        <section class="card transfer-overview-shell">
          <div class="transfer-overview-shell__head">
            <h2
              v-if="showOverviewIntro"
              class="transfer-overview-page-title"
              :class="{ 'transfer-overview-page-title--compact': mode === 'pre-allocation' }"
            >
              {{ modeConfig.overviewTitle }}
            </h2>
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
            <AppPagination
              :current-page="currentTaskPage"
              :page-count="taskPageCount"
              :show-jump-controls="false"
              @change="setTaskPage"
            />
          </div>
        </section>
      </template>

      <template v-else>
        <section class="card transfer-detail-shell" @click="handleDetailShellClick">
          <div class="transfer-detail-shell__top">
            <button class="action-btn secondary" type="button" :disabled="storageOperationPending" @click="backToOverview">返回总览</button>
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
                :disabled="storageOperationPending"
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
              <h3>托盘栏位</h3>

              <div class="transfer-tray-toolbar">
                <div class="transfer-tray-limit-toolbar">
                  <div class="transfer-tray-limit-stepper">
                    <AppNumberInput
                      :key="trayLimitInputKey"
                      controls-layout="horizontal"
                      data-testid="transfer-tray-limit-input"
                      min="1"
                      :max="MAX_TRAY_LIMIT"
                      step="1"
                      :disabled="taskEditingLocked"
                      :model-value="trayLimit"
                      @change="setTrayLimit"
                    />
                  </div>
                </div>

                <div class="transfer-panel-title__actions">
                  <span class="transfer-count-chip">剩余空托盘 {{ remainingTrayCount }}</span>
                  <button class="action-btn secondary transfer-use-tray-btn" type="button" :disabled="taskEditingLocked || remainingTrayCount <= 0 || trayCapacityExceeded" @click="addInventoryTray">新增托盘</button>
                </div>
              </div>
            </div>

            <div class="form-actions transfer-tray-actions transfer-tray-actions--top">
              <button class="action-btn transfer-print-all-btn" data-testid="transfer-print-barcodes" type="button" :disabled="!canPrint || printingAllBarcodes || storageOperationPending" @click="printAllTrayBarcodes">
                {{ printingAllBarcodes ? "生成中..." : `打印二维码（${loadedTrayCount}）` }}
              </button>
              <button class="action-btn secondary" data-testid="transfer-save-trays" type="button" :disabled="!canSaveAllocation || storageOperationPending" @click="persistAllocation()">保存托盘</button>
              <button v-if="modeConfig.allowConfirm" class="action-btn" data-testid="transfer-confirm-storage" type="button" :disabled="!canConfirm || storageOperationPending" @click="confirmStorage">
                {{ storageOperationPending ? "处理中..." : "确认入库" }}
              </button>
              <button
                v-if="modeConfig.allowReset"
                class="action-btn secondary"
                data-testid="transfer-reset-workspace"
                :disabled="!canResetWorkspace || storageOperationPending"
                @click="reloadWorkspace"
              >
                {{ modeConfig.resetActionLabel }}
              </button>
              <button
                v-if="experiments.length"
                class="action-btn secondary"
                data-testid="transfer-assign-all-experiments"
                type="button"
                :disabled="allocationReadOnly || assignedTrays.length === 0"
                @click.stop="assignAllExperimentsToAllTrays"
              >
                全部托盘应用全部试验
              </button>
            </div>

            <div
              v-if="storageOperationPending"
              class="transfer-storage-progress"
              data-testid="transfer-storage-progress"
              role="status"
              aria-live="polite"
            >
              <div class="transfer-storage-progress__text">{{ storageOperationMessage }}</div>
              <progress class="transfer-storage-progress__bar" :aria-label="storageOperationMessage"></progress>
              <div class="muted">入库完成前已暂停托盘编辑、试验分配及任务切换，请稍候。</div>
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
                    :disabled="storageOperationPending"
                    @dragstart.stop="startDragging(sample.sampleId, index)"
                    @click.stop="selectTraySample(sample.sampleId, index)"
                  >
                    <span class="sample-tray-chip__code">{{ sample.sampleNo }}</span>
                    <span class="sample-tray-chip__status">{{ sample.sampleStatus || "未入库" }}</span>
                  </button>
                </div>

                <div class="transfer-tray-card__footer">
                  <div class="transfer-tray-card__count">二维码：{{ tray.barcode?.barcodeNo || "未打印" }}</div>
                  <div class="transfer-tray-card__actions">
                    <button
                      class="sample-tray-remove"
                      :class="{ 'is-disabled': taskEditingLocked }"
                      type="button"
                      :aria-disabled="taskEditingLocked ? 'true' : 'false'"
                      :disabled="storageOperationPending || isStoredTask || Boolean(reloadBlockedReason)"
                      @click.stop="removeTray(index)"
                    >
                      删除托盘
                    </button>
                  </div>
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
            <h3>二维码信息</h3>
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
                <span class="transfer-barcode-preview-card__eyebrow">托盘二维码</span>
                <strong>{{ item.barcodeDisplayNo }}</strong>
              </div>
              <span class="transfer-barcode-preview-count">{{ item.samples.length }} 件样品</span>
            </div>
            <div class="transfer-barcode-preview-layout">
              <div v-if="item.barcodeSvg" class="transfer-modal__barcode transfer-barcode-preview-code transfer-barcode-preview-code--themed" v-html="item.barcodeSvg"></div>
              <div class="transfer-barcode-preview-info">
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
              </div>
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

    <div v-if="scheduleResetConfirmOpen" class="transfer-modal">
      <div class="transfer-modal__backdrop transfer-schedule-reset-backdrop" @click="closeScheduleResetConfirm"></div>
      <div
        class="transfer-modal__panel transfer-schedule-reset-modal"
        data-testid="transfer-schedule-reset-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-schedule-reset-title"
      >
        <div class="transfer-schedule-reset-modal__head">
          <span class="transfer-schedule-reset-modal__mark" aria-hidden="true">!</span>
          <div>
            <div class="eyebrow">排程重置确认</div>
            <h3 id="transfer-schedule-reset-title">确认{{ modeConfig.resetActionLabel }}</h3>
          </div>
        </div>
        <p class="transfer-schedule-reset-modal__message">{{ scheduleResetConfirmMessage }}</p>
        <div class="transfer-schedule-reset-modal__meta">
          <span>任务编号</span>
          <strong>{{ currentTask?.taskNo || "--" }}</strong>
        </div>
        <div class="transfer-modal__actions transfer-schedule-reset-modal__actions">
          <button class="action-btn secondary" data-testid="transfer-schedule-reset-cancel" type="button" @click="closeScheduleResetConfirm">取消</button>
          <button class="action-btn" data-testid="transfer-schedule-reset-submit" type="button" @click="confirmScheduleReset">确认{{ modeConfig.resetActionLabel }}</button>
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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import AppFeedback from "@/components/shared/AppFeedback.vue";
import AppNumberInput from "@/components/shared/AppNumberInput.vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import ModuleExitDialog from "@/components/shared/ModuleExitDialog.vue";
import TrayErrorSampleDialog from "@/components/shared/TrayErrorSampleDialog.vue";
import { useTrayErrorSampleHandling } from "@/composables/useTrayErrorSampleHandling";
import { useFeedback } from "@/composables/useFeedback";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import TransferDispatchPanel from "./TransferDispatchPanel.vue";
import { useTransferDispatch } from "./useTransferDispatch";
import { useTransferBarcodePrinting } from "./useTransferBarcodePrinting";
import { useTransferWorkbenchExit } from "./useTransferWorkbenchExit";
import { useTransferWorkbenchOverview } from "./useTransferWorkbenchOverview";
import { useTransferWorkbenchRealtime } from "./useTransferWorkbenchRealtime";
import { useTransferTrayAssignment } from "./useTransferTrayAssignment";
import { useTransferWorkspacePersistence } from "./useTransferWorkspacePersistence";
import {
  MODE_CONFIGS,
  normalizeText,
  overviewSampleOverflowCount,
  resolveExperimentDisplayName,
  resolveExperimentTagTone,
  resolveOverviewSampleCodes,
  visibleOverviewSampleCodes,
} from "./model";

const props = defineProps({
  embedded: {
    type: Boolean,
    default: false,
  },
  terminal: {
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

const router = useRouter();
const pendingStatus = "未入库";
const storedStatus = "到货";
const MAX_TRAY_LIMIT = 16;

const activeWorkbenchView = ref("overview");
const viewMode = ref("overview");
const taskOverview = ref([]);
const {
  clearFilters,
  currentTaskPage,
  overviewTaskNoSortDirection,
  pagedTaskOverviewRows,
  pendingTaskCount,
  searchText,
  setTaskPage,
  setTaskStatusFilter,
  storedTaskCount,
  taskPageCount,
  taskStatusFilter,
  taskTypeFilter,
  taskTypeOptions,
  toggleOverviewTaskNoSort,
} = useTransferWorkbenchOverview({ pendingStatus, taskOverview });
const selectedTaskId = ref(null);
const currentTask = ref(null);
const storageOperationPending = ref(false);
const storageOperationMessage = ref("");
const workbenchFeedback = useFeedback();
const feedback = workbenchFeedback.message;
const feedbackTone = workbenchFeedback.tone;
const showWorkbenchFeedback = workbenchFeedback.show;
const clearWorkbenchFeedback = workbenchFeedback.clear;
const {
  activeAssignmentMode,
  activeTrayIndex,
  addInventoryTray,
  assignAllExperimentsToAllTrays,
  allocationReadOnly,
  allocationSaved,
  allocationValidationMessage,
  allowTrayDrag,
  assignedTrays,
  availableInventory,
  barcodePrintConfirmed,
  buildAllocationPayload,
  canConfirm,
  canDragSamples,
  canPersistAllocationDraft,
  canPrint,
  canResetWorkspace,
  canSaveAllocation,
  currentExperimentName,
  draftExperimentTraySelections,
  experimentSelectionLocked,
  experiments,
  handleDetailShellClick,
  handleTrayDrop,
  isExperimentMode,
  isSampleSelected,
  isStoredTask,
  isTraySelectedForCurrentExperiment,
  loadedTrayCount,
  lockedOperationHint,
  rebuildTrayExperimentLabels,
  reloadBlockedReason,
  remainingTrayCount,
  removeTray,
  resetInteractiveState,
  selectTraySample,
  selectionHintText,
  setActiveTray,
  setAssignmentMode,
  setTrayLimit,
  startDragging,
  taskEditingLocked,
  toggleExperimentTraySelection,
  trayCapacityExceeded,
  trayCapacityWarning,
  trayLimit,
  trayLimitInputKey,
} = useTransferTrayAssignment({
  currentTask,
  mode: computed(() => props.mode),
  pendingStatus,
  selectedTaskId,
  showWorkbenchFeedback,
  storageOperationPending,
  storedStatus,
});
const printingAllBarcodes = ref(false);
const barcodeModalVisible = ref(false);
const barcodePreviewItems = ref([]);
const sampleCodesModalVisible = ref(false);
const sampleCodesModalTask = ref(null);
const sampleCodesModalSampleCodes = computed(() => resolveOverviewSampleCodes(sampleCodesModalTask.value, { full: true }));
const modeConfig = computed(() => MODE_CONFIGS[props.mode] || MODE_CONFIGS.handover);
const showModeHeader = computed(() => props.showHeader && props.mode === "handover");
const showDispatchPanel = computed(() => props.mode === "handover" && activeWorkbenchView.value === "dispatch");
const showOverviewIntro = computed(() => props.mode !== "pre-allocation");
const scheduleResetConfirmOpen = ref(false);
const scheduleResetConfirmMessage = ref("");
const {
  closeExitDialog,
  confirmLogout,
  exitDialogOpen,
  handleLogout,
  switchModule,
} = useTransferWorkbenchExit(router);
const ignoredStorageRequestIds = ref([]);
let storageWriteSequence = 0;
const trackOwnStorageRequest = (reason = "transfer") => {
  storageWriteSequence += 1;
  const requestId = `transfer-workbench:${Date.now()}:${storageWriteSequence}:${reason}`;
  ignoredStorageRequestIds.value = [...ignoredStorageRequestIds.value, requestId].slice(-20);
  return { requestId, source: "transfer-workbench" };
};
const transferDispatch = useTransferDispatch({ createStorageUpdateMeta: trackOwnStorageRequest });
let flushPendingRealtimeRefresh = () => false;

const closeSampleCodesModal = () => {
  sampleCodesModalVisible.value = false;
  sampleCodesModalTask.value = null;
  flushPendingRealtimeRefresh();
};

const closeScheduleResetConfirm = () => {
  scheduleResetConfirmOpen.value = false;
  scheduleResetConfirmMessage.value = "";
};

const openScheduleResetConfirm = () => {
  scheduleResetConfirmMessage.value = normalizeText(currentTask.value?.scheduleResetWarning)
    || `当前任务已有排程，${modeConfig.value.resetActionLabel}后将清空排程信息，需要重新排程。`;
  scheduleResetConfirmOpen.value = true;
};

const openSampleCodesModal = (task) => {
  sampleCodesModalTask.value = task;
  sampleCodesModalVisible.value = true;
};

const {
  applyWorkspace,
  backToOverview,
  bootstrapError,
  confirmStorage,
  executeReloadWorkspace,
  fetchJson,
  isBootstrapLoading,
  loadBootstrap,
  openTask,
  persistAllocation,
  refreshTransferWorkspaceAfterTrayChange,
  reloadBootstrap,
  reloadWorkspace,
} = useTransferWorkspacePersistence({
  activeAssignmentMode,
  activeTrayIndex,
  allocationSaved,
  allocationValidationMessage,
  assignedTrays,
  availableInventory,
  barcodeModalVisible,
  barcodePreviewItems,
  buildAllocationPayload,
  canConfirm,
  canPersistAllocationDraft,
  canResetWorkspace,
  canSaveAllocation,
  clearWorkbenchFeedback,
  currentTask,
  draftExperimentTraySelections,
  experiments,
  flushPendingRealtimeRefresh: () => flushPendingRealtimeRefresh(),
  mode: computed(() => props.mode),
  openScheduleResetConfirm,
  pendingStatus,
  pendingTaskCount,
  rebuildTrayExperimentLabels,
  resetInteractiveState,
  sampleCodesModalTask,
  sampleCodesModalVisible,
  selectedTaskId,
  showWorkbenchFeedback,
  storageOperationMessage,
  storageOperationPending,
  storedStatus,
  storedTaskCount,
  taskOverview,
  taskStatusFilter,
  trackOwnStorageRequest,
  trayLimit,
  viewMode,
});

const errorSample = useTrayErrorSampleHandling({
  onChanged: () => refreshTransferWorkspaceAfterTrayChange(),
  onClose: async () => {
    await refreshTransferWorkspaceAfterTrayChange();
    flushPendingRealtimeRefresh();
  },
});


const transferRealtime = useTransferWorkbenchRealtime({
  allocationReadOnly,
  barcodeModalVisible,
  errorSample,
  ignoredStorageRequestIds,
  printingAllBarcodes,
  refreshTransferWorkspaceAfterTrayChange,
  sampleCodesModalVisible,
  selectedTaskId,
  storageOperationPending,
  viewMode,
});
flushPendingRealtimeRefresh = transferRealtime.flushPendingRealtimeRefresh;
const handleSamplesUpdated = transferRealtime.handleSamplesUpdated;

const setActiveWorkbenchView = (nextView) => {
  if (props.mode !== "handover" || storageOperationPending.value) {
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

const {
  closeBarcodeModal,
  confirmBarcodePrint,
  printAllTrayBarcodes,
} = useTransferBarcodePrinting({
  allocationSaved,
  applyWorkspace,
  assignedTrays,
  barcodeModalVisible,
  barcodePreviewItems,
  barcodePrintConfirmed,
  canPrint,
  currentTask,
  fetchJson,
  flushPendingRealtimeRefresh: () => flushPendingRealtimeRefresh(),
  isStoredTask,
  modeConfig,
  persistAllocation,
  printingAllBarcodes,
  sampleCodesModalTask,
  sampleCodesModalVisible,
  selectedTaskId,
  showWorkbenchFeedback,
  storageOperationPending,
});
const confirmScheduleReset = async () => {
  closeScheduleResetConfirm();
  await executeReloadWorkspace();
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

<style scoped>
.transfer-storage-progress {
  display: grid;
  gap: 8px;
  margin: 10px 0 14px;
  padding: 12px 14px;
  border: 1px solid rgba(56, 189, 248, 0.34);
  border-radius: 10px;
  background: rgba(14, 116, 144, 0.12);
}

.transfer-storage-progress__text {
  color: #bae6fd;
  font-weight: 700;
}

.transfer-storage-progress__bar {
  width: 100%;
  height: 8px;
  accent-color: #22d3ee;
}
</style>
