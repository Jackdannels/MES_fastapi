import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const sharedComponentsCssPath = resolve(process.cwd(), "src/shared/styles/components.css");
const loginStylesPath = resolve(process.cwd(), "src/modules/login/styles.css");
const dashboardStylesPath = resolve(process.cwd(), "src/modules/dashboard/styles.css");
const taskOverviewStylesPath = resolve(process.cwd(), "src/modules/task-overview/styles.css");
const processStylesPath = resolve(process.cwd(), "src/modules/process/styles.css");
const scheduleStylesPath = resolve(process.cwd(), "src/modules/schedule/styles.css");
const tasksStylesPath = resolve(process.cwd(), "src/modules/tasks/styles.css");
const devicesStylesPath = resolve(process.cwd(), "src/modules/devices/styles.css");
const dataStylesPath = resolve(process.cwd(), "src/modules/data/styles.css");
const systemStylesPath = resolve(process.cwd(), "src/modules/system/styles.css");
const tasksPagePath = resolve(process.cwd(), "src/modules/tasks/page.vue");
const devicesPagePath = resolve(process.cwd(), "src/modules/devices/page.vue");
const dataPagePath = resolve(process.cwd(), "src/modules/data/page.vue");
const systemPagePath = resolve(process.cwd(), "src/modules/system/page.vue");
const visualizationStylesPath = resolve(process.cwd(), "src/modules/visualization/styles.css");
const stagingManagementStylesPath = resolve(process.cwd(), "src/modules/staging-management/styles.css");
const laboratoryStylesPath = resolve(process.cwd(), "src/modules/laboratory/styles.css");
const visualizationPagePath = resolve(process.cwd(), "src/modules/visualization/page.vue");
const stagingManagementPagePath = resolve(process.cwd(), "src/modules/staging-management/page.vue");
const laboratoryPagePath = resolve(process.cwd(), "src/modules/laboratory/page.vue");

