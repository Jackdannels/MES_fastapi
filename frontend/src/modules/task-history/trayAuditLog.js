const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const resolveTrayCode = (value) => normalizeText(
  value?.tray_code || value?.trayCode || value?.tray_no || value?.trayNo,
);
const resolveTaskCode = (value) => normalizeText(
  value?.task_code || value?.taskCode || value?.task_no || value?.taskNo,
);
const resolveSampleCode = (value) => normalizeText(
  value?.code || value?.sample_code || value?.sampleCode || value?.sample_no || value?.sampleNo || value?.id,
);
const resolveEventTime = (value) => normalizeText(
  value?.time || value?.event_time || value?.eventTime || value?.created_at || value?.createdAt || value?.updated_at || value?.updatedAt || value?.timestamp,
);
const parseTimeValue = (value) => {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
};
const timeKey = (value) => {
  const parsed = parseTimeValue(value);
  return parsed ? String(parsed) : normalizeText(value).replace("T", " ");
};

const SOURCE_LABELS = {
  attendance_operation: "职工操作记录",
  sample_history: "样品历史",
  staging_event: "暂存事件",
};
const GENERIC_OPERATOR_NAMES = new Set(["扫码登记", "扫码登录", "扫码操作", "扫码"]);

const normalizeSampleEventLabel = (entry, trayCode) => {
  let detail = normalizeText(entry?.detail);
  const status = normalizeText(entry?.status || entry?.action);
  if (detail.startsWith(trayCode)) {
    detail = detail.slice(trayCode.length).trim().replace(/^[-/:：·\s]+/, "");
  }
  const detailParts = detail.split(/\s*\/\s*/).filter(Boolean);
  if (detailParts.length >= 3) {
    const experimentName = detailParts.at(-2);
    const finalStatus = detailParts.at(-1);
    if (/实验已完成|实验完成|试验完成/.test(finalStatus) && /试验|实验/.test(experimentName)) {
      return `${experimentName}已完成`;
    }
    return `${experimentName} · ${finalStatus}`;
  }
  return detail || status || "状态更新";
};

const appearancePhaseText = (event) => {
  const phase = normalizeText(event?.appearance_phase || event?.appearancePhase);
  if (phase === "pre_experiment") {
    return "（实验前）";
  }
  if (phase === "post_experiment") {
    return "（实验后）";
  }
  return "";
};

const normalizeStagingEventLabel = (event) => {
  const action = normalizeText(event?.action);
  const room = normalizeText(event?.room || event?.storage_room || event?.storageRoom);
  const targetLab = normalizeText(event?.target_lab || event?.targetLab);
  const targetType = normalizeText(event?.target_type || event?.targetType);
  if (action === "manufacturer_return") {
    return "厂家收回";
  }
  if (action === "stock_in") {
    return normalizeText(event?.status || event?.location)
      || (room === "appearance" ? `外观检测间存放${appearancePhaseText(event)}` : "已到达暂存间");
  }
  if (action === "stock_out") {
    const targetsStaging = targetType === "staging" || targetLab.includes("暂存间");
    if (targetsStaging && room === "appearance") {
      return `从外观检测间再次送至暂存间${appearancePhaseText(event)}`;
    }
    if (targetsStaging) {
      return `送至暂存间${appearancePhaseText(event)}`;
    }
    const baseLabel = targetLab ? `送至${targetLab}` : "送至实验室";
    const phase = normalizeText(event?.appearance_phase || event?.appearancePhase);
    if (room === "appearance" && phase === "mid_experiment") {
      const inspectionResult = normalizeText(event?.inspection_result || event?.inspectionResult) || "未填写";
      return `${baseLabel} · 中途外观结论：${inspectionResult}`;
    }
    return baseLabel;
  }
  return normalizeText(event?.detail || event?.status) || "暂存状态更新";
};

const resolveAuditStage = (label, entry = {}) => {
  const text = [
    label,
    entry?.action,
    entry?.status,
    entry?.location,
    entry?.room,
    entry?.target_lab,
    entry?.targetLab,
  ].map(normalizeText).join(" ");
  if (/厂家收回|manufacturer_return/.test(text)) {
    return "闭环";
  }
  if (/外观/.test(text)) {
    return "外观检测";
  }
  if (/送至|运输|转运|stock_out/.test(text)) {
    return "转运";
  }
  if (/暂存|到达|入库|stock_in/.test(text)) {
    return "暂存";
  }
  if (/实验|试验/.test(text)) {
    return "实验";
  }
  return "状态";
};

