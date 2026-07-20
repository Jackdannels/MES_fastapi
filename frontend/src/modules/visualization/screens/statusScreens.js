import { computed, h } from "vue";

const LAB_STATUS_FALLBACK_NAMES = [
  "冲击一室", "冲击二室", "四综合实验室", "振动一室", "振动二室",
  "温度冲击一室", "温度冲击二室", "盐雾试验室", "霉菌试验室", "高低温湿热一室", "高低温湿热二室",
];

export const LabStatusScreen = {
  name: "LabStatusScreen",
  props: {
    labs: { type: Array, default: () => [] },
    labNames: { type: Array, default: () => [] },
    compact: { type: Boolean, default: false },
    screen: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const rows = computed(() => {
      const names = props.labNames.length ? props.labNames : LAB_STATUS_FALLBACK_NAMES;
      return names.slice(0, 11).map((name, index) => {
        const seed = Array.from(name).reduce((total, char) => total + char.charCodeAt(0), 0) + index * 37;
        const noCarrier = name === "高低温湿热二室";
        const source = props.labs.find((lab) => lab.name === name);
        const running = Boolean(source?.taskCount || source?.trayCount || index % 4 === 0);
        return {
          name,
          status: running ? "运行" : index % 5 === 0 ? "待机" : "在线",
          tone: running ? "running" : index % 5 === 0 ? "idle" : "online",
          roomTemp: (21.2 + (seed % 28) / 10).toFixed(1),
          humidity: 42 + (seed % 24),
          testTemp: (24 + (seed % 80) / 10).toFixed(1),
          testVoltage: (218 + (seed % 18) / 10).toFixed(1),
          carrierTemp: (27 + (seed % 55) / 10).toFixed(1),
          carrierVoltage: (222 + (seed % 14) / 10).toFixed(1),
          noCarrier,
        };
      });
    });
    return () => h("div", { class: ["visual-board", "visual-lab-status-board", props.compact ? "is-compact" : ""] }, [
      h("div", { class: "visual-board-header" }, [
        h("div", [h("div", { class: "visual-board-kicker" }, "LAB ENVIRONMENT / SCREEN 07"), h("div", { class: "visual-board-title" }, props.screen?.name || "试验间状态监测屏")]),
        h("div", { class: "visual-board-clock" }, [h("strong", "实时采集"), h("span", "11 个试验间 · 10 套搬运设备")]),
      ]),
      h("div", { class: "visual-lab-status-summary" }, [
        ["环境在线", "11 / 11"], ["试验设备", "11 / 11"], ["搬运设备", "10 / 10"], ["采集周期", "5 s"],
      ].map(([label, value]) => h("div", { class: "visual-lab-status-summary-item", key: label }, [h("span", label), h("strong", value)]))),
      h("div", { class: "visual-lab-status-grid" }, rows.value.map((row) => h("article", { class: ["visual-lab-status-card", `tone-${row.tone}`], key: row.name }, [
        h("div", { class: "visual-lab-status-card-head" }, [h("strong", row.name), h("span", [h("i"), row.status])]),
        h("div", { class: "visual-lab-status-metrics" }, [
          ["室温", `${row.roomTemp} °C`, "room"], ["湿度", `${row.humidity} %RH`, "humidity"],
          ["试验设备温度", `${row.testTemp} °C`, "test-temp"], ["试验设备电压", `${row.testVoltage} V`, "test-voltage"],
          ["搬运设备温度", row.noCarrier ? "—" : `${row.carrierTemp} °C`, "carrier-temp"], ["搬运设备电压", row.noCarrier ? "无搬运设备" : `${row.carrierVoltage} V`, "carrier-voltage"],
        ].map(([label, value, metric]) => h("div", { class: ["visual-lab-status-metric", metric, row.noCarrier && metric.startsWith("carrier") ? "is-unavailable" : ""], key: label }, [h("span", label), h("strong", value)]))),
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
