// 将数据流记录整理为试验数据页所需的行数据、指标和报告表单默认值。
const STATUS_COMPLETE = "已完成";

// 所有文本字段统一转成去首尾空格后的字符串，避免页面直接消费 null / undefined。
const normalizeText = (value) => String(value ?? "").trim();

// 质量等数值字段在计算前转成 number，解析失败时兜底为 0。
const toNumber = (value) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

// 根据数据流状态映射列表项展示使用的状态样式类。
const resolveStatusClass = (status) => {
  const normalized = normalizeText(status);
  if (normalized === "采集中") {
    return "status running";
  }
  if (normalized === STATUS_COMPLETE) {
    return "status completed";
  }
  if (normalized.includes("缺口")) {
    return "status warn";
  }
  return "status";
};

// 将原始数据流记录转换成试验数据页使用的表格行。
function buildDataRows(streams) {
  const streamList = Array.isArray(streams) ? streams : [];
  return streamList.map((stream, index) => ({
    // 各字段在这里一次性完成缺省值补齐，避免视图层再处理容错。
    device: normalizeText(stream?.device) || "-",
    id: normalizeText(stream?.id) || `stream-${index + 1}`,
    lastPacket: normalizeText(stream?.last_packet) || "-",
    quality: normalizeText(stream?.quality) || "0",
    status: normalizeText(stream?.status) || "待校验",
    statusClass: resolveStatusClass(stream?.status),
    taskCode: normalizeText(stream?.task_code) || "-",
  }));
}

// 构建顶部汇总指标，包括流数量、质量和完成状态。
function buildDataMetrics(streams) {
  const streamList = Array.isArray(streams) ? streams : [];
  // 非“已完成”的流仍需人工校验。
  const validationCount = streamList.filter((stream) => normalizeText(stream?.status) !== STATUS_COMPLETE).length;
  // 已完成但还未生成报告的流会进入待出报告统计。
  const reportCount = streamList.filter((stream) => normalizeText(stream?.status) === STATUS_COMPLETE && !stream?.reported).length;
  return {
    reportCount,
    streamCount: streamList.length,
    validationCount,
  };
}

// 将选中的表格行标准化为详情抽屉使用的数据结构。
function buildSelectedDataRow(row = {}) {
  return {
    // 抽屉中质量字段固定带百分号展示。
    quality: normalizeText(row?.quality) ? `${normalizeText(row.quality)}%` : "0%",
    status: normalizeText(row?.status) || "采集中",
    taskCode: normalizeText(row?.taskCode) || "-",
  };
}

// 提供报告预览弹窗使用的默认表单状态。
function createReportForm() {
  return {
    rangeEnd: "",
    rangeStart: "",
    remark: "",
    rule: "完整性校验",
    taskCode: "",
    template: "重金属检测固定模板",
  };
}

// 计算汇总卡片中展示的平均质量数值。
function calculateAverageQuality(streams) {
  const streamList = Array.isArray(streams) ? streams : [];
  if (streamList.length === 0) {
    return "0%";
  }
  const average = Math.round((streamList.reduce((sum, stream) => sum + toNumber(stream?.quality), 0) / streamList.length) * 10) / 10;
  return `${average}%`;
}

export { buildDataMetrics, buildDataRows, buildSelectedDataRow, calculateAverageQuality, createReportForm };
