// 注册登录页的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/login",
  name: "login",
  component: Page,
  meta: {
    title: "登录",
    subtitle: "账号登录与分界面选择。",
    layout: "auth",
  },
};

export default {
  key: "login",
  nav: false,
  route,
};
