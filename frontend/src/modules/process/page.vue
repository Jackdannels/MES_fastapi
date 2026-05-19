<template>
  <section class="card section process-control-page">
    <div class="process-control-header">
      <div>
        <h3>试验过程管控</h3>
        <div class="muted">展示各实验室当前状态，暂存间不纳入本页。</div>
      </div>
      <div class="process-control-summary">
        <button
          v-for="item in summaryItems"
          :key="item.key"
          class="process-control-summary-item"
          :class="{ 'is-active': activeFilter === item.key }"
          type="button"
          @click="setActiveFilter(item.key)"
        >
          <span class="process-control-summary-label">{{ item.label }}</span>
          <strong>{{ item.count }}</strong>
        </button>
      </div>
    </div>

    <AppFeedback :message="processActionMessage" tone="info" @close="processActionMessage = ''" />
    <div v-if="loading" class="muted">正在加载实验室状态...</div>
    <div v-else-if="visibleLabCards.length === 0" class="process-lab-empty muted">当前筛选下暂无实验室。</div>
    <div v-else class="process-lab-grid">
      <article v-for="lab in visibleLabCards" :key="lab.name" class="process-lab-card" :class="lab.statusClass">
        <div class="process-lab-top">
          <div>
            <div class="process-lab-name">{{ lab.name }}</div>
            <div class="process-lab-type">{{ lab.testType }}</div>
          </div>
          <span class="process-lab-status">{{ lab.status }}</span>
        </div>

        <div class="process-lab-body">
          <div class="process-lab-row">
            <span>任务编号</span>
            <strong>{{ lab.taskCode }}</strong>
          </div>
          <div class="process-lab-row">
            <span>目标实验</span>
            <strong>{{ lab.targetExperiment }}</strong>
          </div>
          <div class="process-lab-row">
            <span>排程时间</span>
            <strong>{{ lab.scheduleTime }}</strong>
          </div>
        </div>

        <div class="process-lab-actions">
          <button
            class="action-btn secondary"
            type="button"
            :data-testid="`process-task-button-${lab.name}`"
            :disabled="!lab.hasTask"
            @click="openTaskOverview(lab)"
          >
            查看任务
          </button>
          <button
            class="action-btn"
            type="button"
            :data-testid="`process-start-button-${lab.name}`"
            :disabled="!lab.canStartExperiment"
            :title="lab.startDisabledReason || ''"
            @click="openStartExperimentModal(lab)"
          >
            开始实验
          </button>
        </div>
        <div class="process-lab-hint">
          <span v-if="lab.runningTrayCount > 0">当前实验 {{ lab.runningTrayCount }} 个托盘</span>
          <span v-else-if="lab.readyTrayCount > 0">可启动 {{ lab.readyTrayCount }} 个托盘</span>
          <span v-else>{{ lab.startDisabledReason || "暂无可启动托盘" }}</span>
          <span v-if="lab.remainingTrayCount > 0">剩余待实验 {{ lab.remainingTrayCount }} 个托盘</span>
        </div>
      </article>
    </div>
  </section>

  <div class="modal process-task-modal" :class="{ 'is-open': taskDrawerOpen }" id="process-task-modal">
    <div class="modal-backdrop" data-testid="process-task-backdrop" @click="closeTaskDrawer"></div>
    <div class="modal-content process-task-modal-content">
      <div class="modal-header process-task-modal-header">
        <div>
          <div class="muted process-task-modal-eyebrow">任务摘要</div>
          <strong>试验任务详情</strong>
        </div>
        <button class="modal-close" type="button" @click="closeTaskDrawer">关闭</button>
      </div>

      <div class="process-task-hero">
        <div>
          <h2 class="process-task-code-headline">{{ selectedTaskDetail?.code || "-" }}</h2>
          <p class="process-task-name-subtitle">{{ selectedTaskDetail?.displayName || selectedTaskDetail?.name || "-" }}</p>
        </div>
        <span class="pill process-task-status">{{ selectedTaskDetail?.status || "-" }}</span>
      </div>

      <div class="process-task-drawer-layout">
        <div class="process-task-drawer-main">
          <div class="process-task-keyfacts">
            <div class="process-task-keyfact">
              <span>试验类型</span>
              <strong>{{ selectedTaskDetail?.testType || "-" }}</strong>
            </div>
            <div class="process-task-keyfact">
              <span>实验室</span>
              <strong>{{ selectedTaskDetail?.labName || "-" }}</strong>
            </div>
            <div class="process-task-keyfact process-task-keyfact-wide">
              <span>排程时间</span>
              <strong>{{ selectedTaskDetail?.scheduleTime || "-" }}</strong>
            </div>
          </div>

          <div class="process-task-summary-grid">
            <section class="process-task-summary-card">
              <div v-if="selectedTaskDetail?.availableTasks?.length > 1" class="process-task-switch-list">
                <button
                  v-for="taskOption in selectedTaskDetail.availableTasks"
                  :key="taskOption.selectionKey || taskOption.taskCode"
                  class="process-task-switch-button"
                  :class="{
                    'is-active':
                      selectedTaskDetail?.code === taskOption.taskCode
                      && (!taskOption.experimentCode || selectedTaskDetail?.activeExperimentCode === taskOption.experimentCode),
                  }"
                  type="button"
                  :data-testid="`process-switch-task-${taskOption.taskCode}`"
                  @click="
                    taskOption.experimentCode
                      ? setSelectedTaskForLab(selectedTaskDetail?.labName, taskOption.taskCode, taskOption.experimentCode)
                      : setSelectedTaskForLab(selectedTaskDetail?.labName, taskOption.taskCode)
                  "
                >
                  <strong>{{ taskOption.taskCode }}</strong>
                  <span>{{ taskOption.experimentName || "-" }}</span>
                </button>
              </div>
              <div class="process-task-summary-title">执行摘要</div>
              <div class="process-task-stat-grid">
                <div class="process-task-stat">
                  <span>样品数量</span>
                  <strong>{{ selectedTaskDetail?.sampleCount ?? "-" }}</strong>
                </div>
                <div class="process-task-stat">
                  <span>托盘数量</span>
                  <strong>{{ selectedTaskDetail?.trayCount ?? 0 }}</strong>
                </div>
              </div>
              <div
                v-if="selectedTaskDetail?.trayCodes?.length"
                class="process-task-tray-chip-list"
                :class="{
                  'is-dense': selectedTaskDetail.trayCodes.length >= 3,
                  'is-single-column': true,
                }"
              >
                <button
                  v-for="trayCode in previewTrayCodes"
                  :key="trayCode"
                  class="process-task-tray-chip process-task-tray-chip-emphasis"
                  :class="{ 'is-selected': selectedTaskDetail?.selectedTrayCode === trayCode }"
                  type="button"
                  :data-testid="`process-tray-chip-${trayCode}`"
                  @click="selectTaskTray(trayCode)"
                >
                  {{ trayCode }}
                </button>
                <span v-if="hiddenTrayCodeCount > 0" class="process-task-more-count">+{{ hiddenTrayCodeCount }}</span>
                <button
                  v-if="hiddenTrayCodeCount > 0"
                  class="process-task-more-button"
                  data-testid="process-show-all-trays"
                  type="button"
                  @click="openTaskFullList"
                >
                  查看全部
                </button>
              </div>
            </section>

            <section class="process-task-summary-card">
              <div class="process-task-summary-title">样品编号</div>
              <div
                v-if="selectedTaskDetail?.selectedTraySummary?.sampleCodes?.length"
                class="process-task-sample-code-list"
                data-testid="process-selected-tray-sample-list"
              >
                <div
                  v-for="sampleCode in previewSelectedSampleCodes"
                  :key="sampleCode"
                  class="process-task-sample-code-row"
                  :data-testid="`process-selected-tray-sample-item-${sampleCode}`"
                >
                  {{ sampleCode }}
                </div>
                <div v-if="hiddenSelectedSampleCount > 0" class="process-task-more-line">
                  <span class="process-task-more-count">+{{ hiddenSelectedSampleCount }}</span>
                  <button class="process-task-more-button" type="button" @click="openTaskFullList">查看全部</button>
                </div>
              </div>
              <div v-else class="muted">当前托盘暂无样品编号。</div>
              <div class="process-task-sample-hint" v-if="selectedTaskDetail?.selectedTraySummary?.trayCode">
                当前托盘：{{ selectedTaskDetail.selectedTraySummary.trayCode }}
              </div>
            </section>
          </div>

          <div class="process-task-batch-grid">
            <section class="process-task-summary-card">
              <div class="process-task-summary-title">当前实验托盘</div>
              <div v-if="selectedTaskDetail?.runningTrayRows?.length" class="process-task-tray-list">
                <div
                  v-for="tray in previewRunningTrayRows"
                  :key="tray.trayCode"
                  class="process-task-tray-row"
                  :class="{ 'is-selected': selectedTaskDetail?.selectedTrayCode === tray.trayCode }"
                >
                  <button
                    class="process-task-tray-row__select"
                    type="button"
                    :data-testid="`process-tray-button-${tray.trayCode}`"
                    @click="selectTaskTray(tray.trayCode)"
                  >
                    <strong>{{ tray.trayCode }}</strong>
                    <span>{{ tray.status }}</span>
                    <span>{{ traySamplePreviewText(tray) }}</span>
                  </button>
                  <span v-if="hiddenTraySampleCount(tray) > 0" class="process-task-more-inline">
                    +{{ hiddenTraySampleCount(tray) }}
                    <button class="process-task-more-button" type="button" @click="openTaskFullList">查看全部</button>
                  </span>
                </div>
                <div v-if="hiddenRunningTrayCount > 0" class="process-task-more-line">
                  <span class="process-task-more-count">+{{ hiddenRunningTrayCount }}</span>
                  <button class="process-task-more-button" type="button" @click="openTaskFullList">查看全部</button>
                </div>
              </div>
              <div v-else class="muted">当前无实验进行中托盘。</div>
            </section>

            <section class="process-task-summary-card">
              <div class="process-task-summary-title">待下一轮托盘</div>
              <div v-if="selectedTaskDetail?.remainingTrayRows?.length" class="process-task-tray-list">
                <div
                  v-for="tray in previewRemainingTrayRows"
                  :key="tray.trayCode"
                  class="process-task-tray-row"
                  :class="{ 'is-selected': selectedTaskDetail?.selectedTrayCode === tray.trayCode }"
                >
                  <button
                    class="process-task-tray-row__select"
                    type="button"
                    :data-testid="`process-tray-button-${tray.trayCode}`"
                    @click="selectTaskTray(tray.trayCode)"
                  >
                    <strong>{{ tray.trayCode }}</strong>
                    <span>{{ tray.status }}</span>
                    <span>{{ traySamplePreviewText(tray) }}</span>
                  </button>
                  <span v-if="hiddenTraySampleCount(tray) > 0" class="process-task-more-inline">
                    +{{ hiddenTraySampleCount(tray) }}
                    <button class="process-task-more-button" type="button" @click="openTaskFullList">查看全部</button>
                  </span>
                </div>
                <div v-if="hiddenRemainingTrayCount > 0" class="process-task-more-line">
                  <span class="process-task-more-count">+{{ hiddenRemainingTrayCount }}</span>
                  <button class="process-task-more-button" type="button" @click="openTaskFullList">查看全部</button>
                </div>
              </div>
              <div v-else class="muted">当前无待下一轮托盘。</div>
            </section>
          </div>
        </div>

        <aside class="process-task-drawer-side">
          <section class="process-task-summary-card process-task-flow-card" data-testid="process-tray-flow-card">
            <div class="process-task-flow-head">
              <div>
                <div class="process-task-summary-title">统一托盘流程图</div>
              </div>
            </div>
            <ol class="process-task-flow-list process-task-flow-list--timed">
              <li
                v-for="(step, index) in selectedTaskDetail?.selectedTrayFlow?.steps || []"
                :key="step.key"
                :data-flow-step="index"
                :class="{ current: step.active, reached: step.reached }"
              >
                <span class="process-task-flow-label">{{ step.label }}</span>
                <span class="process-task-flow-time">{{ formatFlowTime(step.time) }}</span>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  </div>

  <div class="modal process-task-full-modal" :class="{ 'is-open': taskFullListOpen }" data-testid="process-task-full-list-modal">
    <div class="modal-backdrop" @click="closeTaskFullList"></div>
    <div class="modal-content process-task-full-modal-content">
      <div class="modal-header process-task-modal-header">
        <div>
          <div class="muted process-task-modal-eyebrow">完整清单</div>
          <strong>全部托盘与样品</strong>
        </div>
        <button class="modal-close" type="button" @click="closeTaskFullList">关闭</button>
      </div>
      <div class="process-task-full-summary">
        <span>任务编号：{{ selectedTaskDetail?.code || "-" }}</span>
        <span>托盘：{{ allTaskTrayRows.length }}</span>
        <span>样品：{{ allTaskSampleCount }}</span>
      </div>
      <div class="process-task-full-list">
        <button
          v-for="tray in allTaskTrayRows"
          :key="tray.trayCode"
          class="process-task-full-row"
          :class="{ 'is-selected': selectedTaskDetail?.selectedTrayCode === tray.trayCode }"
          type="button"
          :data-testid="`process-full-tray-row-${tray.trayCode}`"
          @click="selectTaskTray(tray.trayCode)"
        >
          <div>
            <strong>{{ tray.trayCode }}</strong>
            <span>{{ tray.status || tray.flowStatus || "-" }}</span>
          </div>
          <div class="process-task-full-samples">
            <span v-for="sampleCode in tray.sampleCodes || []" :key="`${tray.trayCode}-${sampleCode}`">{{ sampleCode }}</span>
            <span v-if="!(tray.sampleCodes || []).length" class="muted">暂无样品编号</span>
          </div>
        </button>
      </div>
    </div>
  </div>

  <div class="modal process-task-modal" :class="{ 'is-open': startExperimentModalOpen }" id="process-start-modal">
    <div class="modal-backdrop" data-testid="process-start-backdrop" @click="closeStartExperimentModal"></div>
    <div class="modal-content process-task-modal-content">
      <div class="modal-header process-task-modal-header">
        <div>
          <div class="muted process-task-modal-eyebrow">开始实验确认</div>
          <strong>确认开始实验</strong>
        </div>
        <button class="modal-close" type="button" @click="closeStartExperimentModal">关闭</button>
      </div>

      <div class="process-start-modal-body">
        <div class="process-start-modal-meta">
          <div><span>任务编号</span><strong>{{ startExperimentTaskDetail?.code || "-" }}</strong></div>
          <div><span>实验名称</span><strong>{{ startExperimentTaskDetail?.targetExperiment || "-" }}</strong></div>
        </div>
        <div v-if="currentStartableTrayRows.length" class="process-start-tray-list">
          <article v-for="tray in currentStartableTrayRows" :key="tray.trayCode" class="process-start-tray-card">
            <strong>{{ tray.trayCode }}</strong>
            <span>{{ tray.status }}</span>
            <span>{{ tray.sampleSummary }}</span>
          </article>
        </div>
        <div v-else class="muted">当前实验暂无可启动托盘。</div>
        <div class="process-start-modal-actions">
          <button class="action-btn secondary" type="button" @click="closeStartExperimentModal">取消</button>
          <button class="action-btn" data-testid="process-confirm-start" type="button" @click="confirmStartExperiment">确认开始实验</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

