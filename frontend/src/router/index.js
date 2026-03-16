import { createRouter, createWebHistory } from "vue-router";
import { fetchAuthSession } from "@/auth";
import { buildRouteAccessDecision } from "@/lib/authRouting";
import { buildDocumentTitle } from "@/lib/routerTitle";
import LoginPage from "@/pages/LoginPage.vue";
import DashboardPage from "@/pages/DashboardPage.vue";
import TaskOverviewPage from "@/pages/TaskOverviewPage.vue";
import TasksPage from "@/pages/TasksPage.vue";
import SchedulePage from "@/pages/SchedulePage.vue";
import SamplesPage from "@/pages/SamplesPage.vue";
import ProcessPage from "@/pages/ProcessPage.vue";
import DevicesPage from "@/pages/DevicesPage.vue";
import DataPage from "@/pages/DataPage.vue";
import SystemPage from "@/pages/SystemPage.vue";
import VisualizationPage from "@/pages/VisualizationPage.vue";
import StagingManagementPage from "@/pages/StagingManagementPage.vue";

const routes = [
  {
    path: "/login",
    name: "login",
    component: LoginPage,
    meta: {
      title: "登录",
      subtitle: "账号登录与分界面选择。",
      layout: "auth",
    },
  },
  {
    path: "/",
    name: "dashboard",
    component: DashboardPage,
    meta: {
      title: "中控总览",
      subtitle: "任务、设备与数据流的实时概览。",
      module: "central",
    },
  },
  {
    path: "/task-overview",
    name: "task-overview",
    component: TaskOverviewPage,
    meta: {
      title: "任务/托盘总览",
      subtitle: "按任务与托盘双视角查看类型、分配与排期状态。",
      module: "central",
    },
  },
  {
    path: "/tasks",
    name: "tasks",
    component: TasksPage,
    meta: {
      title: "任务受理",
      subtitle: "外部委托与内部新增统一受理与排队。",
      module: "central",
    },
  },
  {
    path: "/schedule",
    name: "schedule",
    component: SchedulePage,
    meta: {
      title: "排程看板",
      subtitle: "以设备空间为核心的排程与冲突管理。",
      module: "central",
    },
  },
  {
    path: "/samples",
    name: "samples",
    component: SamplesPage,
    meta: {
      title: "样品管理",
      subtitle: "样品登记、到样确认、流转与留样全链路。",
      module: "central",
    },
  },
  {
    path: "/process",
    name: "process",
    component: ProcessPage,
    meta: {
      title: "试验过程管控",
      subtitle: "按实验室查看当前状态、任务占用与排期入口。",
      module: "central",
    },
  },
  {
    path: "/devices",
    name: "devices",
    component: DevicesPage,
    meta: {
      title: "设备资源",
      subtitle: "设备台账、校准状态与 Modbus 点位配置。",
      module: "central",
    },
  },
  {
    path: "/data",
    name: "data",
    component: DataPage,
    meta: {
      title: "试验数据",
      subtitle: "自动采集、校验与固定模板报告。",
      module: "central",
    },
  },
  {
    path: "/system",
    name: "system",
    component: SystemPage,
    meta: {
      title: "系统信息",
      subtitle: "用户、班次与基础配置。",
      module: "central",
    },
  },
  {
    path: "/visualization",
    name: "visualization",
    component: VisualizationPage,
    meta: {
      title: "可视化管理",
      subtitle: "可视化管理分界面。",
      module: "visual",
    },
  },
  {
    path: "/staging-management",
    name: "staging-management",
    component: StagingManagementPage,
    meta: {
      title: "暂存间管理",
      subtitle: "暂存间管理分界面。",
      module: "staging",
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

router.beforeEach(async (to) => {
  return buildRouteAccessDecision({
    getSession: fetchAuthSession,
    to,
  });
});

router.afterEach((to) => {
  document.title = buildDocumentTitle(to.meta?.title);
});

export default router;
