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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

const STORAGE_KEYS = {
  tasks: "mes.tasks",
  schedules: "mes.schedules",
};

const LABS = [
  { name: "冲击一室", testType: "冲击试验" },
  { name: "冲击二室", testType: "冲击试验" },
  { name: "振动一室", testType: "振动试验" },
  { name: "振动二室", testType: "振动试验" },
  { name: "四综合实验室", testType: "四综合试验" },
  { name: "温度冲击一室", testType: "温度冲击试验" },
  { name: "温度冲击二室", testType: "温度冲击试验" },
  { name: "高低温湿热一室", testType: "高低温湿热试验" },
  { name: "盐雾试验室", testType: "盐雾试验" },
  { name: "霉菌试验室", testType: "霉菌试验" },
];

const loading = ref(false);
const labCards = ref([]);

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

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");

const formatDateTime = (value) => {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) {
    return "-";
  }
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
};

const readStorageSnapshot = async () => {
  let tasks = readLocalArray(STORAGE_KEYS.tasks);
  let schedules = readLocalArray(STORAGE_KEYS.schedules);

  try {
    const response = await fetch("/api/storage", { headers: { Accept: "application/json" } });
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload?.[STORAGE_KEYS.tasks])) {
        tasks = payload[STORAGE_KEYS.tasks];
      }
      if (Array.isArray(payload?.[STORAGE_KEYS.schedules])) {
        schedules = payload[STORAGE_KEYS.schedules];
      }
    }
  } catch {
    // keep local fallback
  }

  return { tasks, schedules };
};

const buildLabCards = (tasks, schedules) => {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const taskMap = new Map();
  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskMap.set(code, task);
  });

  const now = Date.now();

  return LABS.map((lab) => {
    const labSchedules = scheduleList
      .filter((entry) => String(entry?.device || "").trim() === lab.name)
      .sort((left, right) => Date.parse(String(right?.start_at || "")) - Date.parse(String(left?.start_at || "")));

    const activeSchedule =
      labSchedules.find((entry) => {
        const start = Date.parse(String(entry?.start_at || ""));
        const end = Date.parse(String(entry?.end_at || ""));
        return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
      }) || null;

    const nextSchedule =
      activeSchedule ||
      labSchedules.find((entry) => {
        const start = Date.parse(String(entry?.start_at || ""));
        return Number.isFinite(start) && start > now;
      }) ||
      labSchedules[0] ||
      null;

    const taskCode = String(nextSchedule?.task_code || "").trim();
    const task = taskMap.get(taskCode);
    const targetExperiment = String(task?.test_type || task?.name || lab.testType || "").trim() || "-";

    let status = "空闲";
    let statusClass = "is-idle";
    if (activeSchedule) {
      status = "实验中";
      statusClass = "is-running";
    } else if (nextSchedule) {
      status = "已排期";
      statusClass = "is-scheduled";
    }

    return {
      name: lab.name,
      testType: lab.testType,
      status,
      statusClass,
      taskCode: taskCode || "-",
      targetExperiment: taskCode ? targetExperiment : "未分配",
      scheduleTime: nextSchedule
        ? `${formatDateTime(nextSchedule.start_at)} - ${formatDateTime(nextSchedule.end_at)}`
        : "暂无排期",
    };
  }).sort((left, right) => compareText(left.name, right.name));
};

const loadLabStatus = async () => {
  loading.value = true;
  try {
    const { tasks, schedules } = await readStorageSnapshot();
    labCards.value = buildLabCards(tasks, schedules);
  } finally {
    loading.value = false;
  }
};

const runningCount = computed(() => labCards.value.filter((lab) => lab.status === "实验中").length);
const scheduledCount = computed(() => labCards.value.filter((lab) => lab.status === "已排期").length);
const idleCount = computed(() => labCards.value.filter((lab) => lab.status === "空闲").length);

const openTaskOverview = (lab) => {
  const params = new URLSearchParams();
  const testType = String(lab?.testType || "").trim();
  const taskCode = String(lab?.taskCode || "").trim();
  if (testType) {
    params.set("testType", testType);
  }
  if (taskCode && taskCode !== "-") {
    params.set("task", taskCode);
  }
  const query = params.toString();
  router.push(query ? `/task-overview?${query}` : "/task-overview");
};

onMounted(loadLabStatus);
</script>