const sampleContainsTray = (sample, trayCode) => asArray(sample?.trays)
  .some((tray) => resolveTrayCode(tray) === trayCode);

const historyEntryAppliesToTray = (entry, trayCode) => {
  const structuredTrayCode = resolveTrayCode(entry);
  return !structuredTrayCode || structuredTrayCode === trayCode;
};

const mergeTextList = (current, next) => Array.from(new Set([
  ...asArray(current).map(normalizeText),
  ...asArray(next).map(normalizeText),
].filter(Boolean)));

const sourceLabel = (sourceKeys) => sourceKeys
  .map((key) => SOURCE_LABELS[key] || key)
  .join(" / ");

const createSampleAuditEvents = ({ samples, taskCode, trayCode }) => {
  const eventsByKey = new Map();
  asArray(samples)
    .filter((sample) => (!taskCode || resolveTaskCode(sample) === taskCode) && sampleContainsTray(sample, trayCode))
    .forEach((sample) => {
      const sampleCode = resolveSampleCode(sample);
      asArray(sample?.history).forEach((entry) => {
        if (!historyEntryAppliesToTray(entry, trayCode)) {
          return;
        }
        const time = resolveEventTime(entry);
        if (!time) {
          return;
        }
        const label = normalizeSampleEventLabel(entry, trayCode);
        const key = `${timeKey(time)}|${label}`;
        const current = eventsByKey.get(key);
        const operator = normalizeText(entry?.owner || entry?.operator || entry?.owner_name || entry?.ownerName);
        const eventId = normalizeText(entry?.id || entry?.event_id || entry?.eventId);
        if (current) {
          current.sampleCodes = mergeTextList(current.sampleCodes, [sampleCode]);
          current.eventIds = mergeTextList(current.eventIds, [eventId]);
          current.operators = mergeTextList(current.operators, [operator]);
          return;
        }
        eventsByKey.set(key, {
          eventIds: eventId ? [eventId] : [],
          label,
          operators: operator ? [operator] : [],
          rawDetail: normalizeText(entry?.detail),
          sampleCodes: sampleCode ? [sampleCode] : [],
          sourceKeys: ["sample_history"],
          stage: resolveAuditStage(label, entry),
          time,
        });
      });
    });
  return Array.from(eventsByKey.values());
};

const mergeStagingEvents = ({ auditEvents, stagingEvents, taskCode, trayCode }) => {
  asArray(stagingEvents)
    .filter((event) => resolveTrayCode(event) === trayCode && (!taskCode || resolveTaskCode(event) === taskCode))
    .forEach((event) => {
      const time = resolveEventTime(event);
      if (!time) {
        return;
      }
      const label = normalizeStagingEventLabel(event);
      const stage = resolveAuditStage(label, event);
      const sameTimeEvents = auditEvents.filter((candidate) => timeKey(candidate.time) === timeKey(time));
      const matched = sameTimeEvents.find((candidate) => candidate.stage === stage)
        || (sameTimeEvents.length === 1 ? sameTimeEvents[0] : null);
      const operator = normalizeText(event?.operator || event?.owner || event?.owner_name || event?.ownerName);
      const eventId = normalizeText(event?.id || event?.event_id || event?.eventId);
      if (matched) {
        matched.eventIds = mergeTextList(matched.eventIds, [eventId]);
        matched.operators = mergeTextList(matched.operators, [operator]);
        matched.sourceKeys = mergeTextList(["staging_event"], matched.sourceKeys);
        return;
      }
      auditEvents.push({
        eventIds: eventId ? [eventId] : [],
        label,
        operators: operator ? [operator] : [],
        rawDetail: normalizeText(event?.detail),
        sampleCodes: [],
        sourceKeys: ["staging_event"],
        stage,
        time,
      });
    });
};

const operationEmployeeLabel = (operation) => {
  const employeeName = normalizeText(operation?.employeeName || operation?.employee_name);
  const username = normalizeText(operation?.username);
  if (employeeName && username && employeeName !== username) {
    return `${employeeName}（${username}）`;
  }
  return employeeName || username;
};

