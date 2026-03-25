// 注册暂存间管理模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/staging-management",
  name: "staging-management",
  component: Page,
  meta: {
    title: "暂存间系统",
    subtitle: "管理暂存间样品入库、出库与样品总览。",
    module: "staging",
  },
};

export default {
  key: "staging-management",
  nav: true,
  route,
};