import AppFeedback from "@/components/shared/AppFeedback.vue";
import { PROCESS_FILTERS, useProcessLabs } from "./useProcessLabs";

defineOptions({
  name: "ProcessPage",
});

const {
  activeFilter,
  closeTaskDrawer,
  closeStartExperimentModal,
  confirmStartExperiment,
  currentStartableTrayRows,
  idleCount,
  loading,
  openTaskOverview,
  openStartExperimentModal,
  overviewCount,
  processActionMessage,
  runningCount,
  scheduledCount,
  selectedTaskDetail,
  startExperimentTaskDetail,
  selectTaskTray,
  setSelectedTaskForLab,
  setActiveFilter,
  startExperimentModalOpen,
  taskDrawerOpen,
  visibleLabCards,
} = useProcessLabs();

const summaryItems = computed(() => [
  { count: overviewCount.value, key: PROCESS_FILTERS.overview, label: "总览" },
  { count: runningCount.value, key: PROCESS_FILTERS.running, label: "实验进行中" },
  { count: scheduledCount.value, key: PROCESS_FILTERS.scheduled, label: "已排程" },
  { count: idleCount.value, key: PROCESS_FILTERS.idle, label: "空闲" },
]);

const TASK_TRAY_PREVIEW_LIMIT = 5;
const TASK_ROW_PREVIEW_LIMIT = 3;
const TASK_SAMPLE_PREVIEW_LIMIT = 5;
const TASK_ROW_SAMPLE_PREVIEW_LIMIT = 1;
const taskFullListOpen = ref(false);

