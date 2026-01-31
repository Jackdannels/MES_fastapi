import { createRouter, createWebHistory } from "vue-router";
import DashboardPage from "@/pages/DashboardPage.vue";
import TasksPage from "@/pages/TasksPage.vue";
import SchedulePage from "@/pages/SchedulePage.vue";
import SamplesPage from "@/pages/SamplesPage.vue";
import ProcessPage from "@/pages/ProcessPage.vue";
import DevicesPage from "@/pages/DevicesPage.vue";
import DataPage from "@/pages/DataPage.vue";
import SystemPage from "@/pages/SystemPage.vue";

const routes = [
  {
    path: "/",
    name: "dashboard",
    component: DashboardPage,
    meta: {
      title: "中控总览",
      subtitle: "任务、设备与数据流的实时概览。",
    },
  },
  {
    path: "/tasks",
    name: "tasks",
    component: TasksPage,
    meta: {
      title: "任务受理",
      subtitle: "外部委托与内部新增统一受理与排队。",
    },
  },
  {
    path: "/schedule",
    name: "schedule",
    component: SchedulePage,
    meta: {
      title: "排程看板",
      subtitle: "以设备空闲为核心的排程与冲突管理。",
    },
  },
  {
    path: "/samples",
    name: "samples",
    component: SamplesPage,
    meta: {
      title: "样品管理",
      subtitle: "样品登记、到样确认、流转与留样全链路。",
    },
  },
  {
    path: "/process",
    name: "process",
    component: ProcessPage,
    meta: {
      title: "试验过程管控",
      subtitle: "SOP 驱动执行，异常与复测闭环。",
    },
  },
  {
    path: "/devices",
    name: "devices",
    component: DevicesPage,
    meta: {
      title: "设备资源",
      subtitle: "设备台账、校准状态与 Modbus 点位配置。",
    },
  },
  {
    path: "/data",
    name: "data",
    component: DataPage,
    meta: {
      title: "试验数据",
      subtitle: "自动采集、校验与固定模板报告。",
    },
  },
  {
    path: "/system",
    name: "system",
    component: SystemPage,
    meta: {
      title: "系统信息",
      subtitle: "用户、班次与基础配置。",
    },
  },
];

const router = createRouter({
  history: createWebHistory("/"),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

router.afterEach((to) => {
  const title = to.meta?.title ? `${to.meta.title} - 七二四新火工区信息化中控管理系统` : "七二四新火工区信息化中控管理系统";
  document.title = title;
});

export default router;
