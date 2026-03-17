// 围绕实验室占用情况和任务下钻构建过程管控页状态。
import { computed, onMounted, ref } from "vue";

import { PROCESS_LABS, buildProcessLabCards } from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";

// 为抽屉详情提供统一的文案兜底，避免页面出现空串。
const toText = (value, fallback = "-") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

// 数量字段在为 0 时保留数值，其余空值走占位符。
const toCount = (value) => {
  if (value === 0 || value === "0") {
    return 0;
  }
  return value ? value : "-";
};

const BATCH_SUFFIX_PATTERNS = [
  /(?:\s*[-/|]\s*|\s+)?batch\s*[a-z0-9_-]*$/i,
  /(?:\s*[-/|]\s*|\s+)?\u6279\u6b21\s*[a-z0-9_-]*$/i,
];

// 任务名称里如果带“批次 / batch”后缀，抽屉标题会裁掉这部分噪音。
const sanitizeTaskDisplayName = (value, fallback = "-") => {
  let normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  BATCH_SUFFIX_PATTERNS.forEach((pattern) => {
    normalized = normalized.replace(pattern, "").trim();
  });
  return normalized || fallback;
};

// 加载快照数据，并输出实验室卡片及当前任务的抽屉详情。
function useProcessLabs(options = {}) {
  const labs = Array.isArray(options.labs) ? options.labs : PROCESS_LABS;
  const storage = options.storage || useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules, STORAGE_KEYS.samples]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;
  const autoLoad = options.autoLoad !== false;
  const now = options.now;

  const loading = ref(false);
  const labCards = ref([]);
  const tasks = ref([]);
  const schedules = ref([]);
  const samples = ref([]);
  const selectedTaskDetail = ref(null);
  const taskDrawerOpen = ref(false);

  const buildTraySummary = (taskCode, task) => {
    const trayCodes = new Set();

    // 任务记录和样品记录两侧都可能挂托盘号，这里统一归并。
    if (Array.isArray(task?.tray_codes)) {
      task.tray_codes.forEach((code) => {
        const normalized = String(code || "").trim();
        if (normalized) {
          trayCodes.add(normalized);
        }
      });
    }

    samples.value.forEach((sample) => {
      if (String(sample?.task_code || "").trim() !== taskCode) {
        return;
      }
      (Array.isArray(sample?.trays) ? sample.trays : []).forEach((tray) => {
        const normalized = String(tray?.tray_code || "").trim();
        if (normalized) {
          trayCodes.add(normalized);
        }
      });
    });

    const ordered = Array.from(trayCodes).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    const visible = ordered.slice(0, 3);
    const remaining = ordered.length - visible.length;

    return {
      trayCodes: ordered,
      trayCount: ordered.length,
      traySummary: ordered.length === 0 ? "未分配托盘" : `${visible.join(", ")}${remaining > 0 ? ` +${remaining}` : ""}`,
    };
  };

  const buildTaskDetail = (lab) => {
    const taskCode = toText(lab?.taskCode, "");
    const labName = toText(lab?.name);
    const task =
      tasks.value.find((item) => String(item?.code || "").trim() === taskCode) ||
      tasks.value.find((item) => String(item?.required_device || "").trim() === String(lab?.testType || "").trim()) ||
      null;
    const relatedSchedules = schedules.value
      .filter((entry) => String(entry?.device || "").trim() === String(lab?.name || "").trim())
      .sort((left, right) => Date.parse(String(right?.start_at || "")) - Date.parse(String(left?.start_at || "")));
    const schedule =
      relatedSchedules.find((entry) => String(entry?.task_code || "").trim() === taskCode) || relatedSchedules[0] || null;
    // 抽屉里托盘信息始终以当前任务下所有样品的汇总结果为准。
    const { trayCodes, trayCount, traySummary } = buildTraySummary(taskCode, task);

    return {
      code: taskCode || "-",
      displayName: sanitizeTaskDisplayName(task?.name, toText(task?.test_type, "-")),
      dueAt: toText(task?.due_at),
      labName,
      name: toText(task?.name),
      priority: toText(task?.priority),
      requiredDevice: toText(task?.required_device, labName),
      sampleCount: toCount(task?.sample_count),
      scheduleTime: toText(schedule ? `${lab?.scheduleTime || ""}` : lab?.scheduleTime),
      source: toText(task?.source),
      status: toText(task?.status, toText(lab?.status)),
      targetExperiment: toText(task?.test_type, toText(lab?.targetExperiment)),
      testType: toText(task?.test_type, toText(lab?.testType)),
      trayCodes,
      trayCount,
      traySummary,
    };
  };

  const loadLabStatus = async () => {
    loading.value = true;
    try {
      const snapshot = await loadSnapshot();
      tasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
      schedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      samples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      // 卡片最终形态统一由 model 层构建，组合函数只负责取数。
      labCards.value = buildProcessLabCards(labs, tasks.value, schedules.value, now);
    } finally {
      loading.value = false;
    }
  };

  const runningCount = computed(() => labCards.value.filter((lab) => lab.statusClass === "is-running").length);
  const scheduledCount = computed(() => labCards.value.filter((lab) => lab.statusClass === "is-scheduled").length);
  const idleCount = computed(() => labCards.value.filter((lab) => lab.statusClass === "is-idle").length);

  const openTaskOverview = (lab) => {
    selectedTaskDetail.value = buildTaskDetail(lab);
    taskDrawerOpen.value = true;
  };

  const closeTaskDrawer = () => {
    taskDrawerOpen.value = false;
    selectedTaskDetail.value = null;
  };

  if (autoLoad) {
    onMounted(loadLabStatus);
  }

  return {
    closeTaskDrawer,
    idleCount,
    labCards,
    loadLabStatus,
    loading,
    openTaskOverview,
    runningCount,
    scheduledCount,
    selectedTaskDetail,
    taskDrawerOpen,
  };
}

export { sanitizeTaskDisplayName, useProcessLabs };
