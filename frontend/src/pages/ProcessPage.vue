<template>
  <section class="card section process-control-page">
    <div class="process-control-header">
      <div>
        <h3>试验过程管控</h3>
        <div class="muted">展示各实验室当前状态，暂存间不纳入本页。</div>
      </div>
      <div class="process-control-summary">
        <div class="process-control-summary-item">
          <span class="process-control-summary-label">实验中</span>
          <strong>{{ runningCount }}</strong>
        </div>
        <div class="process-control-summary-item">
          <span class="process-control-summary-label">已排期</span>
          <strong>{{ scheduledCount }}</strong>
        </div>
        <div class="process-control-summary-item">
          <span class="process-control-summary-label">空闲</span>
          <strong>{{ idleCount }}</strong>
        </div>
      </div>
    </div>

    <div v-if="loading" class="muted">正在加载实验室状态...</div>
    <div v-else class="process-lab-grid">
      <article v-for="lab in labCards" :key="lab.name" class="process-lab-card" :class="lab.statusClass">
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
            <span>排期时间</span>
            <strong>{{ lab.scheduleTime }}</strong>
          </div>
        </div>

        <div class="process-lab-actions">
          <button class="action-btn secondary" type="button" @click="openTaskOverview(lab)">查看任务</button>
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
          <span>排期时间</span>
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
          <div v-if="selectedTaskDetail?.trayCodes?.length" class="process-task-tray-chip-list">
            <span v-for="trayCode in selectedTaskDetail.trayCodes" :key="trayCode" class="process-task-tray-chip">
              {{ trayCode }}
            </span>
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
    </div>
  </div>
</template>

<script setup>
import { useProcessLabs } from "@/composables/useProcessLabs";

const {
  closeTaskDrawer,
  idleCount,
  labCards,
  loading,
  openTaskOverview,
  runningCount,
  scheduledCount,
  selectedTaskDetail,
  taskDrawerOpen,
} = useProcessLabs();
</script>

<style scoped>
.process-task-modal-content {
  width: min(760px, 92vw);
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
  margin-top: 16px;
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
  margin-top: 16px;
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
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.process-task-tray-chip {
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

@media (max-width: 720px) {
  .process-task-hero,
  .process-task-detail-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .process-task-keyfacts,
  .process-task-summary-grid,
  .process-task-stat-grid {
    grid-template-columns: 1fr;
  }
}
</style>
