// 注册设备资源模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/devices",
  name: "devices",
  component: Page,
  meta: {
    title: "设备资源",
    subtitle: "管理设备台账与维保记录。",
    module: "central",
  },
};

export default {
  key: "devices",
  nav: true,
  route,
};
