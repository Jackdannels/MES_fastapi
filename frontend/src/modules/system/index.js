// 注册人员信息模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/system",
  name: "system",
  component: Page,
  meta: {
    title: "人员信息",
    subtitle: "维护人员账号、角色信息与试验间工作时间。",
    module: "central",
  },
};

export default {
  key: "system",
  nav: true,
  route,
};
