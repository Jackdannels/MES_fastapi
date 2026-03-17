// 注册试验数据模块的路由、样式和模块标识。
import "./styles.css";
import Page from "./page.vue";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/data",
  name: "data",
  component: Page,
  meta: {
    title: "试验数据",
    subtitle: "监控采集链路，执行数据校验，并生成固定模板报告。",
    module: "central",
  },
};

export default {
  key: "data",
  nav: true,
  route,
};
