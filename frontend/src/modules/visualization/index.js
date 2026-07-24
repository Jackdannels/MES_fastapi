// 注册可视化管理模块的路由、样式和模块标识。
import "./styles.css";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/visualization",
  name: "visualization",
  component: () => import("./page.vue"),
  meta: {
    title: "可视化管理",
    subtitle: "集中管理可视化看板、展示内容与发布入口。",
    module: "visual",
  },
};

export default {
  key: "visualization",
  nav: true,
  route,
};
