// 注册试验数据模块的路由、样式和模块标识。
import "./styles.css";

// 模块注册中心会读取该路由对象来生成导航和路由表。
export const route = {
  path: "/data",
  name: "data",
  component: () => import("./page.vue"),
  meta: {
    title: "试验数据",
    subtitle: "配置试验完成后的 PDF 自动归档地址，并处理生成失败记录。",
    module: "central",
  },
};

export default {
  key: "data",
  nav: true,
  route,
};