const takePreview = (items, limit) => (Array.isArray(items) ? items.slice(0, limit) : []);
const hiddenCount = (items, limit) => Math.max(0, (Array.isArray(items) ? items.length : 0) - limit);
const normalizeSampleCodes = (tray) => (Array.isArray(tray?.sampleCodes) ? tray.sampleCodes : [])
  .map((sampleCode) => String(sampleCode || "").trim())
  .filter(Boolean);
const traySamplePreviewText = (tray) => {
  const sampleCodes = normalizeSampleCodes(tray);
  if (sampleCodes.length) {
    return sampleCodes.slice(0, TASK_ROW_SAMPLE_PREVIEW_LIMIT).join("、");
  }
  return String(tray?.sampleSummary || "-").trim() || "-";
};
const hiddenTraySampleCount = (tray) => hiddenCount(normalizeSampleCodes(tray), TASK_ROW_SAMPLE_PREVIEW_LIMIT);

const previewTrayCodes = computed(() => takePreview(selectedTaskDetail.value?.trayCodes, TASK_TRAY_PREVIEW_LIMIT));
const hiddenTrayCodeCount = computed(() => hiddenCount(selectedTaskDetail.value?.trayCodes, TASK_TRAY_PREVIEW_LIMIT));
const previewSelectedSampleCodes = computed(() => takePreview(selectedTaskDetail.value?.selectedTraySummary?.sampleCodes, TASK_SAMPLE_PREVIEW_LIMIT));
const hiddenSelectedSampleCount = computed(() => hiddenCount(selectedTaskDetail.value?.selectedTraySummary?.sampleCodes, TASK_SAMPLE_PREVIEW_LIMIT));
const previewRunningTrayRows = computed(() => takePreview(selectedTaskDetail.value?.runningTrayRows, TASK_ROW_PREVIEW_LIMIT));
const hiddenRunningTrayCount = computed(() => hiddenCount(selectedTaskDetail.value?.runningTrayRows, TASK_ROW_PREVIEW_LIMIT));
const previewRemainingTrayRows = computed(() => takePreview(selectedTaskDetail.value?.remainingTrayRows, TASK_ROW_PREVIEW_LIMIT));
const hiddenRemainingTrayCount = computed(() => hiddenCount(selectedTaskDetail.value?.remainingTrayRows, TASK_ROW_PREVIEW_LIMIT));

