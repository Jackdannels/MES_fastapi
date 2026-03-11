<template>
  <div class="task-overview-tray-wrap">
    <div class="task-overview-tray-total">托盘总数：{{ trayOverviewTotal }}</div>
    <table class="table task-overview-tray-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>托盘编号</th>
          <th>任务编号</th>
          <th>目标实验</th>
          <th>排期状态</th>
          <th>实验室</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="tray in trayOverviewRows" :key="tray.slotCode">
          <td>{{ tray.slotCode }}</td>
          <td>{{ tray.trayCode }}</td>
          <td>{{ tray.taskCode }}</td>
          <td>{{ tray.targetExperiment }}</td>
          <td>
            <span class="task-overview-schedule-chip" :class="tray.isScheduled ? 'is-scheduled' : 'is-unscheduled'">
              {{ tray.scheduleStatus }}
            </span>
          </td>
          <td>{{ tray.isScheduled ? tray.lab : "-" }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
defineProps({
  trayOverviewRows: {
    type: Array,
    default: () => [],
  },
  trayOverviewTotal: {
    type: Number,
    default: 0,
  },
});
</script>
