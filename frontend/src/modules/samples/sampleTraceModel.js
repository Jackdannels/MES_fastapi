// 根据样品历史和相关排程记录构建任务级追溯时间线。
const DEFAULT_SUMMARY = "请输入试验序号查询样品全生命周期。";
const STATUS_RETENTION = "暂存间存放";
const LEGACY_STATUS_RETENTION = "暂存间排放";

// 追溯链路会同时消费样品历史与排程记录，因此先统一做基础清洗。
const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const normalizeStatus = (value) => {
  const normalized = normalizeText(value);
  if (normalized === LEGACY_STATUS_RETENTION || normalized === STATUS_RETENTION) {
    return STATUS_RETENTION;
  }
  return normalized;
};

// 优先使用样品自身已存的 history；缺失时再退回到基础登记事件。
const buildSampleEvents = (sample) => {
  if (Array.isArray(sample?.history) && sample.history.length) {
    return sample.history.map((event) => ({
      ...event,
      action: normalizeText(event?.action),
      location: normalizeText(event?.location),
      owner: normalizeText(event?.owner),
      status: normalizeStatus(event?.status),
      detail: normalizeText(event?.detail),
    }));
  }
  return [
    {
      time: sample?.created_at || "",
      action: "样品登记",
      location: normalizeText(sample?.location),
      owner: normalizeText(sample?.owner),
      status: normalizeStatus(sample?.status),
      detail: "",
    },
  ];
};

const toSortableTime = (value) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
};

// 时间线元数据统一格式化成 yyyy-MM-dd HH:mm。
const formatDateTime = (value) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

// 生成追溯页展示的摘要文本和时间线数据。
function buildSampleTraceView(input = {}) {
  const taskCode = normalizeText(input.taskCode);
  if (!taskCode) {
    return {
      summaryText: DEFAULT_SUMMARY,
      timelineItems: [],
    };
  }

  const samples = asArray(input.samples);
  const schedules = asArray(input.schedules);
  const matches = samples.filter((sample) => normalizeText(sample?.task_code) === taskCode);
  const scheduleMatches = schedules.filter((entry) => normalizeText(entry?.task_code) === taskCode);

  const events = [];
  matches.forEach((sample) => {
    // 每个样品的历史事件都会保留样品号，便于时间线区分来源。
    buildSampleEvents(sample).forEach((event, index) => {
      events.push({
        ...event,
        id: normalizeText(event?.id) || `${normalizeText(sample?.code) || taskCode}-event-${index}`,
        sample_code: normalizeText(sample?.code),
      });
    });
  });

  scheduleMatches.forEach((entry, index) => {
    // 排程记录会被拆成“开始/结束”两个节点，插入同一条时间线。
    if (entry?.start_at) {
      events.push({
        id: normalizeText(entry?.id) ? `${entry.id}-start` : `${taskCode}-schedule-start-${index}`,
        time: entry.start_at,
        action: "排程开始",
        location: normalizeText(entry.device),
        owner: "",
        status: normalizeStatus(entry.status) || "已排程",
        detail: "",
        sample_code: "",
      });
    }
    if (entry?.end_at) {
      events.push({
        id: normalizeText(entry?.id) ? `${entry.id}-end` : `${taskCode}-schedule-end-${index}`,
        time: entry.end_at,
        action: "排程结束",
        location: normalizeText(entry.device),
        owner: "",
        status: normalizeStatus(entry.status) || "已排程",
        detail: "",
        sample_code: "",
      });
    }
  });

  if (events.length === 0) {
    return {
      summaryText: `未找到试验序号 ${taskCode} 的样品记录。`,
      timelineItems: [],
    };
  }

  const timelineItems = events
    .slice()
    .sort((left, right) => toSortableTime(left?.time) - toSortableTime(right?.time))
    .map((event, index) => {
      // 时间线标题展示“样品号/任务号 + 动作”，meta 展示详细上下文。
      const titleParts = [normalizeText(event?.sample_code) || taskCode];
      titleParts.push(normalizeText(event?.action) || "样品流转");

      const detailParts = [];
      if (event?.time) {
        detailParts.push(formatDateTime(event.time));
      }
      if (normalizeText(event?.location)) {
        detailParts.push(normalizeText(event.location));
      }
      if (normalizeText(event?.owner)) {
        detailParts.push(`责任人：${normalizeText(event.owner)}`);
      }
      if (normalizeText(event?.status)) {
        detailParts.push(normalizeText(event.status));
      }
      if (normalizeText(event?.detail)) {
        detailParts.push(normalizeText(event.detail));
      }

      return {
        id: normalizeText(event?.id) || `${taskCode}-trace-${index}`,
        title: titleParts.join(" · "),
        meta: detailParts.join(" | "),
      };
    });

  return {
    summaryText: `试验序号 ${taskCode}：样品 ${matches.length} 个，流转记录 ${events.length} 条。`,
    timelineItems,
  };
}

export { buildSampleTraceView, DEFAULT_SUMMARY };
