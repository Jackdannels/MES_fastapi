export const route = {
  path: "/task-history",
  name: "task-history",
  component: () => import("./page.vue"),
  meta: {
    title: "历史任务数据",
    subtitle: "查看已受理任务的历史状态、更新时间与样品流转摘要。",
    module: "central",
  },
};

export default {
  key: "task-history",
  nav: true,
  route,
};