const allTaskTrayRows = computed(() => {
  const detail = selectedTaskDetail.value || {};
  const rows = Array.isArray(detail.trayRows) && detail.trayRows.length
    ? detail.trayRows
    : [
        ...(Array.isArray(detail.runningTrayRows) ? detail.runningTrayRows : []),
        ...(Array.isArray(detail.remainingTrayRows) ? detail.remainingTrayRows : []),
        ...(Array.isArray(detail.completedTrayRows) ? detail.completedTrayRows : []),
      ];
  const seen = new Set();
  return rows.filter((row) => {
    const trayCode = String(row?.trayCode || "").trim();
    if (!trayCode || seen.has(trayCode)) {
      return false;
    }
    seen.add(trayCode);
    return true;
  });
});
const allTaskSampleCount = computed(() => {
  const samples = new Set();
  allTaskTrayRows.value.forEach((row) => {
    (Array.isArray(row.sampleCodes) ? row.sampleCodes : []).forEach((sampleCode) => {
      const normalized = String(sampleCode || "").trim();
      if (normalized) {
        samples.add(normalized);
      }
    });
  });
  return samples.size;
});

const openTaskFullList = () => {
  taskFullListOpen.value = true;
};

const closeTaskFullList = () => {
  taskFullListOpen.value = false;
};

