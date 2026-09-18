import { h } from "vue";
export { LabTelemetryScreen as LabStatusScreen } from "./labTelemetryScreen";

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
