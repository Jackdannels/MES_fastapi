import "./styles.css";

export const route = {
  path: "/laboratory",
  name: "laboratory",
  component: () => import("./page.vue"),
  meta: {
    title: "试验室操作台",
    subtitle: "查看当前试验室任务与实验准备流程。",
    module: "laboratory",
  },
};

export default {
  key: "laboratory",
  nav: true,
  route,
};
