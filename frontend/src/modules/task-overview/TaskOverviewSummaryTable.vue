<template>
  <div class="task-overview-summary-card">
    <table class="table task-overview-summary-table">
      <thead>
        <tr>
          <th>任务状态</th>
          <th>实验数</th>
          <th>试验内容</th>
          <th>实验状态</th>
          <th>样品数量</th>
          <th>托盘分配摘要</th>
          <th>托盘数量</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <span class="task-overview-status-chip">{{ row.currentStatus || "-" }}</span>
          </td>
          <td>{{ row.experimentCount > 0 ? row.experimentCount : "-" }}</td>
          <td>
            <div class="task-overview-summary-lines is-centered">
              <span v-for="item in experimentLines" :key="item.key" class="task-overview-summary-line">
                {{ item.label }}
              </span>
            </div>
          </td>
          <td>
            <div class="task-overview-summary-lines is-centered">
              <span
                v-for="item in experimentLines"
                :key="`${item.key}-status`"
                class="task-overview-summary-line task-overview-summary-line-chip"
                :class="resolveExperimentStatusClass(item.status)"
              >
                {{ item.status }}
              </span>
            </div>
          </td>
          <td>{{ row.sampleCount }} / {{ row.plannedCount || "-" }}</td>
          <td>
            <div class="task-overview-summary-lines is-centered">
              <span v-for="item in trayLines" :key="item" class="task-overview-summary-line">
                {{ item }}
              </span>
            </div>
          </td>
          <td>{{ formatTrayCount(row) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
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

const experimentLines = computed(() => {
  const experiments = Array.isArray(props.row?.experiments) ? props.row.experiments : [];
  if (experiments.length > 0) {
    return experiments.map((experiment, index) => ({
      key: experiment?.experimentCode || `experiment-${index}`,
      label: experiment?.experimentName || experiment?.experimentCode || "-",
      status: experiment?.displayStatus || props.row?.currentStatus || props.row?.scheduleLabel || "-",
    }));
  }
  return [
    {
      key: "task-default",
      label: props.row?.experimentSummary || props.row?.taskType || "-",
      status: props.row?.currentStatus || props.row?.scheduleLabel || "-",
    },
  ];
});

const trayLines = computed(() => {
  const trays = Array.isArray(props.row?.trays) ? props.row.trays : [];
  if (trays.length > 0) {
    return trays.map((tray) => String(tray?.trayCode || "").trim()).filter(Boolean);
  }
  const fallback = String(props.formatTraySummary(props.row) || "").trim();
  return [fallback || "未分配托盘"];
});

function resolveExperimentStatusClass(status) {
  const text = String(status || "").trim();
  if (!text || text === "未排程" || text === "待排程") {
    return "is-unscheduled";
  }
  if (text.includes("完成") || text.includes("收回")) {
    return "is-completed";
  }
  if (text.includes("实验中") || text.includes("进行中") || text.includes("准备")) {
    return "is-running";
  }
  return "is-scheduled";
}
</script>
