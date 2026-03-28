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

    <div v-if="processActionMessage" class="process-control-feedback">{{ processActionMessage }}</div>
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
            @click="startExperiment(lab)"
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
              <div class="process-task-inline-field">
                <span>托盘摘要</span>
                <strong>{{ selectedTaskDetail?.traySummary || "未分配托盘" }}</strong>
              </div>
              <div
                v-if="selectedTaskDetail?.selectedTraySummary"
                class="process-task-selected-tray"
                data-testid="process-selected-tray-summary"
              >
                <div class="process-task-selected-tray-head">
                  <div>
                    <span>当前托盘</span>
                    <strong>{{ selectedTaskDetail.selectedTraySummary.trayCode }}</strong>
                  </div>
                  <span class="process-task-selected-tray-status">{{ selectedTaskDetail.selectedTraySummary.status || "-" }}</span>
                </div>
                <div class="process-task-selected-tray-body">
                  <span>样品编号</span>
                  <strong>{{ selectedTaskDetail.selectedTraySummary.sampleSummary || "-" }}</strong>
                </div>
              </div>
              <div v-if="selectedTaskDetail?.trayCodes?.length" class="process-task-tray-chip-list">
                <button
                  v-for="trayCode in selectedTaskDetail.trayCodes"
                  :key="trayCode"
                  class="process-task-tray-chip"
                  :class="{ 'is-selected': selectedTaskDetail?.selectedTrayCode === trayCode }"
                  type="button"
                  :data-testid="`process-tray-chip-${trayCode}`"
                  @click="selectTaskTray(trayCode)"
                >
                  {{ trayCode }}
                </button>
              </div>
            </section>

            <section class="process-task-summary-card">
              <div class="process-task-summary-title">补充信息</div>
              <div class="process-task-detail-list">
                <div class="process-task-detail-row">
                  <span>来源</span>
                  <strong>{{ selectedTaskDetail?.source || "-" }}</strong>
                </div>
                <div class="process-task-detail-row">
                  <span>优先级</span>
                  <strong>{{ selectedTaskDetail?.priority || "-" }}</strong>
                </div>
                <div class="process-task-detail-row">
                  <span>设备要求</span>
                  <strong>{{ selectedTaskDetail?.requiredDevice || "-" }}</strong>
                </div>
                <div class="process-task-detail-row">
                  <span>期望完成</span>
                  <strong>{{ selectedTaskDetail?.dueAt || "-" }}</strong>
                </div>
              </div>
            </section>
          </div>

          <div class="process-task-batch-grid">
            <section class="process-task-summary-card">
              <div class="process-task-summary-title">当前实验托盘</div>
              <div v-if="selectedTaskDetail?.runningTrayRows?.length" class="process-task-tray-list">
                <button
                  v-for="tray in selectedTaskDetail.runningTrayRows"
                  :key="tray.trayCode"
                  class="process-task-tray-row"
                  :class="{ 'is-selected': selectedTaskDetail?.selectedTrayCode === tray.trayCode }"
                  type="button"
                  :data-testid="`process-tray-button-${tray.trayCode}`"
                  @click="selectTaskTray(tray.trayCode)"
                >
                  <strong>{{ tray.trayCode }}</strong>
                  <span>{{ tray.status }}</span>
                  <span>{{ tray.sampleSummary }}</span>
                </button>
              </div>
              <div v-else class="muted">当前无实验中托盘。</div>
            </section>

            <section class="process-task-summary-card">
              <div class="process-task-summary-title">待下一轮托盘</div>
              <div v-if="selectedTaskDetail?.remainingTrayRows?.length" class="process-task-tray-list">
                <button
                  v-for="tray in selectedTaskDetail.remainingTrayRows"
                  :key="tray.trayCode"
                  class="process-task-tray-row"
                  :class="{ 'is-selected': selectedTaskDetail?.selectedTrayCode === tray.trayCode }"
                  type="button"
                  :data-testid="`process-tray-button-${tray.trayCode}`"
                  @click="selectTaskTray(tray.trayCode)"
                >
                  <strong>{{ tray.trayCode }}</strong>
                  <span>{{ tray.status }}</span>
                  <span>{{ tray.sampleSummary }}</span>
                </button>
              </div>
              <div v-else class="muted">当前无待下一轮托盘。</div>
            </section>
          </div>
        </div>

        <aside class="process-task-drawer-side">
          <section class="process-task-summary-card process-task-flow-card">
            <div class="process-task-flow-head">
              <div>
                <div class="process-task-summary-title">统一托盘流程图</div>
                <div class="process-task-flow-status">{{ selectedTaskDetail?.selectedTrayFlow?.currentStatus || "暂无托盘" }}</div>
              </div>
              <div class="process-task-tray-meta" v-if="selectedTaskDetail?.selectedTraySummary">
                <span>位置：{{ selectedTaskDetail.selectedTraySummary.locationSummary }}</span>
                <span>责任人：{{ selectedTaskDetail.selectedTraySummary.ownerSummary }}</span>
                <span>样品：{{ selectedTaskDetail.selectedTraySummary.sampleSummary }}</span>
              </div>
            </div>
            <ol class="process-task-flow-list">
              <li
                v-for="(step, index) in selectedTaskDetail?.selectedTrayFlow?.steps || []"
                :key="step.key"
                :data-flow-step="index"
                :class="{ current: step.active, reached: step.reached }"
              >
                {{ step.label }}
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

import { PROCESS_FILTERS, useProcessLabs } from "./useProcessLabs";

defineOptions({
  name: "ProcessPage",
});

const {
  activeFilter,
  closeTaskDrawer,
  idleCount,
  loading,
  openTaskOverview,
  overviewCount,
  processActionMessage,
  runningCount,
  scheduledCount,
  selectedTaskDetail,
  selectTaskTray,
  setActiveFilter,
  startExperiment,
  taskDrawerOpen,
  visibleLabCards,
} = useProcessLabs();

const summaryItems = computed(() => [
  { count: overviewCount.value, key: PROCESS_FILTERS.overview, label: "总览" },
  { count: runningCount.value, key: PROCESS_FILTERS.running, label: "实验中" },
  { count: scheduledCount.value, key: PROCESS_FILTERS.scheduled, label: "已排程" },
  { count: idleCount.value, key: PROCESS_FILTERS.idle, label: "空闲" },
]);
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

.process-task-selected-tray {
  margin-top: 12px;
  border-radius: 14px;
  border: 1px solid rgba(56, 189, 248, 0.24);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(255, 255, 255, 0.96));
  padding: 14px;
}

.process-task-selected-tray-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.process-task-selected-tray-head > div {
  min-width: 0;
  flex: 1;
}

.process-task-selected-tray-head span,
.process-task-selected-tray-body span {
  display: block;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.06em;
}

.process-task-selected-tray-head strong,
.process-task-selected-tray-body strong {
  display: block;
  margin-top: 6px;
  font-size: 16px;
  font-weight: 700;
}

.process-task-selected-tray-head strong {
  white-space: nowrap;
}

.process-task-selected-tray-status {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.28);
  background: rgba(255, 255, 255, 0.82);
}

.process-task-selected-tray-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(15, 23, 42, 0.08);
}

.process-task-tray-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.process-task-tray-chip {
  appearance: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  padding: 7px 12px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.35);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.18), rgba(59, 130, 246, 0.08));
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.process-task-tray-chip.is-selected {
  border-color: rgba(14, 116, 144, 0.45);
  box-shadow: inset 0 0 0 1px rgba(14, 116, 144, 0.12);
}

.process-task-detail-list {
  display: grid;
  gap: 10px;
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
  appearance: none;
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
