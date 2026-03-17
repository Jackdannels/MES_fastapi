// 注册排程看板模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/schedule",
  name: "schedule",
  component: Page,
  meta: {
    title: "排程看板",
    subtitle: "按设备与时间窗口编排任务，处理冲突、拆样与留样安排。",
    module: "central",
  },
};

export default {
  key: "schedule",
  nav: true,
  route,
};
