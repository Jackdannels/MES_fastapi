// 注册任务总览模块的路由、样式和模块标识。
import "./styles.css";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/task-overview",
  name: "task-overview",
  component: () => import("./page.vue"),
  meta: {
    title: "任务/托盘总览",
    subtitle: "从任务和托盘两个视角跟踪样品分配、进度变化与异常情况。",
    module: "central",
  },
};

export default {
  key: "task-overview",
  nav: true,
  route,
};
