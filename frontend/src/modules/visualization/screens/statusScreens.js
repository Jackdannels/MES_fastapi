import { computed, h } from "vue";
import { LAB_CODE_BY_NAME } from "@/lib/labs";

const LAB_STATUS_FALLBACK_NAMES = [
  "冲击一室", "冲击二室", "四综合实验室", "振动一室", "振动二室",
  "温度冲击一室", "温度冲击二室", "盐雾试验室", "霉菌试验室", "高低温湿热一室", "高低温湿热二室",
];

export const LabStatusScreen = {
  name: "LabStatusScreen",
  props: {
    labs: { type: Array, default: () => [] },
    labNames: { type: Array, default: () => [] },
    telemetry: { type: Array, default: () => [] },
    compact: { type: Boolean, default: false },
    screen: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const rows = computed(() => {
      const names = props.labNames.length ? props.labNames : LAB_STATUS_FALLBACK_NAMES;
      return names.slice(0, 11).map((name) => {
        const labCode = LAB_CODE_BY_NAME[name] || "";
        const noCarrier = name === "高低温湿热二室";
        const source = props.telemetry.find((item) => item?.lab_code === labCode);
        const status = source?.connection_status || "missing";
        const environment = source?.environment || {};
        const testDevice = source?.test_device || {};
        const carrierDevice = source?.carrier_device || {};
        const alarms = Array.isArray(source?.alarms) ? source.alarms : [];
        const hasAlarm = alarms.length > 0 && !["offline", "missing"].includes(status);
        const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
        const formatNumber = (value, unit) => hasNumber(value) ? `${Number(value).toFixed(1)} ${unit}` : "—";
        return {
          name,
          status: hasAlarm ? "严重告警" : status === "online" ? "在线" : status === "delayed" ? "数据延迟" : status === "offline" ? "上位机离线" : "未采集",
          tone: hasAlarm ? "alarm" : status,
          alarmText: alarms.map((alarm) => alarm?.message).filter(Boolean).join("；"),
          roomTemp: formatNumber(environment.temperature_c, "°C"),
          humidity: formatNumber(environment.humidity_rh, "%RH"),
          testTemp: formatNumber(testDevice.temperature_c, "°C"),
          testVoltage: formatNumber(testDevice.voltage_v, "V"),
          carrierTemp: formatNumber(carrierDevice.temperature_c, "°C"),
          carrierVoltage: formatNumber(carrierDevice.voltage_v, "V"),
          testTempAlarm: hasNumber(testDevice.temperature_c) && Number(testDevice.temperature_c) > 60,
          testVoltageAlarm: hasNumber(testDevice.voltage_v) && Number(testDevice.voltage_v) < 100,
          carrierTempAlarm: carrierDevice.configured && hasNumber(carrierDevice.temperature_c) && Number(carrierDevice.temperature_c) > 60,
          carrierVoltageAlarm: carrierDevice.configured && hasNumber(carrierDevice.voltage_v) && Number(carrierDevice.voltage_v) < 100,
          noCarrier,
        };
      });
    });
    const summary = computed(() => {
      const onlineRows = rows.value.filter((row) => row.tone === "online");
      const alarmRows = rows.value.filter((row) => row.tone === "alarm");
      return [
        ["严重告警", String(alarmRows.length)],
        ["遥测正常", `${onlineRows.length} / 11`],
        ["数据延迟", String(rows.value.filter((row) => row.tone === "delayed").length)],
        ["采集周期", "3 s"],
      ];
    });
    return () => h("div", { class: ["visual-board", "visual-lab-status-board", props.compact ? "is-compact" : ""] }, [
      h("div", { class: "visual-board-header" }, [
        h("div", [h("div", { class: "visual-board-kicker" }, "LAB ENVIRONMENT / SCREEN 07"), h("div", { class: "visual-board-title" }, props.screen?.name || "试验间状态监测屏")]),
        h("div", { class: "visual-board-clock" }, [
          h("strong", rows.value.some((row) => row.tone === "alarm") ? "发现设备异常" : "实时采集"),
          h("span", "3 秒更新 · 11 个试验间 · 10 套搬运设备"),
        ]),
      ]),
      h("div", { class: "visual-lab-status-summary" }, summary.value.map(([label, value]) => h("div", { class: "visual-lab-status-summary-item", key: label }, [h("span", label), h("strong", value)]))),
      h("div", { class: "visual-lab-status-grid" }, rows.value.map((row) => h("article", { class: ["visual-lab-status-card", `tone-${row.tone}`], key: row.name }, [
        h("div", { class: "visual-lab-status-card-head" }, [h("strong", row.name), h("span", [h("i"), row.status])]),
        row.alarmText ? h("div", { class: "visual-lab-status-alarm", role: "alert" }, [h("b", "异常警报"), h("span", row.alarmText)]) : null,
        h("div", { class: "visual-lab-status-metrics" }, [
          ["室温", row.roomTemp, "room", false], ["湿度", row.humidity, "humidity", false],
          ["试验设备温度", row.testTemp, "test-temp", row.testTempAlarm], ["试验设备电压", row.testVoltage, "test-voltage", row.testVoltageAlarm],
          ["搬运设备温度", row.noCarrier ? "—" : row.carrierTemp, "carrier-temp", row.carrierTempAlarm], ["搬运设备电压", row.noCarrier ? "无搬运设备" : row.carrierVoltage, "carrier-voltage", row.carrierVoltageAlarm],
        ].map(([label, value, metric, alarm]) => h("div", { class: ["visual-lab-status-metric", metric, alarm ? "is-alarm" : "", row.noCarrier && metric.startsWith("carrier") ? "is-unavailable" : ""], key: label }, [h("span", label), h("strong", value), alarm ? h("em", "超出安全范围") : null]))),
      ]))),
    ]);
  },
};

export const PlaceholderScreen = {
  name: "PlaceholderScreen",
  props: {
    screen: { type: Object, required: true },
    labs: { type: Array, required: false, default: () => [] },
    compact: { type: Boolean, default: false },
  },
  setup(props) {
    return () => h("div", { class: ["visual-board", "visual-placeholder-board", `accent-${props.screen.accent || "cyan"}`, props.compact ? "is-compact" : ""] }, [
      h("div", { class: "visual-board-top" }, [
        h("div", { class: "visual-board-title-group" }, [h("div", { class: "visual-board-kicker" }, "SCREEN"), h("div", { class: "visual-board-title" }, props.screen.name)]),
        h("div", { class: ["visual-board-live", `tone-${props.screen.tone || "live"}`] }, props.screen.status),
      ]),
      h("div", { class: "visual-placeholder-content" }, [
        h("div", { class: "visual-placeholder-left" }, [
          h("div", { class: "visual-placeholder-chart" }, [h("span"), h("span"), h("span"), h("span"), h("span"), h("span"), h("i")]),
          h("div", { class: "visual-placeholder-kpis" }, (props.screen.indicators || []).map(([label, value]) => h("div", { class: "visual-placeholder-kpi", key: label }, [h("span", label), h("strong", value)]))),
        ]),
        h("div", { class: "visual-placeholder-copy" }, [
          h("span", "核心指标"), h("strong", props.screen.metric), h("span", props.screen.status),
          h("div", { class: "visual-placeholder-pulse" }, [h("b"), h("b"), h("b"), h("b")]),
        ]),
      ]),
    ]);
  },
};
