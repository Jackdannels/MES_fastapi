// 注册任务受理模块的路由、样式和模块标识。
import "./styles.css";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/tasks",
  name: "tasks",
  component: () => import("./page.vue"),
  meta: {
    title: "任务受理",
    subtitle: "统一受理外部委托与内部新增任务，并维护任务基础信息。",
    module: "central",
  },
};

export default {
  key: "tasks",
  nav: true,
  route,
};
