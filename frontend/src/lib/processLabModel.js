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

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
const RECENT_COMPLETION_WINDOW_MS = 24 * 60 * 60 * 1000;

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

const buildProcessLabCards = (labs, tasks, schedules, now = Date.now()) => {
  const labList = Array.isArray(labs) ? labs : [];
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

  return labList
    .map((lab) => {
      const labSchedules = scheduleList
        .filter((entry) => String(entry?.device || "").trim() === lab.name)
        .sort((left, right) => Date.parse(String(right?.start_at || "")) - Date.parse(String(left?.start_at || "")));

      if (labSchedules.length === 0) {
        return null;
      }

      const activeSchedule =
        labSchedules.find((entry) => {
          const start = Date.parse(String(entry?.start_at || ""));
          const end = Date.parse(String(entry?.end_at || ""));
          return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
        }) || null;

      const upcomingSchedule =
        labSchedules.find((entry) => {
          const start = Date.parse(String(entry?.start_at || ""));
          return Number.isFinite(start) && start > now;
        }) || null;

      const recentCompletedSchedule =
        [...labSchedules]
          .sort((left, right) => Date.parse(String(right?.end_at || "")) - Date.parse(String(left?.end_at || "")))
          .find((entry) => {
            const end = Date.parse(String(entry?.end_at || ""));
            return Number.isFinite(end) && now - end <= RECENT_COMPLETION_WINDOW_MS;
          }) || null;

      const nextSchedule = activeSchedule || upcomingSchedule || recentCompletedSchedule || null;

      if (!nextSchedule) {
        return null;
      }

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
        scheduleTime: nextSchedule
          ? `${formatDateTime(nextSchedule.start_at)} - ${formatDateTime(nextSchedule.end_at)}`
          : "暂无排期",
        status,
        statusClass,
        targetExperiment: taskCode ? targetExperiment : "未分配",
        taskCode: taskCode || "-",
        testType: lab.testType,
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareText(left.name, right.name));
};

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
