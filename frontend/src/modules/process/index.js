// 注册过程管控模块的路由、样式和模块标识。
import "./styles.css";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/process",
  name: "process",
  component: () => import("./page.vue"),
  meta: {
    title: "试验过程管控",
    subtitle: "按实验室查看当前运行、已排程与空闲状态，并快速进入任务处理。",
    module: "central",
  },
};

export default {
  key: "process",
  nav: true,
  route,
};
