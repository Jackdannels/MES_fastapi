<template>
  <section class="grid cols-4 stagger">
    <div class="card">
      <div class="muted">今日受理</div>
      <div class="kpi" id="dashboard-intake-count">{{ summaryCards.intakeCount }}</div>
      <div class="muted" id="dashboard-intake-note">{{ summaryCards.intakeNote }}</div>
    </div>
    <div class="card">
      <div class="muted">已排程</div>
      <div class="kpi" id="dashboard-scheduled-count">{{ summaryCards.scheduledCount }}</div>
      <div class="muted">未来 48 小时</div>
    </div>
    <div class="card">
      <div class="muted">待排程</div>
      <div class="kpi" id="dashboard-unscheduled-count">{{ summaryCards.unscheduledCount }}</div>
      <div class="muted">需设备空闲</div>
    </div>
    <div class="card">
      <div class="muted">正在运行</div>
      <div class="kpi" id="dashboard-device-count">{{ summaryCards.deviceCount }}</div>
      <div class="muted" id="dashboard-device-note">{{ summaryCards.deviceNote }}</div>
    </div>
    <div class="card">
      <div class="muted">预警</div>
      <div class="kpi" id="dashboard-alert-count">{{ summaryCards.alertCount }}</div>
      <div class="muted" id="dashboard-alert-note">{{ summaryCards.alertNote }}</div>
    </div>
  </section>

  <section class="grid cols-3 section">
    <div class="card">
      <div class="dashboard-task-header">
        <h3>任务队列</h3>
        <div class="dashboard-task-pagination" id="dashboard-task-pagination">
          <AppPagination :current-page="currentPage" :page-count="pageCount" @change="setCurrentPage" />
        </div>
      </div>
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
      <h3>设备空闲</h3>
      <div class="timeline" id="dashboard-device-list">
        <div v-for="device in deviceItems" :key="device.code" class="timeline-item">
          <div class="timeline-dot"></div>
          <div>
            <div>{{ device.code }}</div>
            <div class="muted">{{ device.status }}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h3>数据通道</h3>
      <div class="muted">Modbus 采集健康度</div>
      <div class="kpi" id="dashboard-data-health">{{ dataHealth }}</div>
      <div class="muted" id="dashboard-data-gap">{{ dataGap }}</div>
    </div>
  </section>
</template>

<script setup>
import AppPagination from "@/components/shared/AppPagination.vue";
import { useDashboardPage } from "@/composables/useDashboardPage";

const { currentPage, dataGap, dataHealth, deviceItems, pageCount, pagedTaskRows, setCurrentPage, summaryCards } =
  useDashboardPage();
</script>