describe("module style structure", () => {
  test("login, dashboard, task overview, process, and schedule styles live in their module files", () => {
    const sharedComponentsCssSource = readFileSync(sharedComponentsCssPath, "utf8");
    const loginStylesSource = readFileSync(loginStylesPath, "utf8");
    const dashboardStylesSource = readFileSync(dashboardStylesPath, "utf8");
    const taskOverviewStylesSource = readFileSync(taskOverviewStylesPath, "utf8");
    const processStylesSource = readFileSync(processStylesPath, "utf8");
    const scheduleStylesSource = readFileSync(scheduleStylesPath, "utf8");

    expect(loginStylesSource).toContain(".login-wrap");
    expect(loginStylesSource).toContain(".login-submit");
    expect(dashboardStylesSource).toContain(".dashboard-task-header");
    expect(dashboardStylesSource).toContain(".dashboard-task-pagination");
    expect(taskOverviewStylesSource).toContain(".task-overview-header");
    expect(taskOverviewStylesSource).toContain(".task-overview-card");
    expect(taskOverviewStylesSource).toContain(".task-overview-editor");
    expect(processStylesSource).toContain(".process-control-page");
    expect(processStylesSource).toContain(".process-lab-grid");
    expect(scheduleStylesSource).toContain(".board-row");
    expect(scheduleStylesSource).toContain(".retention-age");

    expect(sharedComponentsCssSource).not.toContain(".login-wrap");
    expect(sharedComponentsCssSource).not.toContain(".dashboard-task-header");
    expect(sharedComponentsCssSource).not.toContain(".task-overview-header");
    expect(sharedComponentsCssSource).not.toContain(".process-control-page");
    expect(sharedComponentsCssSource).not.toContain(".retention-age");
  });

  test("central, visualization, staging, and laboratory pages own their page-shell classes", () => {
    const tasksStylesSource = readFileSync(tasksStylesPath, "utf8");
    const devicesStylesSource = readFileSync(devicesStylesPath, "utf8");
    const dataStylesSource = readFileSync(dataStylesPath, "utf8");
    const systemStylesSource = readFileSync(systemStylesPath, "utf8");
    const visualizationStylesSource = readFileSync(visualizationStylesPath, "utf8");
    const stagingManagementStylesSource = readFileSync(stagingManagementStylesPath, "utf8");
    const laboratoryStylesSource = readFileSync(laboratoryStylesPath, "utf8");
    const tasksPageSource = readFileSync(tasksPagePath, "utf8");
    const devicesPageSource = readFileSync(devicesPagePath, "utf8");
    const dataPageSource = readFileSync(dataPagePath, "utf8");
    const systemPageSource = readFileSync(systemPagePath, "utf8");
    const visualizationPageSource = readFileSync(visualizationPagePath, "utf8");
    const stagingManagementPageSource = readFileSync(stagingManagementPagePath, "utf8");
    const laboratoryPageSource = readFileSync(laboratoryPagePath, "utf8");

    expect(tasksStylesSource).toContain(".tasks-page");
    expect(devicesStylesSource).toContain(".devices-page");
    expect(dataStylesSource).toContain(".data-page");
    expect(systemStylesSource).toContain(".system-page");
    expect(visualizationStylesSource).toContain(".visualization-page");
    expect(stagingManagementStylesSource).toContain(".staging-management-page");
    expect(laboratoryStylesSource).toContain(".laboratory-page");
    expect(laboratoryStylesSource).toContain(".laboratory-task-list-modal .modal-content");
    expect(laboratoryStylesSource).toContain(".laboratory-task-list-card th");
    expect(laboratoryStylesSource).toContain("white-space: nowrap");

    expect(tasksPageSource).toContain('class="tasks-page"');
    expect(devicesPageSource).toContain('class="devices-page"');
    expect(dataPageSource).toContain('class="data-page"');
    expect(systemPageSource).toContain('class="system-page"');
    expect(visualizationPageSource).toContain('class="visualization-page"');
    expect(stagingManagementPageSource).toContain('class="staging-management-page"');
    expect(laboratoryPageSource).toContain('class="laboratory-page"');
    expect(laboratoryPageSource).toContain('class="laboratory-task-list-modal"');

    expect(tasksStylesSource).not.toContain("Reserved for");
    expect(devicesStylesSource).not.toContain("Reserved for");
    expect(dataStylesSource).not.toContain("Reserved for");
    expect(systemStylesSource).not.toContain("Reserved for");
    expect(visualizationStylesSource).not.toContain("Reserved for");
    expect(stagingManagementStylesSource).not.toContain("Reserved for");
    expect(laboratoryStylesSource).not.toContain("Reserved for");
  });

  test("central pages define local section classes for their main layouts", () => {
    const tasksStylesSource = readFileSync(tasksStylesPath, "utf8");
    const devicesStylesSource = readFileSync(devicesStylesPath, "utf8");
    const dataStylesSource = readFileSync(dataStylesPath, "utf8");
    const systemStylesSource = readFileSync(systemStylesPath, "utf8");
    const tasksPageSource = readFileSync(tasksPagePath, "utf8");
    const devicesPageSource = readFileSync(devicesPagePath, "utf8");
    const dataPageSource = readFileSync(dataPagePath, "utf8");
    const systemPageSource = readFileSync(systemPagePath, "utf8");

    expect(tasksStylesSource).toContain(".tasks-list-card");
    expect(tasksStylesSource).toContain(".tasks-intake-form");
    expect(devicesStylesSource).toContain(".devices-registry-card");
    expect(devicesStylesSource).toContain(".devices-maintenance-records");
    expect(dataStylesSource).toContain(".data-settings-card");
    expect(dataStylesSource).toContain(".data-failures-card");
    expect(systemStylesSource).toContain(".system-roles-card");
    expect(systemStylesSource).toContain(".system-settings-card");

    expect(tasksPageSource).toContain('class="card section tasks-list-card"');
    expect(tasksPageSource).toContain('class="tasks-intake-form"');
    expect(devicesPageSource).toContain('class="card section devices-registry-card"');
    expect(devicesPageSource).toContain('class="devices-maintenance-records"');
    expect(dataPageSource).toContain('class="card data-settings-card"');
    expect(dataPageSource).toContain('class="card data-failures-card"');
    expect(systemPageSource).toContain('class="card section system-roles-card"');
    expect(systemPageSource).toContain('class="card section system-settings-card"');
  });

  test("keeps the enlarged current status and lifecycle action on one row", () => {
    const devicesStylesSource = readFileSync(devicesStylesPath, "utf8");

    expect(devicesStylesSource).toMatch(/\.device-status-form-field\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/i);
    expect(devicesStylesSource).toMatch(/\.device-status-field\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+160px[^}]*width:\s*100%/i);
    expect(devicesStylesSource).toMatch(/\.device-status-form-field \.device-status-label\s*\{[^}]*display:\s*block[^}]*margin-bottom:\s*8px/i);
    expect(devicesStylesSource).toMatch(/\.device-status-display\s*\{[^}]*justify-content:\s*center[^}]*width:\s*100%[^}]*min-height:\s*72px[^}]*font-size:\s*28px/i);
    expect(devicesStylesSource).toMatch(/\.device-status-field \.device-status-display\.status\s*\{[^}]*align-items:\s*center[^}]*display:\s*flex[^}]*justify-content:\s*center[^}]*padding:\s*0\s+16px[^}]*font-size:\s*28px[^}]*line-height:\s*1/i);
    expect(devicesStylesSource).toMatch(/\.device-status-field \.action-btn\s*\{[^}]*width:\s*100%[^}]*min-height:\s*72px/i);
  });
});
