<template>
  <section class="card section">
    <div class="task-overview-header">
      <h3>任务总览</h3>
      <div class="task-overview-actions">
        <input v-model.trim="keyword" class="search-input" placeholder="按任务编号/任务类型/样品编号筛选" />
        <select v-model="timeFilter" class="search-input">
          <option value="all">全部时间</option>
          <option value="today">今天</option>
          <option value="last7">近7天</option>
          <option value="last30">近30天</option>
          <option value="thisYear">本年</option>
        </select>
        <select v-model="testTypeFilter" class="search-input">
          <option value="">全部实验类型</option>
          <option v-for="type in testTypeOptions" :key="type" :value="type">{{ type }}</option>
        </select>
        <button class="action-btn secondary" type="button" @click="loadOverview">刷新数据</button>
      </div>
    </div>

    <div v-if="loading" class="muted">正在加载任务明细...</div>
    <div v-else-if="filteredRows.length === 0" class="muted">暂无可展示的任务信息。</div>

    <div v-else class="task-overview-list">
      <article v-for="row in filteredRows" :key="row.taskCode" class="task-overview-card">
        <div class="task-overview-main">
          <div class="task-overview-title">{{ row.taskCode }}</div>
          <div class="task-overview-meta">
            <span>任务类型：{{ row.taskType || "-" }}</span>
            <span>当前状态：{{ row.currentStatus }}</span>
            <span>是否排期：{{ row.scheduleLabel }}</span>
            <span>样品数量：{{ row.sampleCount }} / {{ row.plannedCount || "-" }}</span>
            <span>托盘数量：{{ row.trays.length }}</span>
          </div>
        </div>

        <div class="task-overview-block">
          <div class="task-overview-label">样品编号</div>
          <div class="task-overview-codes">
            <span v-for="code in row.sampleCodes" :key="code" class="task-overview-chip">{{ code }}</span>
          </div>
        </div>

        <div class="task-overview-block">
          <div class="task-overview-label">托盘分配情况</div>
          <div v-if="row.trays.length === 0" class="muted">未分配托盘</div>
          <table v-else class="table task-overview-table">
            <thead>
              <tr>
                <th>托盘编号</th>
                <th>样品编号</th>
                <th>数量合计</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tray in row.trays" :key="tray.trayCode">
                <td>{{ tray.trayCode }}</td>
                <td>{{ tray.sampleCodes.join("、") }}</td>
                <td>{{ tray.totalQuantity }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

const STORAGE_KEYS = {
  tasks: "mes.tasks",
  samples: "mes.samples",
  schedules: "mes.schedules",
};

const loading = ref(false);
const keyword = ref("");
const timeFilter = ref("all");
const testTypeFilter = ref("");
const rows = ref([]);

const parseJson = (raw, fallback) => {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const readLocalArray = (key) => {
  if (typeof window === "undefined") {
    return [];
  }
  const parsed = parseJson(window.localStorage.getItem(key), []);
  return Array.isArray(parsed) ? parsed : [];
};

const normalizeQuantity = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
};

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");

const buildRows = (tasks, samples, schedules) => {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const sampleList = Array.isArray(samples) ? samples : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const taskMap = new Map();

  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskMap.set(code, {
      taskCode: code,
      taskType: String(task?.test_type || task?.name || "").trim(),
      taskStatus: String(task?.status || "").trim(),
      plannedCount: Number.isFinite(Number(task?.sample_count)) ? Number(task.sample_count) : "",
      timeValue: String(task?.created_at || task?.arrival_at || task?.due_at || "").trim(),
      sampleCodes: [],
      trays: [],
      scheduleCount: 0,
    });
  });

  sampleList.forEach((sample) => {
    const taskCode = String(sample?.task_code || "").trim();
    const sampleCode = String(sample?.code || "").trim();
    if (!taskCode || !sampleCode) {
      return;
    }
    if (!taskMap.has(taskCode)) {
      taskMap.set(taskCode, {
        taskCode,
        taskType: "",
        taskStatus: "",
        plannedCount: "",
        timeValue: "",
        sampleCodes: [],
        trays: [],
        scheduleCount: 0,
      });
    }
    const row = taskMap.get(taskCode);
    row.sampleCodes.push(sampleCode);
    if (Array.isArray(sample?.trays)) {
      sample.trays.forEach((tray) => {
        const trayCode = String(tray?.tray_code || "").trim();
        if (!trayCode) {
          return;
        }
        row.trays.push({
          trayCode,
          sampleCode,
          quantity: normalizeQuantity(tray?.quantity),
        });
      });
    }
  });

  scheduleList.forEach((entry) => {
    const taskCode = String(entry?.task_code || "").trim();
    if (!taskCode) {
      return;
    }
    if (!taskMap.has(taskCode)) {
      taskMap.set(taskCode, {
        taskCode,
        taskType: "",
        taskStatus: "",
        plannedCount: "",
        timeValue: String(entry?.start_at || entry?.created_at || "").trim(),
        sampleCodes: [],
        trays: [],
        scheduleCount: 0,
      });
    }
    const row = taskMap.get(taskCode);
    row.scheduleCount += 1;
    if (!row.taskStatus) {
      row.taskStatus = String(entry?.status || "").trim();
    }
    if (!row.timeValue) {
      row.timeValue = String(entry?.start_at || entry?.created_at || "").trim();
    }
  });

  const output = Array.from(taskMap.values()).map((row) => {
    const uniqueSampleCodes = Array.from(new Set(row.sampleCodes)).sort(compareText);
    const trayMap = new Map();
    row.trays.forEach((tray) => {
      if (!trayMap.has(tray.trayCode)) {
        trayMap.set(tray.trayCode, {
          trayCode: tray.trayCode,
          sampleCodes: [],
          totalQuantity: 0,
        });
      }
      const current = trayMap.get(tray.trayCode);
      if (!current.sampleCodes.includes(tray.sampleCode)) {
        current.sampleCodes.push(tray.sampleCode);
      }
      current.totalQuantity += normalizeQuantity(tray.quantity);
    });

    const trays = Array.from(trayMap.values())
      .map((item) => ({
        ...item,
        sampleCodes: item.sampleCodes.slice().sort(compareText),
      }))
      .sort((left, right) => compareText(left.trayCode, right.trayCode));

    const scheduleLabel = row.scheduleCount > 0 ? "已排期" : "未排期";
    const currentStatus = row.taskStatus || scheduleLabel;

    return {
      ...row,
      currentStatus,
      scheduleLabel,
      sampleCodes: uniqueSampleCodes,
      sampleCount: uniqueSampleCodes.length,
      trays,
    };
  });

  return output.sort((left, right) => compareText(left.taskCode, right.taskCode));
};

