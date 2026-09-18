import { computed, h } from "vue";
import "../telemetryScreen.css";
import { buildTelemetryRow } from "../labTelemetryModel";

const DEFAULT_NAMES = ["冲击一室", "冲击二室", "四综合实验室", "振动一室", "振动二室", "温度冲击一室", "温度冲击二室", "盐雾试验室", "霉菌试验室", "高低温湿热一室", "高低温湿热二室"];
import { LAB_CODE_BY_NAME } from "@/lib/labs";

export const LabTelemetryScreen = {
  name: "LabStatusScreen",
  props: {
    labNames: { type: Array, default: () => [] },
    telemetry: { type: Array, default: () => [] },
    monitorStatus: { type: String, default: "online" },
    monitorMessage: { type: String, default: "" },
    compact: { type: Boolean, default: false },
    screen: { type: Object, default: () => ({}) },
  },
  setup(props) {
    const rows = computed(() => (props.labNames.length ? props.labNames : DEFAULT_NAMES).slice(0, 11).map((name) => buildTelemetryRow(name, props.telemetry.find((s) => s.lab_code === LAB_CODE_BY_NAME[name]), props.monitorStatus)));
    const summary = computed(() => [
      ["上位机失联", props.monitorStatus !== "online" ? "—" : rows.value.filter((r) => r.hostOffline).length],
      ["设备失联", props.monitorStatus !== "online" ? "—" : rows.value.reduce((n, r) => n + r.deviceOffline, 0)],
      ["数据延迟", rows.value.filter((r) => r.delayed).length],
      ["数值超限", rows.value.filter((r) => r.alarm).length],
    ]);
    return () => h("div", { class: ["visual-board", "visual-lab-status-board", props.compact ? "is-compact" : "", props.monitorStatus !== "online" ? "is-monitor-offline" : ""] }, [
      h("div", { class: "visual-board-header" }, [
        h("div", [h("div", { class: "visual-board-kicker" }, "LAB ENVIRONMENT / SCREEN 07"), h("div", { class: "visual-board-title" }, props.screen.name || "试验间状态监测屏")]),
        h("div", { class: "visual-board-clock" }, [
          h("strong", { title: props.monitorMessage }, props.monitorStatus !== "online" ? "监控链路中断，设备状态暂不可确认" : rows.value.some((r) => r.tone !== "online") ? "请关注通信与设备状态" : "实时采集"),
          h("span", "1 秒更新 · 11 个试验间 · 10 套搬运设备"),
        ]),
      ]),
      h("div", { class: "visual-lab-status-summary" }, summary.value.map(([label, value]) => h("div", { class: "visual-lab-status-summary-item", key: label }, [h("span", label), h("strong", String(value))]))),
      h("div", { class: "visual-lab-status-grid" }, rows.value.map((row) => h("article", { class: ["visual-lab-status-card", `tone-${row.tone}`], key: row.name }, [
        h("div", { class: "visual-lab-status-card-head" }, [h("strong", row.name), h("span", { title: row.status }, [h("i"), row.status])]),
        h("div", { class: ["visual-lab-status-alarm", row.notice ? "" : "is-empty"], role: row.notice ? "alert" : undefined, "aria-hidden": row.notice ? undefined : "true", title: row.notice }, [h("b", row.alarm ? "异常警报" : "通信提示"), h("span", row.notice || "当前参数正常")]),
        h("div", { class: "visual-lab-status-metrics" }, ["环境", "试验设备", "搬运设备"].map((group, index) => h("section", { class: "visual-telemetry-group", key: group, "aria-label": group }, [
          h("div", { class: "visual-telemetry-group-name" }, [h("span", String(index + 1).padStart(2, "0")), h("b", group)]),
          ...row.metrics.slice(index * 2, index * 2 + 2).map((m, metricIndex) => {
            const match = m.value.match(/^(-?\d+(?:\.\d+)?) (.+)$/);
            return h("div", { class: ["visual-lab-status-metric", m.metric, m.alarm ? "is-alarm" : "", m.unavailable ? "is-unavailable" : "", !["online", "not_configured"].includes(m.state) ? "is-stale" : ""], key: m.metric, "aria-label": m.label }, [
              h("span", index === 0 ? m.label : metricIndex === 0 ? "温度" : "电压"),
              h("strong", match ? [match[1], " ", h("em", match[2])] : m.value),
              h("small", { class: "visual-telemetry-last-value", title: m.hint }, m.hint || "\u00a0"),
            ]);
          }),
        ]))),
        h("div", { class: "visual-telemetry-footer", title: row.footer }, row.footer),
      ]))),
    ]);
  },
};
