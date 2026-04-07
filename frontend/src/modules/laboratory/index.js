import "./styles.css";
import Page from "./page.vue";

export const route = {
  path: "/laboratory",
  name: "laboratory",
  component: Page,
  meta: {
    title: "盐雾试验室操作台",
    subtitle: "查看盐雾试验室当前任务与实验准备流程。",
    module: "laboratory",
  },
};

export default {
  key: "laboratory",
  nav: true,
  route,
};
