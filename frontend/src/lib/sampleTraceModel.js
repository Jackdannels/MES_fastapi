const DEFAULT_SUMMARY = "请输入试验序号查询样品全生命周期。";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const LEGACY_TEXT_REPLACEMENTS = [
  ["鏍峰搧鐧昏", "样品登记"],
  ["鏍峰搧缂栧彿閲嶆帓", "样品编号重排"],
  ["鏍峰搧缁戝畾浠诲姟", "样品绑定任务"],
  ["浠诲姟鏍峰搧閲嶇粦", "任务样品重绑"],
  ["浠诲姟鏍峰搧鍏ュ簱锛堟帴椹冲尯锛", "任务样品入库（接驳区）"],
  ["閫佽揪鏆傚瓨闂", "送达暂存间"],
  ["閫佽嚦鏆傚瓨闂", "送至暂存间"],
  ["瀹ゅ", "室外"],
  ["鎺ラ┏鍖", "接驳区"],
  ["瀹ゅ鎺ラ┏鍖", "室外接驳区"],
  ["鎭掓俯鎭掓箍闂达紙鏆傚瓨闂达級", "恒温恒湿间（暂存间）"],
  ["鏀舵牱鍙", "收样台"],
  ["鏍峰搧搴", "样品库"],
  ["宸叉帴鏀", "已接收"],
  ["宸插叆搴", "已入库"],
  ["杩愯緭涓", "运输中"],
  ["鍒拌揣", "到货"],
  ["浠诲姟 ", "任务 "],
];

const sanitizeLegacyText = (value) => {
  let text = normalizeText(value);
  if (!text) {
    return "";
  }
  LEGACY_TEXT_REPLACEMENTS.forEach(([source, target]) => {
    text = text.split(source).join(target);
  });
  return text.replace(/[�?]+$/g, "");
};

const buildSampleEvents = (sample) => {
  if (Array.isArray(sample?.history) && sample.history.length) {
    return sample.history.map((event) => ({
      ...event,
      action: sanitizeLegacyText(event?.action),
      location: sanitizeLegacyText(event?.location),
      owner: sanitizeLegacyText(event?.owner),
      status: sanitizeLegacyText(event?.status),
      detail: sanitizeLegacyText(event?.detail),
    }));
  }
  return [
    {
      time: sample?.created_at || "",
      action: "样品登记",
      location: sanitizeLegacyText(sample?.location),
      owner: sanitizeLegacyText(sample?.owner),
      status: sanitizeLegacyText(sample?.status),
      detail: "",
    },
  ];
};

const toSortableTime = (value) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
};

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
    buildSampleEvents(sample).forEach((event, index) => {
      events.push({
        ...event,
        id: normalizeText(event?.id) || `${normalizeText(sample?.code) || taskCode}-event-${index}`,
        sample_code: normalizeText(sample?.code),
      });
    });
  });

  scheduleMatches.forEach((entry, index) => {
    if (entry?.start_at) {
      events.push({
        id: normalizeText(entry?.id) ? `${entry.id}-start` : `${taskCode}-schedule-start-${index}`,
        time: entry.start_at,
        action: "排程开始",
        location: sanitizeLegacyText(entry.device),
        owner: "",
        status: sanitizeLegacyText(entry.status) || "已排程",
        detail: "",
        sample_code: "",
      });
    }
    if (entry?.end_at) {
      events.push({
        id: normalizeText(entry?.id) ? `${entry.id}-end` : `${taskCode}-schedule-end-${index}`,
        time: entry.end_at,
        action: "排程结束",
        location: sanitizeLegacyText(entry.device),
        owner: "",
        status: sanitizeLegacyText(entry.status) || "已排程",
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
      const titleParts = [normalizeText(event?.sample_code) || taskCode];
      titleParts.push(sanitizeLegacyText(event?.action) || "样品流转");

      const detailParts = [];
      if (event?.time) {
        detailParts.push(formatDateTime(event.time));
      }
      if (normalizeText(event?.location)) {
        detailParts.push(sanitizeLegacyText(event.location));
      }
      if (normalizeText(event?.owner)) {
        detailParts.push(`责任人：${sanitizeLegacyText(event.owner)}`);
      }
      if (normalizeText(event?.status)) {
        detailParts.push(sanitizeLegacyText(event.status));
      }
      if (normalizeText(event?.detail)) {
        detailParts.push(sanitizeLegacyText(event.detail));
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