const loadOverview = async () => {
  loading.value = true;
  try {
    let tasks = readLocalArray(STORAGE_KEYS.tasks);
    let samples = readLocalArray(STORAGE_KEYS.samples);
    let schedules = readLocalArray(STORAGE_KEYS.schedules);

    try {
      const response = await fetch("/api/storage", { headers: { Accept: "application/json" } });
      if (response.ok) {
        const payload = await response.json();
        if (Array.isArray(payload?.[STORAGE_KEYS.tasks])) {
          tasks = payload[STORAGE_KEYS.tasks];
        }
        if (Array.isArray(payload?.[STORAGE_KEYS.samples])) {
          samples = payload[STORAGE_KEYS.samples];
        }
        if (Array.isArray(payload?.[STORAGE_KEYS.schedules])) {
          schedules = payload[STORAGE_KEYS.schedules];
        }
      }
    } catch {
      // fallback to local data
    }

    rows.value = buildRows(tasks, samples, schedules);
  } finally {
    loading.value = false;
  }
};

const filteredRows = computed(() => {
  const query = keyword.value.toLowerCase();
  const selectedType = testTypeFilter.value.trim();
  const selectedTime = timeFilter.value;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ms7 = 7 * 24 * 60 * 60 * 1000;
  const ms30 = 30 * 24 * 60 * 60 * 1000;

  const matchTime = (row) => {
    if (selectedTime === "all") {
      return true;
    }
    const rowTime = new Date(row.timeValue || "").getTime();
    if (!Number.isFinite(rowTime)) {
      return false;
    }
    if (selectedTime === "today") {
      return rowTime >= startOfToday;
    }
    if (selectedTime === "last7") {
      return now.getTime() - rowTime <= ms7;
    }
    if (selectedTime === "last30") {
      return now.getTime() - rowTime <= ms30;
    }
    if (selectedTime === "thisYear") {
      return new Date(rowTime).getFullYear() === now.getFullYear();
    }
    return true;
  };

  return rows.value.filter((row) => {
    if (selectedType && (row.taskType || "") !== selectedType) {
      return false;
    }
    if (!matchTime(row)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const text = [
      row.taskCode,
      row.taskType,
      row.currentStatus,
      row.scheduleLabel,
      row.sampleCodes.join(" "),
      row.trays.map((tray) => tray.trayCode).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(query);
  });
});

const testTypeOptions = computed(() =>
  Array.from(new Set(rows.value.map((row) => String(row.taskType || "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN")
  )
);

onMounted(loadOverview);
</script>
