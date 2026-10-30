<template>
  <section class="grid cols-4 stagger">
    <div class="card">
      <div class="muted">已受理任务</div>
      <div class="kpi" :class="{ 'dashboard-kpi-pending': !hasLoaded }" id="dashboard-intake-count">{{ hasLoaded ? summaryCards.intakeCount : pendingCount }}</div>
      <div v-if="hasLoaded" class="muted" id="dashboard-intake-note">{{ summaryCards.intakeNote }}</div>
    </div>
    <div class="card">
      <div class="muted">已排程</div>
      <div class="kpi" :class="{ 'dashboard-kpi-pending': !hasLoaded }" id="dashboard-scheduled-count">{{ hasLoaded ? summaryCards.scheduledCount : pendingCount }}</div>
    </div>
    <div class="card">
      <div class="muted">待排程</div>
      <div class="kpi" :class="{ 'dashboard-kpi-pending': !hasLoaded }" id="dashboard-unscheduled-count">{{ hasLoaded ? summaryCards.unscheduledCount : pendingCount }}</div>
      <div class="muted">需设备可用</div>
    </div>
    <div class="card">
      <div class="muted">正在运行（实验）</div>
      <div class="kpi" :class="{ 'dashboard-kpi-pending': !hasLoaded }" id="dashboard-device-count">{{ hasLoaded ? summaryCards.deviceCount : pendingCount }}</div>
    </div>
    <div class="card">
      <div class="muted">预警</div>
      <div class="kpi" :class="{ 'dashboard-kpi-pending': !hasLoaded }" id="dashboard-alert-count">{{ hasLoaded ? summaryCards.alertCount : pendingCount }}</div>
      <div v-if="hasLoaded" class="muted" id="dashboard-alert-note">{{ summaryCards.alertNote }}</div>
    </div>
  </section>

  <section class="grid cols-3 section dashboard-main-grid">
    <div class="card">
      <div class="dashboard-task-header">
        <h3 v-app-icon="{ name: 'clipboard' }">任务队列</h3>
        <div v-if="hasLoaded" class="dashboard-task-pagination" id="dashboard-task-pagination">
          <AppPagination
            :current-page="currentPage"
            :page-count="pageCount"
            @change="setCurrentPage"
          />
        </div>
      </div>
      <div v-if="loadError" class="form-alert" data-testid="dashboard-load-error">{{ localizeResponseMessage(loadError) }}</div>
      <table class="table">
        <thead>
          <tr>
            <th>序号</th>
            <th>任务</th>
            <th>来源</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody id="dashboard-task-body">
          <tr v-if="!hasLoaded"><td colspan="4" class="muted" role="status">{{ firstReadMessage }}</td></tr>
          <tr v-else-if="!pagedTaskRows.length"><td colspan="4" class="muted">暂无任务</td></tr>
          <tr v-for="task in pagedTaskRows" :key="task.code">
            <td>{{ task.index }}</td>
            <td>{{ task.code }}</td>
            <td>{{ task.source }}</td>
            <td>
              <span :class="task.statusClass">{{ task.status }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="card">
      <h3 v-app-icon="{ name: 'cpu' }">设备状态</h3>
      <div class="timeline" id="dashboard-device-list">
        <div v-if="!hasLoaded" class="muted" role="status">{{ firstReadMessage }}</div>
        <div v-else-if="!deviceItems.length" class="muted">暂无设备数据</div>
        <div v-for="device in deviceItems" :key="device.code" class="timeline-item">
          <div class="timeline-dot" :class="device.dotClass"></div>
          <div>
            <div>{{ device.code }}</div>
            <div class="muted">{{ device.status }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3 v-app-icon="{ name: 'clock' }">未排程实验计时</h3>
      <div v-if="!hasLoaded" class="muted" role="status">{{ firstReadMessage }}</div>
      <div v-else-if="unscheduledExperimentItems.length" class="timeline" id="dashboard-unscheduled-list">
        <div v-for="item in unscheduledExperimentItems" :key="`${item.taskCode}-${item.experimentCode}`" class="timeline-item">
          <div class="timeline-dot"></div>
          <div class="dashboard-unscheduled-item">
            <div class="dashboard-unscheduled-title" :class="{ 'is-overdue': item.isOverdue }">{{ item.taskCode }} / {{ item.experimentLabel }}</div>
            <div class="dashboard-unscheduled-timer" :class="{ 'is-overdue': item.isOverdue }">{{ item.elapsedLabel }}</div>
          </div>
        </div>
      </div>
      <div v-else class="muted" id="dashboard-unscheduled-empty">暂无未排程实验</div>
    </div>
  </section>
</template>

<script setup>
import { localizeResponseMessage } from "@/lib/responseMessages";
import { vAppIcon } from "@/directives/appIcon";
defineOptions({
  name: "DashboardPage",
});

import AppPagination from "@/components/shared/AppPagination.vue";
import { computed } from "vue";
import { useDashboardPage } from "./useDashboardPage";

const { currentPage, deviceItems, hasLoaded, isInitialLoading, loadError, pageCount, pagedTaskRows, setCurrentPage, summaryCards, unscheduledExperimentItems } =
  useDashboardPage();
const pendingCount = computed(() => isInitialLoading.value ? "加载中…" : "—");
const firstReadMessage = computed(() => isInitialLoading.value ? "正在加载数据…" : "数据暂不可用，请稍后重试");
</script>
