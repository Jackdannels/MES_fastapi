// 注册系统信息模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/system",
  name: "system",
  component: Page,
  meta: {
    title: "系统信息",
    subtitle: "维护角色权限、通知方式、班次与基础运行配置。",
    module: "central",
  },
};

export default {
  key: "system",
  nav: true,
  route,
};