const formatFlowTime = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace("T", " ")
    .replace(/\.\d{1,6}/, "")
    .replace(/(?:Z|[+-]\d{2}:?\d{2})$/, "");
};
</script>

<style scoped>
.process-task-modal-content {
  width: min(1260px, 97vw);
  padding: 24px;
}

.process-task-modal-header {
  margin-bottom: 18px;
}

.process-task-modal-eyebrow {
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.process-task-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.16), rgba(245, 158, 11, 0.1));
}

.process-task-code-headline {
  margin: 0;
  font-size: clamp(30px, 4vw, 42px);
  line-height: 1;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--text);
}

.process-task-name-subtitle {
  margin: 10px 0 0;
  font-size: 15px;
  line-height: 1.4;
  color: var(--muted);
}

.process-task-status {
  flex-shrink: 0;
}

.process-task-keyfacts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.process-task-keyfact,
.process-task-summary-card {
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 14px;
  background: rgba(248, 250, 252, 0.9);
  min-width: 0;
  overflow: hidden;
  padding: 14px 16px;
}

.process-task-keyfact span,
.process-task-stat span,
.process-task-inline-field span,
.process-task-detail-row span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.06em;
}

.process-task-keyfact strong,
.process-task-stat strong,
.process-task-inline-field strong,
.process-task-detail-row strong {
  display: block;
  margin-top: 6px;
  font-size: 16px;
  font-weight: 600;
}

