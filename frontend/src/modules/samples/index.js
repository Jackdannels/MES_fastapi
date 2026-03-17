// 注册样品管理模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/samples",
  name: "samples",
  component: Page,
  meta: {
    title: "样品管理",
    subtitle: "管理样品登记、到样确认、流转记录、留样与样品追溯。",
    module: "central",
  },
};

export default {
  key: "samples",
  nav: true,
  route,
};
