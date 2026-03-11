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
</template>

<script setup>
import { useProcessLabs } from "@/composables/useProcessLabs";

const { idleCount, labCards, loading, openTaskOverview, runningCount, scheduledCount } = useProcessLabs();
</script>