.process-task-keyfact-wide {
  grid-column: span 1;
}

.process-task-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.process-task-summary-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 12px;
}

.process-task-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.process-task-stat {
  border-radius: 12px;
  background: #ffffff;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.process-task-inline-field {
  border-radius: 12px;
  background: #ffffff;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.08);
}

.process-task-tray-chip-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  margin-top: 4px;
  width: 100%;
}

.process-task-tray-chip-list.is-single-column {
  grid-template-columns: minmax(0, 1fr);
}

.process-task-tray-chip-list.is-dense {
  gap: 8px;
}

.process-task-tray-chip {
  appearance: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 52px;
  padding: 12px 18px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: linear-gradient(135deg, rgba(226, 232, 240, 0.92), rgba(241, 245, 249, 0.98));
  color: var(--text);
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.02em;
  transition:
    background-color 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease,
    color 140ms ease,
    transform 140ms ease;
}

.process-task-tray-chip:hover {
  border-color: rgba(14, 116, 144, 0.38);
  background: linear-gradient(135deg, rgba(186, 230, 253, 0.78), rgba(224, 242, 254, 0.92));
}

.process-task-tray-chip-emphasis {
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}

.process-task-tray-chip-list.is-dense .process-task-tray-chip {
  min-height: 42px;
  padding: 8px 14px;
  font-size: 14px;
}

.process-task-tray-chip.is-selected {
  border-color: rgba(14, 116, 144, 0.9);
  background: linear-gradient(135deg, rgba(14, 116, 144, 0.94), rgba(3, 105, 161, 0.86));
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.18),
    0 8px 18px rgba(14, 116, 144, 0.18);
  color: #f8fafc;
  transform: translateY(-1px);
}

.process-task-detail-list {
  display: grid;
  gap: 10px;
}

.process-task-sample-code-list {
  display: grid;
  gap: 8px;
}

.process-task-sample-code-row {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #ffffff;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  word-break: break-all;
}

.process-task-more-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 2px;
}

.process-task-more-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(14, 116, 144, 0.08);
  color: #0f766e;
  font-size: 13px;
  font-weight: 700;
}

.process-task-more-button {
  appearance: none;
  cursor: pointer;
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid rgba(14, 116, 144, 0.28);
  border-radius: 999px;
  background: #ffffff;
  color: #0f766e;
  font-size: 13px;
  font-weight: 700;
}

.process-task-sample-hint {
  margin-top: 12px;
  font-size: 12px;
  color: var(--muted);
}

.process-task-detail-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
}

.process-task-detail-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.process-task-detail-row span,
.process-task-detail-row strong {
  margin: 0;
}

