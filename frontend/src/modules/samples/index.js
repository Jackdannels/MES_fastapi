// 注册样品管理模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/samples",
  name: "samples",
  component: Page,
  meta: {
    title: "样品/托盘管理",
    subtitle: "管理样品预分装、托盘状态、流转记录与暂存间派发。",
    module: "central",
  },
};

export default {
  key: "samples",
  nav: true,
  route,
};
