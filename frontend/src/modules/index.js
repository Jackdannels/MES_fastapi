import loginModule from "./login";
import dashboardModule from "./dashboard";
import tasksModule from "./tasks";
import taskOverviewModule from "./task-overview";
import samplePreAllocationModule from "./sample-pre-allocation";
import scheduleModule from "./schedule";
import samplesModule from "./samples";
import handoverSystemModule from "./handover-system";
import processModule from "./process";
import devicesModule from "./devices";
import dataModule from "./data";
import systemModule from "./system";
import taskHistoryModule from "./task-history";
import visualizationModule from "./visualization";
import stagingManagementModule from "./staging-management";
import appearanceInspectionModule from "./appearance-inspection";
import laboratoryModule from "./laboratory";

// 所有模块定义集中注册在这里，供路由和导航统一消费。
export const MODULES = [
  loginModule,
  dashboardModule,
  tasksModule,
  taskOverviewModule,
  samplePreAllocationModule,
  scheduleModule,
  samplesModule,
  handoverSystemModule,
  processModule,
  devicesModule,
  dataModule,
  systemModule,
  taskHistoryModule,
  visualizationModule,
  stagingManagementModule,
  appearanceInspectionModule,
  laboratoryModule,
];

// 路由表直接从模块定义中提取，避免单独维护第二份配置。
export const routes = MODULES.map((module) => module.route);

// 侧边导航只展示与当前界面分组匹配且显式标记了 nav 的模块。
export const getNavigationModules = (moduleKey) =>
  MODULES.filter((module) => module.nav && module.route.meta?.module === moduleKey);