.process-control-feedback {
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(34, 197, 94, 0.28);
  background: rgba(34, 197, 94, 0.1);
  color: #166534;
  font-size: 14px;
  font-weight: 600;
}

.process-lab-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: var(--muted);
}

.process-task-batch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.process-task-tray-list {
  display: grid;
  gap: 10px;
}

.process-task-tray-row {
  width: 100%;
  text-align: left;
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(56, 189, 248, 0.22);
  background: rgba(255, 255, 255, 0.96);
  color: var(--text);
}

.process-task-tray-row__select {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 0;
  text-align: left;
  width: 100%;
}

.process-task-tray-row__select strong,
.process-task-tray-row__select span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-task-tray-row.is-selected {
  border-color: rgba(14, 116, 144, 0.45);
  box-shadow: inset 0 0 0 1px rgba(14, 116, 144, 0.12);
}

.process-task-tray-row strong {
  font-size: 14px;
}

.process-task-tray-row span {
  font-size: 12px;
  color: var(--muted);
}

.process-task-more-inline {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
}

.process-task-full-modal-content {
  width: min(980px, 94vw);
  max-height: min(760px, 86vh);
  overflow: auto;
  padding: 22px;
}

.process-task-full-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.process-task-full-summary span {
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  padding: 6px 12px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

.process-task-full-list {
  display: grid;
  gap: 10px;
}

.process-task-full-row {
  appearance: none;
  cursor: pointer;
  display: grid;
  grid-template-columns: minmax(180px, 0.42fr) minmax(0, 1fr);
  gap: 14px;
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 12px;
  background: #ffffff;
  text-align: left;
}

.process-task-full-row.is-selected {
  border-color: rgba(14, 116, 144, 0.65);
  box-shadow: 0 0 0 2px rgba(14, 116, 144, 0.12);
}

.process-task-full-row strong,
.process-task-full-row span {
  display: block;
}

.process-task-full-row strong {
  margin-bottom: 6px;
  color: var(--text);
  font-size: 14px;
}

.process-task-full-row span {
  color: var(--muted);
  font-size: 12px;
}

.process-task-full-samples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.process-task-full-samples span {
  border-radius: 999px;
  background: rgba(226, 232, 240, 0.9);
  padding: 5px 9px;
  color: var(--text);
  font-weight: 600;
  word-break: break-all;
}

.process-task-flow-card {
  height: 100%;
}

.process-task-drawer-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(300px, 0.8fr);
  gap: 16px;
  align-items: start;
  margin-top: 16px;
}

.process-task-drawer-main,
.process-task-drawer-side {
  display: grid;
  gap: 16px;
}

.process-task-flow-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.process-task-flow-status {
  font-size: 13px;
  color: var(--muted);
}

.process-task-tray-meta {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  text-align: right;
}

.process-task-flow-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.process-task-flow-list li {
  position: relative;
  padding: 12px 14px 12px 38px;
  border-radius: 10px;
  border: 1px solid rgba(56, 189, 248, 0.28);
  background: rgba(56, 189, 248, 0.1);
  font-size: 14px;
}

.process-task-flow-list li::before {
  content: "";
  position: absolute;
  left: 12px;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  border-radius: 50%;
  background: rgba(56, 189, 248, 0.9);
}

.process-task-flow-list li.current,
.process-task-flow-list li.reached {
  border-color: rgba(34, 197, 94, 0.45);
  background: rgba(34, 197, 94, 0.14);
}

.process-task-flow-list li.current {
  border-width: 2px;
  font-weight: 700;
}

.process-task-flow-list li.current::before,
.process-task-flow-list li.reached::before {
  background: rgba(34, 197, 94, 0.9);
}

.process-task-flow-list--timed li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 12px;
}

.process-task-flow-label {
  line-height: 1.35;
}

.process-task-flow-time {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  text-align: right;
  white-space: nowrap;
}

@media (max-width: 720px) {
  .process-task-hero,
  .process-task-detail-row,
  .process-task-flow-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .process-task-drawer-layout,
  .process-task-keyfacts,
  .process-task-summary-grid,
  .process-task-stat-grid,
  .process-task-batch-grid {
    grid-template-columns: 1fr;
  }

  .process-task-tray-meta {
    text-align: left;
  }
}
</style>
