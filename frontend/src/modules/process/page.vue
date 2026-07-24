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

  <ProcessTaskDetailModal
    :detail="selectedTaskDetail"
    :open="taskDrawerOpen"
    @close="closeTaskDrawer"
    @open-full-list="openTaskFullList"
    @open-task-selection="openTaskSelection"
    @select-tray="selectTaskTray"
  />
  <ProcessTaskFullListModal
    :detail="selectedTaskDetail"
    :open="taskFullListOpen"
    @close="closeTaskFullList"
    @select-tray="selectTaskTray"
  />
  <ProcessTaskSelectionModal
    :detail="selectedTaskDetail"
    :open="taskSelectionOpen"
    @close="closeTaskSelection"
    @select="selectTaskOption"
  />
</template>

<script setup>
import { computed } from "vue";

import AppFeedback from "@/components/shared/AppFeedback.vue";
import ProcessTaskDetailModal from "./ProcessTaskDetailModal.vue";
import ProcessTaskFullListModal from "./ProcessTaskFullListModal.vue";
import ProcessTaskSelectionModal from "./ProcessTaskSelectionModal.vue";
import { PROCESS_FILTERS, useProcessLabs } from "./useProcessLabs";
import { useProcessTaskDialogs } from "./useProcessTaskDialogs";

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
  setSelectedTaskForLab,
  setActiveFilter,
  taskDrawerOpen,
  visibleLabCards,
} = useProcessLabs();

const summaryItems = computed(() => [
  { count: overviewCount.value, key: PROCESS_FILTERS.overview, label: "总览" },
  { count: runningCount.value, key: PROCESS_FILTERS.running, label: "实验进行中" },
  { count: scheduledCount.value, key: PROCESS_FILTERS.scheduled, label: "已排程" },
  { count: idleCount.value, key: PROCESS_FILTERS.idle, label: "空闲" },
]);

const {
  closeTaskFullList,
  closeTaskSelection,
  openTaskFullList,
  openTaskSelection,
  selectTaskOption,
  taskFullListOpen,
  taskSelectionOpen,
} = useProcessTaskDialogs({ selectedTaskDetail, setSelectedTaskForLab, taskDrawerOpen });
</script>

<style scoped>
.process-lab-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: var(--muted);
}
</style>
