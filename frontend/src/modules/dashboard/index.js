// 注册中控总览模块的路由、样式和模块标识。
import "./styles.css";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/",
  name: "dashboard",
  component: () => import("./page.vue"),
  meta: {
    title: "中控总览",
    subtitle: "集中查看任务、设备、预警与数据状态的全局运行概况。",
    module: "central",
  },
};

export default {
  key: "dashboard",
  nav: true,
  route,
};
