import loginModule from "./login";
import dashboardModule from "./dashboard";
import taskOverviewModule from "./task-overview";
import tasksModule from "./tasks";
import scheduleModule from "./schedule";
import samplesModule from "./samples";
import processModule from "./process";
import devicesModule from "./devices";
import dataModule from "./data";
import systemModule from "./system";
import visualizationModule from "./visualization";
import stagingManagementModule from "./staging-management";

export const MODULES = [
  loginModule,
  dashboardModule,
  taskOverviewModule,
  tasksModule,
  scheduleModule,
  samplesModule,
  processModule,
  devicesModule,
  dataModule,
  systemModule,
  visualizationModule,
  stagingManagementModule,
];

export const routes = MODULES.map((module) => module.route);

export const getNavigationModules = (moduleKey) =>
  MODULES.filter((module) => module.nav && module.route.meta?.module === moduleKey);

export const getRouteModuleByName = (name) => MODULES.find((module) => module.route.name === name) || null;
