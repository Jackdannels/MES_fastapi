const STATUS_COMPLETE = "已完成";

const normalizeText = (value) => String(value ?? "").trim();

const toNumber = (value) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

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

function buildDataRows(streams) {
  const streamList = Array.isArray(streams) ? streams : [];
  return streamList.map((stream, index) => ({
    device: normalizeText(stream?.device) || "-",
    id: normalizeText(stream?.id) || `stream-${index + 1}`,
    lastPacket: normalizeText(stream?.last_packet) || "-",
    quality: normalizeText(stream?.quality) || "0",
    status: normalizeText(stream?.status) || "待校验",
    statusClass: resolveStatusClass(stream?.status),
    taskCode: normalizeText(stream?.task_code) || "-",
  }));
}

function buildDataMetrics(streams) {
  const streamList = Array.isArray(streams) ? streams : [];
  const validationCount = streamList.filter((stream) => normalizeText(stream?.status) !== STATUS_COMPLETE).length;
  const reportCount = streamList.filter((stream) => normalizeText(stream?.status) === STATUS_COMPLETE && !stream?.reported).length;
  return {
    reportCount,
    streamCount: streamList.length,
    validationCount,
  };
}

function buildSelectedDataRow(row = {}) {
  return {
    quality: normalizeText(row?.quality) ? `${normalizeText(row.quality)}%` : "0%",
    status: normalizeText(row?.status) || "采集中",
    taskCode: normalizeText(row?.taskCode) || "-",
  };
}

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

function calculateAverageQuality(streams) {
  const streamList = Array.isArray(streams) ? streams : [];
  if (streamList.length === 0) {
    return "0%";
  }
  const average = Math.round((streamList.reduce((sum, stream) => sum + toNumber(stream?.quality), 0) / streamList.length) * 10) / 10;
  return `${average}%`;
}

export { buildDataMetrics, buildDataRows, buildSelectedDataRow, calculateAverageQuality, createReportForm };
