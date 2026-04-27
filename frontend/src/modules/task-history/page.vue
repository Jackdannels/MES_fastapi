<template>
  <section class="card section">
    <h3>历史任务数据</h3>
    <div v-if="loadError" class="form-alert">{{ loadError }}</div>
    <table class="table">
      <thead>
        <tr>
          <th>序号</th>
          <th>任务编号</th>
          <th>任务名称</th>
          <th>状态</th>
          <th>更新时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="taskRows.length === 0">
          <td colspan="5" class="muted">暂无历史任务数据</td>
        </tr>
        <tr v-for="(task, index) in taskRows" :key="task.id || task.code || index">
          <td>{{ index + 1 }}</td>
          <td>{{ task.code || "-" }}</td>
          <td>{{ task.name || task.test_type || "-" }}</td>
          <td>{{ task.status || task.transfer_status || "-" }}</td>
          <td>{{ task.updated_at || task.created_at || "-" }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

import { readTasks } from "@/lib/tasksApi";

const tasks = ref([]);
const loadError = ref("");

const taskRows = computed(() =>
  tasks.value
    .slice()
    .sort((left, right) => String(right?.updated_at || right?.created_at || "").localeCompare(String(left?.updated_at || left?.created_at || ""))),
);

onMounted(async () => {
  try {
    const loadedTasks = await readTasks();
    tasks.value = Array.isArray(loadedTasks) ? loadedTasks : [];
    loadError.value = "";
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    loadError.value = detail ? `历史任务数据加载失败，${detail}` : "历史任务数据加载失败";
  }
});
</script>
