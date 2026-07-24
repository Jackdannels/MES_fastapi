import "./styles.css";

export const route = {
  path: "/handover-system",
  name: "handover-system",
  component: () => import("./page.vue"),
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