const attendanceOperationAppliesToTray = ({ experimentTrays, operation, taskCode, trayCode }) => {
  if (resolveTaskCode(operation) !== taskCode) {
    return false;
  }
  const operationTrayCode = resolveTrayCode(operation);
  if (operationTrayCode) {
    return operationTrayCode === trayCode;
  }
  const experimentCode = normalizeText(operation?.experimentCode || operation?.experiment_code);
  if (!experimentCode) {
    return true;
  }
  return asArray(experimentTrays).some((relation) => (
    resolveTaskCode(relation) === taskCode
    && resolveTrayCode(relation) === trayCode
    && normalizeText(relation?.experiment_code || relation?.experimentCode) === experimentCode
  ));
};

const enrichOperatorsFromAttendance = ({ attendanceOperations, auditEvents, experimentTrays, taskCode, trayCode }) => {
  asArray(attendanceOperations)
    .filter((operation) => attendanceOperationAppliesToTray({ experimentTrays, operation, taskCode, trayCode }))
    .forEach((operation) => {
      const operationTime = resolveEventTime(operation)
        || normalizeText(operation?.operatedAt || operation?.operated_at);
      const employee = operationEmployeeLabel(operation);
      if (!operationTime || !employee) {
        return;
      }
      const sameTimeEvents = auditEvents.filter((event) => timeKey(event.time) === timeKey(operationTime));
      const operationStage = resolveAuditStage(normalizeText(operation?.action), operation);
      const matched = sameTimeEvents.find((event) => event.stage === operationStage)
        || (sameTimeEvents.length === 1 ? sameTimeEvents[0] : null);
      if (!matched) {
        return;
      }
      matched.operators = [
        employee,
        ...matched.operators.filter((operator) => !GENERIC_OPERATOR_NAMES.has(normalizeText(operator))),
      ].filter((operator, index, values) => values.indexOf(operator) === index);
      matched.eventIds = mergeTextList(matched.eventIds, [normalizeText(operation?.id)]);
      matched.sourceKeys = mergeTextList(["attendance_operation"], matched.sourceKeys);
    });
};

const formatAuditDuration = (milliseconds) => {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds].map((value) => String(value).padStart(2, "0"));
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${parts.join(":")}`
    : parts.join(":");
};

function buildTrayAuditLog(input = {}) {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  if (!trayCode) {
    return { durationMs: 0, durationText: "00:00", events: [], missingOperatorCount: 0 };
  }
  const auditEvents = createSampleAuditEvents({ samples: input.samples, taskCode, trayCode });
  mergeStagingEvents({ auditEvents, stagingEvents: input.stagingEvents, taskCode, trayCode });
  enrichOperatorsFromAttendance({
    attendanceOperations: input.attendanceOperations,
    auditEvents,
    experimentTrays: input.experimentTrays,
    taskCode,
    trayCode,
  });
  auditEvents.sort((left, right) => parseTimeValue(left.time) - parseTimeValue(right.time)
    || left.label.localeCompare(right.label, "zh-Hans-CN"));
  const events = auditEvents.map((event, index) => {
    const eventTime = parseTimeValue(event.time);
    const previousTime = index > 0 ? parseTimeValue(auditEvents[index - 1].time) : 0;
    return {
      ...event,
      elapsedMs: previousTime && eventTime ? Math.max(0, eventTime - previousTime) : 0,
      elapsedText: previousTime && eventTime ? formatAuditDuration(eventTime - previousTime) : "",
      eventId: event.eventIds.join(" / "),
      operator: event.operators.join(" / "),
      source: sourceLabel(event.sourceKeys),
    };
  });
  const firstTime = parseTimeValue(events[0]?.time);
  const lastTime = parseTimeValue(events.at(-1)?.time);
  const durationMs = firstTime && lastTime ? Math.max(0, lastTime - firstTime) : 0;
  return {
    durationMs,
    durationText: formatAuditDuration(durationMs),
    events,
    missingOperatorCount: events.filter((event) => !event.operator).length,
  };
}

const escapeCsvCell = (value) => `"${normalizeText(value).replaceAll('"', '""')}"`;

const EXPORT_TIME_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
const EXPLICIT_TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

const formatAuditExportTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  let parts;
  if (EXPLICIT_TIMEZONE_PATTERN.test(normalized)) {
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      const formatter = new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        month: "numeric",
        second: "2-digit",
        timeZone: "Asia/Shanghai",
        year: "numeric",
      });
      const valueByType = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      parts = [valueByType.year, valueByType.month, valueByType.day, valueByType.hour, valueByType.minute, valueByType.second];
    }
  }
  if (!parts) {
    parts = normalized.match(EXPORT_TIME_PATTERN)?.slice(1);
  }
  if (!parts) {
    return normalized;
  }
  const [year, month, day, hour, minute, second = "00"] = parts;
  return `${Number(year)}年${Number(month)}月${Number(day)}日 ${String(hour).padStart(2, "0")}时${String(minute).padStart(2, "0")}分${String(second).padStart(2, "0")}秒`;
};

function buildTrayAuditCsv({ events = [], taskCode = "", trayCode = "" } = {}) {
  const header = ["任务号", "托盘号", "序号", "事件时间", "事件", "阶段", "数据来源", "操作人", "事件ID", "包含样品", "距上次事件"];
  const rows = asArray(events).map((event, index) => [
    taskCode,
    trayCode,
    index + 1,
    formatAuditExportTime(event.time),
    event.label,
    event.stage,
    event.source,
    event.operator,
    event.eventId,
    asArray(event.sampleCodes).join(" / "),
    event.elapsedText,
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`;
}

function buildTrayAuditJson({ events = [], generatedAt = new Date().toISOString(), taskCode = "", trayCode = "" } = {}) {
  return JSON.stringify({
    schemaVersion: "1.0",
    taskCode,
    trayCode,
    generatedAt,
    eventCount: asArray(events).length,
    events: asArray(events).map((event) => ({
      ...event,
      displayTime: formatAuditExportTime(event.time),
    })),
  }, null, 2);
}

const escapeXml = (value) => normalizeText(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

function buildTrayAuditSvg({ events = [], taskCode = "", trayCode = "" } = {}) {
  const safeEvents = asArray(events);
  const canvasWidth = 1200;
  const height = Math.max(300, 170 + safeEvents.length * 68);
  const rows = safeEvents.map((event, index) => {
    const y = 142 + index * 68;
    const dotColor = index === safeEvents.length - 1 ? "#22c55e" : "#38bdf8";
    return `<text x="58" y="${y}" fill="#94a3b8" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="14">${escapeXml(formatAuditExportTime(event.time))}</text>`
      + `<circle cx="350" cy="${y - 5}" r="7" fill="${dotColor}"/>`
      + `<text x="378" y="${y}" fill="#f8fafc" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="17" font-weight="600">${escapeXml(event.label)}</text>`
      + `<text x="378" y="${y + 23}" fill="#94a3b8" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="11">${escapeXml([event.stage, event.source, event.operator || "操作人未记录"].join(" / "))}</text>`;
  }).join("");
  const lineEnd = safeEvents.length ? 137 + (safeEvents.length - 1) * 68 : 142;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}" viewBox="0 0 ${canvasWidth} ${height}" preserveAspectRatio="xMidYMin meet" role="img" aria-labelledby="tray-audit-title" style="display:block;min-height:100vh;background:#0f172a">`
    + `<title id="tray-audit-title">${escapeXml(`${trayCode} 托盘审计事件时间轴`)}</title>`
    + `<rect width="${canvasWidth}" height="${height}" fill="#0f172a"/>`
    + `<text x="58" y="50" fill="#38bdf8" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="14" font-weight="700">托盘审计事件时间轴</text>`
    + `<text x="58" y="88" fill="#f8fafc" font-family="Consolas,monospace" font-size="23" font-weight="700">${escapeXml(trayCode)}</text>`
    + `<text x="58" y="112" fill="#94a3b8" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="12">任务 ${escapeXml(taskCode)} / ${safeEvents.length} 个关键事件</text>`
    + `<line x1="350" y1="132" x2="350" y2="${lineEnd}" stroke="#334155" stroke-width="2"/>`
    + rows
    + "</svg>";
}

export {
  buildTrayAuditCsv,
  buildTrayAuditJson,
  buildTrayAuditLog,
  buildTrayAuditSvg,
  formatAuditExportTime,
  formatAuditDuration,
};
