import Page from "./page.vue";

export const route = {
  path: "/sample-pre-allocation",
  name: "sample-pre-allocation",
  component: Page,
  meta: {
    title: "样品预接驳",
    subtitle: "提前完成样品与托盘预分配，为后续接驳和实验流转做准备。",
    module: "central",
  },
};

export default {
  key: "sample-pre-allocation",
  nav: true,
  route,
};
