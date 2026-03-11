<template>
  <div class="task-overview-summary-card">
    <table class="table task-overview-summary-table">
      <thead>
        <tr>
          <th>任务类型</th>
          <th>当前状态</th>
          <th>是否排期</th>
          <th>样品数量</th>
          <th>托盘分配情况</th>
          <th>托盘数量</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>{{ row.taskType || "-" }}</strong></td>
          <td>
            <span class="task-overview-status-chip">{{ row.currentStatus || "-" }}</span>
          </td>
          <td>
            <span class="task-overview-schedule-chip" :class="row.scheduleCount > 0 ? 'is-scheduled' : 'is-unscheduled'">
              {{ row.scheduleLabel }}
            </span>
          </td>
          <td>{{ row.sampleCount }} / {{ row.plannedCount || "-" }}</td>
          <td>{{ formatTraySummary(row) }}</td>
          <td>{{ formatTrayCount(row) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
defineProps({
  formatTrayCount: {
    type: Function,
    required: true,
  },
  formatTraySummary: {
    type: Function,
    required: true,
  },
  row: {
    type: Object,
    required: true,
  },
});
</script>
