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
          <th>当前状态</th>
          <th>当前位置</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="tray in trayOverviewRows" :key="tray.slotCode">
          <td>{{ tray.slotCode }}</td>
          <td>{{ tray.trayCode }}</td>
          <td>{{ tray.taskCode }}</td>
          <td>{{ tray.targetExperiment }}</td>
          <td>
            <span v-if="hasCurrentStatus(tray)" class="task-overview-schedule-chip is-scheduled">
              {{ tray.currentStatus }}
            </span>
            <span v-else>-</span>
          </td>
          <td>{{ tray.currentLocation || "-" }}</td>
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

const hasCurrentStatus = (tray) => {
  const status = String(tray?.currentStatus || "").trim();
  return Boolean(status && status !== "-");
};
</script>
