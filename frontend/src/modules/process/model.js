import { aggregateTaskStatusFromSamples } from "@/modules/tasks/model";

// 根据当前排程状态生成过程管控页的实验室卡片和跳转目标。
const PROCESS_LABS = [
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

// 中文名称排序时统一使用简体中文排序规则。
const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验中";
const STATUS_IDLE = "空闲";

// 过程卡片只展示月/日 + 时:分，因此在这里统一格式化。
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

const resolveScheduledExperimentLabel = ({ experiments, fallback, schedule, taskCode }) => {
  const normalizedExperimentCode = String(schedule?.experiment_code || "").trim();
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const matchedExperiment = experimentList.find(
    (experiment) =>
      String(experiment?.task_code || "").trim() === String(taskCode || "").trim()
      && String(experiment?.experiment_code || "").trim() === normalizedExperimentCode
  );
  const experimentName = String(matchedExperiment?.experiment_name || "").trim();
  if (experimentName) {
    return experimentName;
  }
  const fallbackText = String(fallback || "").trim();
  return fallbackText || "-";
};

// 构建过程管控页展示的实验室卡片集合。
const buildProcessLabCards = (labs, tasks, schedules, samplesOrNow, nowMaybe, experiments = []) => {
  const sampleList = Array.isArray(samplesOrNow) ? samplesOrNow : [];
  const now = Array.isArray(samplesOrNow) ? (Number.isFinite(nowMaybe) ? nowMaybe : Date.now()) : samplesOrNow ?? Date.now();
  const labList = Array.isArray(labs) ? labs : [];
  const taskList = Array.isArray(tasks) ? tasks : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const taskMap = new Map();
  const taskStatusMap = new Map();

  // 先把任务按任务号建索引，后续排程关联时可 O(1) 查找任务信息。
  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskMap.set(code, task);
    taskStatusMap.set(
      code,
      aggregateTaskStatusFromSamples(
        task,
        sampleList.filter((sample) => String(sample?.task_code || "").trim() === code),
      ),
    );
  });

  return labList
    .map((lab) => {
      // 每个实验室只关注绑定到该实验室的排程，并优先看最近开始的记录。
      const labSchedules = scheduleList
        .filter((entry) => String(entry?.device || "").trim() === lab.name)
        .sort((left, right) => Date.parse(String(right?.start_at || "")) - Date.parse(String(left?.start_at || "")));

      // 当前命中排程窗口只说明已进入执行时段，不能自动说明已经开始实验。
      const activeSchedule =
        labSchedules.find((entry) => {
          const start = Date.parse(String(entry?.start_at || ""));
          const end = Date.parse(String(entry?.end_at || ""));
          return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
        }) || null;
      const runningSchedule =
        labSchedules.find((entry) => taskStatusMap.get(String(entry?.task_code || "").trim()) === STATUS_RUNNING) || null;

      // 没有进行中的情况下，展示最近的未来排程。
      const upcomingSchedule =
        labSchedules.find((entry) => {
          const start = Date.parse(String(entry?.start_at || ""));
          return Number.isFinite(start) && start > now;
        }) || null;
      const nextSchedule = activeSchedule || runningSchedule || upcomingSchedule || null;

      const taskCode = String(nextSchedule?.task_code || "").trim();
      const task = taskMap.get(taskCode);
      const aggregatedTaskStatus = taskStatusMap.get(taskCode) || "";
      // 目标试验名称优先取任务配置，其次回退到实验室默认试验类型。
      const targetExperiment = resolveScheduledExperimentLabel({
        experiments,
        fallback: String(task?.test_type || task?.name || lab.testType || "").trim(),
        schedule: nextSchedule,
        taskCode,
      });

      let status = STATUS_IDLE;
      let statusClass = "is-idle";
      if (aggregatedTaskStatus === STATUS_RUNNING || runningSchedule) {
        status = STATUS_RUNNING;
        statusClass = "is-running";
      } else if (activeSchedule || upcomingSchedule) {
        status = STATUS_SCHEDULED;
        statusClass = "is-scheduled";
      }

      return {
        name: lab.name,
        scheduleTime: nextSchedule
          ? `${formatDateTime(nextSchedule.start_at)} - ${formatDateTime(nextSchedule.end_at)}`
          : "暂无排程",
        hasTask: Boolean(taskCode),
        status,
        statusClass,
        targetExperiment: taskCode ? targetExperiment : "未分配",
        taskCode: taskCode || "-",
        testType: lab.testType,
      };
    })
    .sort((left, right) => compareText(left.name, right.name));
};

// 统一生成跳往任务总览页的查询参数，避免页面侧重复拼接路由。
const buildTaskOverviewPath = ({ taskCode, testType } = {}) => {
  const params = new URLSearchParams();
  const safeTestType = String(testType || "").trim();
  const safeTaskCode = String(taskCode || "").trim();

  if (safeTestType) {
    params.set("testType", safeTestType);
  }
  if (safeTaskCode && safeTaskCode !== "-") {
    params.set("task", safeTaskCode);
  }

  const query = params.toString();
  return query ? `/task-overview?${query}` : "/task-overview";
};

export { PROCESS_LABS, buildProcessLabCards, buildTaskOverviewPath };
