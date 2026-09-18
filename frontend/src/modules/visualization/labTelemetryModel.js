import { LAB_CODE_BY_NAME } from "@/lib/labs";
import { formatBusinessDateTime } from "@/lib/dateTime";

const numberText = (value, unit) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} ${unit}` : "—";
const stateText = { online: "在线", offline: "失联", delayed: "数据延迟", recovering: "恢复确认中", unknown: "状态未知", missing: "未采集" };

export function buildTelemetryRow(name, source, monitorStatus = "online") {
  const labCode = LAB_CODE_BY_NAME[name];
  const host = monitorStatus !== "online" ? "unknown" : source?.connection_status || "missing";
  const allUnknown = ["unknown", "offline", "missing"].includes(host);
  const alarms = host === "online" && Array.isArray(source?.alarms) ? source.alarms : [];
  const groupState = (key) => {
    const group = source?.[key];
    if (key === "carrier_device" && (labCode === "LAB_HOT_HUMID_2" || group?.configured === false)) return "not_configured";
    if (allUnknown) return "unknown";
    if (host !== "online") return host;
    if (group?.connection_status) return group.connection_status;
    if (key === "environment") return group ? "online" : "unknown";
    return group?.online === false ? "offline" : group ? "online" : "unknown";
  };
  const definitions = [
    ["室温", "environment", "temperature_c", "°C", "room"],
    ["湿度", "environment", "humidity_rh", "%RH", "humidity"],
    ["试验设备温度", "test_device", "temperature_c", "°C", "test-temp"],
    ["试验设备电压", "test_device", "voltage_v", "V", "test-voltage"],
    ["搬运设备温度", "carrier_device", "temperature_c", "°C", "carrier-temp"],
    ["搬运设备电压", "carrier_device", "voltage_v", "V", "carrier-voltage"],
  ];
  const metrics = definitions.map(([label, key, field, unit, metric]) => {
    const state = groupState(key);
    const group = source?.[key] || {};
    const last = numberText(group.last_values ? group.last_values[field] : group[field], unit);
    const unavailable = state === "not_configured";
    const live = state === "online";
    return { label, metric, state, unavailable,
      value: unavailable ? (field === "voltage_v" ? "无搬运设备" : "—") : live ? numberText(group[field], unit) : state === "delayed" ? last : "—",
      hint: unavailable || live ? "" : `${state === "delayed" ? "旧值" : stateText[state] || "未知"} · 最后值 ${last}`,
      alarm: live && alarms.some((alarm) => alarm.metric ? alarm.metric === `${key}.${field}` : (field === "temperature_c" ? Number(group[field]) > 60 : field === "voltage_v" && group[field] != null && Number(group[field]) < 100)),
    };
  });
  const issues = [["environment", "环境采集"], ["test_device", "试验设备"], ["carrier_device", "搬运设备"]]
    .filter(([key]) => !["online", "not_configured"].includes(groupState(key)))
    .map(([key, label]) => `${label}${stateText[groupState(key)] || "状态未知"}${source?.[key]?.lost_seconds != null ? ` ${source[key].lost_seconds} 秒` : ""}`);
  let status = "在线", tone = "online", notice = "";
  if (host === "unknown") { status = "状态未知"; tone = "unknown"; notice = "监控链路中断 · 等待恢复"; }
  else if (host === "missing") { status = "未采集"; tone = "unknown"; notice = "等待首次有效数据"; }
  else if (host === "offline") { status = "上位机失联"; tone = "offline"; notice = `上位机失联 ${source?.age_seconds ?? "—"} 秒 · 下游状态未知`; }
  else if (host === "delayed") { status = "数据延迟"; tone = "delayed"; notice = `已 ${source?.age_seconds ?? "—"} 秒未收到新数据`; }
  else if (host === "recovering") { status = "恢复确认中"; tone = "delayed"; notice = "收到新数据 · 等待连续两次有效采集"; }
  else if (alarms.length) { status = "严重告警"; tone = "alarm"; notice = [...alarms.map((a) => a.message), ...issues].join("；"); }
  else if (issues.length) { status = issues[0].replace(/ \d+ 秒$/, ""); tone = "delayed"; notice = issues.join("；"); }
  const previousAlarm = Array.isArray(source?.last_alarms) && source.last_alarms.length ? "；断线前告警待确认" : "";
  notice += previousAlarm;
  return { name, status, tone, notice, metrics,
    hostOffline: host === "offline", deviceOffline: host === "online" ? ["test_device", "carrier_device"].filter((key) => groupState(key) === "offline").length : 0,
    delayed: host === "delayed" || host === "recovering", alarm: alarms.length > 0,
    footer: `${allUnknown ? "最后有效数据" : "最近采集"} ${formatBusinessDateTime(source?.observed_at, { includeSeconds: true }) || "—"}（北京时间）`,
  };
}
