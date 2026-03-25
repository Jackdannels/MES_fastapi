import "./styles.css";
import Page from "./page.vue";

export const route = {
  path: "/handover-system",
  name: "handover-system",
  component: Page,
  meta: {
    title: "接驳区系统",
    subtitle: "处理接驳区到样确认、托盘分装与交接。",
    module: "handover",
  },
};

export default {
  key: "handover-system",
  nav: true,
  route,
};
