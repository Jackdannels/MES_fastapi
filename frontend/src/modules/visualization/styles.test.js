import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const visualizationStylesPath = resolve(process.cwd(), "src/modules/visualization/styles.css");
const visualizationPagePath = resolve(process.cwd(), "src/modules/visualization/page.vue");

describe("visualization styles", () => {
  test("lab-process single preview fits viewport height and avoids a duplicate outer frame", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-preview-shell\.is-screen-only\s*{[^}]*width:\s*100vw;[^}]*height:\s*100dvh;/s);
    expect(source).toMatch(/\.visual-expanded-screen\.is-screen-only\s*{[^}]*aspect-ratio:\s*auto;[^}]*border:\s*0;/s);
    expect(source).toMatch(/\.visual-expanded-screen\.is-lab-process\s*{[^}]*border-color:\s*transparent;/s);
    expect(source).toMatch(/\.visual-expanded-screen\.is-lab-process\s*{[^}]*box-shadow:\s*none;/s);
  });

  test("schedule screen grid compresses laboratory rows inside the 1080p screen frame", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toContain("grid-template-rows: 28px repeat(var(--visual-schedule-row-count), minmax(0, 1fr))");
    expect(source).toMatch(/\.visual-schedule-lab-name,\s*\.visual-schedule-cell\s*{[^}]*min-height:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-slot\s*{[^}]*align-content:\s*stretch;[^}]*justify-items:\s*stretch;[^}]*grid-auto-rows:\s*minmax\(0,\s*1fr\);[^}]*padding:\s*0;[^}]*border-left:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-task\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*align-content:\s*center;[^}]*justify-items:\s*center;[^}]*text-align:\s*center;[^}]*border-left:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-task strong\s*{[^}]*max-width:\s*100%;[^}]*font-size:\s*14px;/s);
    expect(source).toMatch(/\.visual-schedule-task span\s*{[^}]*max-width:\s*100%;[^}]*font-size:\s*13px;[^}]*font-weight:\s*900;/s);
    expect(source).toMatch(/\.visual-schedule-task small\s*{[^}]*max-width:\s*100%;[^}]*font-size:\s*12px;[^}]*font-weight:\s*900;/s);
    const runningSlotRule = source.slice(
      source.indexOf(".visual-schedule-slot.state-running {"),
      source.indexOf(".visual-schedule-slot.state-maintenance"),
    );
    expect(runningSlotRule).toContain("var(--schedule-task-color)");
    expect(source).toMatch(/\.visual-schedule-slot\.is-idle \.visual-schedule-idle\s*{[^}]*place-items:\s*center;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*font-size:\s*13px;/s);
    expect(source).toMatch(/\.visual-schedule-day\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*justify-items:\s*center;/s);
    expect(source).toMatch(/\.visual-schedule-day small\s*{[^}]*position:\s*absolute;[^}]*right:\s*10px;/s);
  });

  test("schedule screen uses task color on every occupied cell", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");
    const pageSource = readFileSync(visualizationPagePath, "utf8");

    expect(pageSource).toContain("scheduleSlotTaskColor(slot)");
    expect(pageSource).toContain("\"--schedule-task-color\": scheduleSlotTaskColor(slot)");
    expect(pageSource).toContain("\"--schedule-task-color\": item?.color || slot.taskColor");
    const occupiedSlotRule = source.slice(
      source.indexOf(".visual-schedule-slot.is-planned,"),
      source.indexOf(".visual-schedule-slot.state-maintenance"),
    );
    expect(occupiedSlotRule).toContain(".visual-schedule-slot.state-busy");
    expect(occupiedSlotRule).toContain(".visual-schedule-slot.state-stacked");
    expect(occupiedSlotRule).toContain("var(--schedule-task-color)");
  });

  test("visualization cells constrain long text inside their panels", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-lab-switch-option strong,\s*\.visual-lab-switch-option small\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(source).toMatch(/\.visual-schedule-grid-head\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(source).toMatch(/\.visual-schedule-task strong\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  });

  test("lab process layout reserves space for complete tray flow diagrams", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toContain(".visual-board.is-layout-a");
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-line,[^{]+\.visual-board\.is-layout-c \.visual-flow-line\s*{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/s);
  });

  test("layout A keeps fixed vertical budget so content does not collapse", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-board-metrics\s*{[^}]*display:\s*none;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-panels\s*{[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-panel\s*{[^}]*grid-template-columns:\s*minmax\(230px,\s*0\.22fr\) minmax\(0,\s*1fr\) minmax\(260px,\s*0\.24fr\);[^}]*grid-template-rows:\s*minmax\(32px,\s*auto\) minmax\(0,\s*1fr\) minmax\(42px,\s*auto\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switchboard\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2 \/ span 2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-tray-flow-list\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2 \/ span 2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-status-row\s*{[^}]*grid-column:\s*3;[^}]*grid-row:\s*2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-ok-strip,\s*\.visual-board\.is-layout-a \.visual-alert-strip\s*{[^}]*grid-column:\s*3;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-line\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(4,\s*minmax\(60px,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(5\)\s*{[^}]*grid-column:\s*4;[^}]*grid-row:\s*2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(8\)\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s);
    expect(source).not.toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(\d+\)::before/);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-forward::before\s*{[^}]*left:\s*calc\(-50% - 6px\);[^}]*height:\s*2px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-backward::before\s*{[^}]*right:\s*calc\(-50% - 6px\);[^}]*height:\s*2px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-turn::before\s*{[^}]*left:\s*50%;[^}]*width:\s*2px;[^}]*height:\s*calc\(100% \+ 10px\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\s*{[^}]*min-height:\s*60px;[^}]*padding:\s*4px 8px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switchboard\s*{[^}]*grid-auto-rows:\s*minmax\(0,\s*1fr\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-group\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*min-height:\s*0;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-options\s*{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
  });

  test("layout A connects vertical flow turns across stretched rows and enlarges step labels", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\s*{[^}]*height:\s*100%;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-turn::before\s*{[^}]*top:\s*calc\(-100% - 10px \+ 18px\);[^}]*height:\s*calc\(100% \+ 10px\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step strong\s*{[^}]*font-size:\s*15px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step small\s*{[^}]*font-size:\s*13px;/s);
  });

  test("layout A connects manufacturer return below post-experiment staging for long flows", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(13\)\s*{[^}]*grid-column:\s*4;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(14\)\s*{[^}]*grid-column:\s*3;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(15\)\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(16\)\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-backward::before\s*{[^}]*right:\s*calc\(-50% - 6px\);[^}]*height:\s*2px;/s);
  });

  test("layout A uses connector direction classes so wrapped row starts do not draw stray horizontal lines", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");
    const pageSource = readFileSync(visualizationPagePath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-none::before\s*{[^}]*display:\s*none;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-forward::before\s*{[^}]*left:\s*calc\(-50% - 6px\);[^}]*width:\s*calc\(100% \+ 12px\);[^}]*height:\s*2px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-backward::before\s*{[^}]*right:\s*calc\(-50% - 6px\);[^}]*left:\s*auto;[^}]*width:\s*calc\(100% \+ 12px\);[^}]*height:\s*2px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\.is-connector-turn::before\s*{[^}]*left:\s*50%;[^}]*width:\s*2px;[^}]*height:\s*calc\(100% \+ 10px\);/s);
    expect(pageSource).toContain("flowStepConnectorClass(stepIndex, flowLayoutColumns)");
    expect(pageSource).toContain("return \"is-connector-turn\"");
  });

  test("compact lab process also uses connector direction classes instead of default wrapped horizontal lines", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");
    const pageSource = readFileSync(visualizationPagePath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-compact \.visual-flow-line\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(4,\s*minmax\(28px,\s*auto\)\);/s);
    expect(source).toMatch(/\.visual-board\.is-compact \.visual-flow-step\.is-connector-none::before\s*{[^}]*display:\s*none;/s);
    expect(source).toMatch(/\.visual-board\.is-compact \.visual-flow-step\.is-connector-forward::before\s*{[^}]*left:\s*calc\(-50% - 2px\);[^}]*height:\s*1px;/s);
    expect(source).toMatch(/\.visual-board\.is-compact \.visual-flow-step\.is-connector-backward::before\s*{[^}]*right:\s*calc\(-50% - 2px\);[^}]*height:\s*1px;/s);
    expect(source).toMatch(/\.visual-board\.is-compact \.visual-flow-step\.is-connector-turn::before\s*{[^}]*left:\s*50%;[^}]*width:\s*1px;[^}]*height:\s*calc\(100% \+ 4px\);/s);
    expect(pageSource).toContain("FLOW_LAYOUT_COLUMNS");
    expect(pageSource).toContain("props.compact ? FLOW_LAYOUT_COLUMNS.compact : FLOW_LAYOUT_COLUMNS.layoutA");
    expect(pageSource).toContain("flowStepConnectorClass(stepIndex, flowLayoutColumns)");
  });

  test("uses a yellow inferred-node tone instead of orange for reset and compatibility states", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-flow-step\.is-inferred\s*{[^}]*color:\s*#fef08a;/s);
    expect(source).toMatch(/\.visual-flow-step\.is-inferred \.visual-flow-dot\s*{[^}]*background:\s*#facc15;/s);
    expect(source).not.toMatch(/\.visual-flow-step\.is-inferred \.visual-flow-dot\s*{[^}]*background:\s*#eab308;/s);
  });

  test("layout A makes task and tray switch text easier to read", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-group > span\s*{[^}]*font-size:\s*14px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-option strong\s*{[^}]*font-size:\s*15px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-option small\s*{[^}]*font-size:\s*13px;/s);
  });

  test("layout A enlarges the lab switch action button", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-cycle\s*{[^}]*min-height:\s*34px;[^}]*padding:\s*0 12px;[^}]*font-size:\s*14px;/s);
  });

  test("staging sample screen defines full and compact industrial board layouts", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");
    const pageSource = readFileSync(visualizationPagePath, "utf8");

    expect(source).toContain(".visual-staging-board");
    expect(source).toContain(".visual-staging-overview");
    expect(source).toMatch(/\.visual-staging-layout\s*{[^}]*grid-template-columns:\s*minmax\(220px,\s*0\.23fr\) minmax\(0,\s*1fr\) minmax\(260px,\s*0\.26fr\);/s);
    expect(source).toMatch(/\.visual-staging-main\s*{[^}]*grid-template-columns:\s*minmax\(240px,\s*0\.34fr\) minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
    expect(source).toMatch(/\.visual-staging-tray-switch\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*max-height:\s*none;/s);
    expect(source).toMatch(/\.visual-staging-tray-detail\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/s);
    expect(source).toMatch(/\.visual-staging-sample-wrap\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
    expect(source).toMatch(/\.visual-staging-sample-grid\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-staging-sample-grid\.is-looping\s*{[^}]*animation-name:\s*visual-staging-sample-loop;/s);
    expect(source).toContain("@keyframes visual-staging-sample-loop");
    expect(source).toMatch(/\.visual-staging-sample-code\s*{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;[^}]*word-break:\s*break-all;/s);
    expect(pageSource).toContain("sampleCodes");
    expect(pageSource).toContain("visual-staging-sample-viewport");
    expect(pageSource).toContain("自动循环播放");
    expect(pageSource).toContain("singleCycleHeight > viewport.clientHeight");
    expect(source).toMatch(/\.visual-staging-task-option,\s*\.visual-staging-tray-option\s*{[^}]*min-height:\s*58px;/s);
    expect(source).toContain(".visual-staging-capacity");
    expect(source).toContain(".visual-staging-capacity-ticks");
    expect(source).toContain(".visual-staging-capacity-tick");
    expect(source).toContain(".visual-staging-low-stock");
    expect(source).not.toContain(".visual-staging-modal");
    expect(source).not.toContain(".visual-staging-all-samples");
    expect(source).toMatch(/\.visual-board\.is-compact \.visual-staging-layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(120px,\s*0\.38fr\);/s);
  });

  test("today task plan screen enlarges real-data table text and fills cells", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");
    const pageSource = readFileSync(visualizationPagePath, "utf8");

    expect(pageSource).toContain("实验数量");
    expect(pageSource).toContain("todayTaskPlanView");
    expect(pageSource).not.toContain("mockTodayTaskPlans");
    expect(source).toMatch(/\.visual-task-plan-table\s*{[^}]*grid-auto-rows:\s*minmax\(76px,\s*auto\);/s);
    expect(source).toMatch(/\.visual-task-plan-table\.is-empty\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
    expect(pageSource).toContain("taskRows.length ? \"\" : \"is-empty\"");
    expect(source).toMatch(/\.visual-task-plan-row\.is-flat\s*{[^}]*min-height:\s*76px;/s);
    expect(pageSource).toContain("visual-task-plan-row-tone");
    expect(source).toContain(".visual-task-plan-row.is-tone-a");
    expect(source).toContain(".visual-task-plan-row.is-tone-b");
    expect(source).toMatch(/\.visual-task-plan-row strong\s*{[^}]*width:\s*100%;[^}]*font-size:\s*16px;/s);
    expect(source).toMatch(/\.visual-task-plan-row span\s*{[^}]*width:\s*100%;[^}]*font-size:\s*15px;/s);
    expect(source).toMatch(/\.visual-task-plan-table-head span\s*{[^}]*font-size:\s*14px;/s);
    expect(pageSource).toContain("visual-task-plan-tray-chip");
    expect(source).toMatch(/\.visual-task-plan-table-head\.is-flat,\s*\.visual-task-plan-row\.is-flat\s*{[^}]*grid-template-columns:\s*minmax\(154px,\s*1\.08fr\)\s+minmax\(96px,\s*0\.7fr\)\s+minmax\(112px,\s*0\.74fr\)\s+minmax\(104px,\s*0\.68fr\)\s+minmax\(220px,\s*1\.62fr\)\s+minmax\(72px,\s*0\.44fr\);/s);
    expect(source).toMatch(/\.visual-task-plan-tray-list\s*{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
    expect(source).toMatch(/\.visual-task-plan-tray-chip\s*{[^}]*flex:\s*0 1 calc\(50% - 4px\);/s);
  });

  test("current lab task screen defines state tones and running-only countdown styles", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");
    const pageSource = readFileSync(visualizationPagePath, "utf8");

    expect(pageSource).toContain("key: \"current-lab-tasks\"");
    expect(pageSource).toContain("return CurrentLabTasksScreen");
    expect(pageSource).toContain("data-testid\": \"lab-matrix-countdown\"");
    expect(pageSource).toContain("visual-lab-matrix-screen");
    expect(pageSource).not.toContain("class: \"visual-current-lab");
    expect(pageSource).toContain("LAB TASK MATRIX");
    expect(pageSource).not.toContain("系统状态同步");
    expect(pageSource).toContain("已排程");
    expect(pageSource).toContain("metric-scheduled");
    expect(pageSource).toContain("计划时间");
    expect(pageSource).toContain("card-body");
    expect(pageSource).toContain("tray-panel");
    expect(pageSource).toContain("tray-row");
    expect(pageSource).toContain("total");
    expect(pageSource).toContain("singleCycleHeight > viewport.clientHeight");
    expect(pageSource).not.toContain("trayItems.length > 8");
    expect(source).toContain(".visual-lab-matrix-screen");
    expect(source).not.toContain(".visual-current-lab");
    expect(source).not.toContain(".visual-standalone-screen");
    expect(source).toMatch(/\.visual-lab-matrix-screen\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);[^}]*background-size:\s*40px 40px,\s*40px 40px,\s*auto;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.header\s*{[^}]*display:\s*flex;[^}]*align-items:\s*end;[^}]*min-height:\s*clamp\(48px,\s*5vh,\s*74px\);[^}]*border-bottom:\s*1px solid rgba\(35,\s*215,\s*208,\s*0\.26\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.attendance-chip\s*{[^}]*margin-left:\s*auto;[^}]*flex:\s*0 1 10rem;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.attendance-chip\s*{[^}]*border:\s*0;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.attendance-chip\s*{[^}]*background:\s*transparent;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.attendance-chip\.is-empty\s*{[^}]*background:\s*transparent;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.badge\s*{[^}]*border:\s*0;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.badge\s*{[^}]*background:\s*transparent;/s);
    expect(source).not.toMatch(/\.visual-lab-matrix-screen \.card\.[^{]+ \.badge\s*{[^}]*border-color:/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.card-head,\s*\.visual-lab-matrix-screen \.countdown-head\s*{[^}]*gap:\s*4px;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.kicker\s*{[^}]*color:\s*var\(--cyan\);[^}]*font-size:\s*var\(--small\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen h1\s*{[^}]*font-size:\s*clamp\(20px,\s*1\.28vw,\s*34px\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.stat strong\s*{[^}]*font-size:\s*clamp\(21px,\s*1\.45vw,\s*38px\);[^}]*line-height:\s*1;/s);
    expect(source).not.toMatch(/\.visual-lab-matrix-screen \.stat strong\s*{[^}]*font:\s*900/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.stat\s*{[^}]*border-radius:\s*0;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.grid\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.card\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.card\s*{[^}]*border-radius:\s*0;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.card-body\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.96fr\) minmax\(0,\s*1\.08fr\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.left\s*{[^}]*grid-template-rows:\s*minmax\(42px,\s*0\.82fr\) minmax\(38px,\s*0\.78fr\) minmax\(38px,\s*0\.78fr\) minmax\(44px,\s*0\.9fr\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.info\s*{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*gap:\s*5px;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.time strong\s*{[^}]*font-size:\s*var\(--body\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.tray-panel\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.info,\s*\.visual-lab-matrix-screen \.tray-panel\s*{[^}]*border-radius:\s*0;/s);
    expect(source).toContain("@media (max-width: 1700px),(max-height: 950px)");
    expect(source).toMatch(/\.visual-lab-matrix-screen \.left\s*{[^}]*grid-template-rows:\s*minmax\(35px,\s*0\.78fr\) minmax\(32px,\s*0\.7fr\) minmax\(32px,\s*0\.7fr\) minmax\(40px,\s*0\.86fr\);/s);
    expect(source).toContain("@media (min-width: 2300px) and (min-height: 1250px)");
    expect(source).toContain(".visual-lab-matrix-screen .tray-viewport");
    expect(source).toMatch(/\.visual-lab-matrix-screen \.tray-row\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.tray-row\s*{[^}]*border-radius:\s*0;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.tray-code,\s*\.visual-lab-matrix-screen \.tray-qty\s*{[^}]*font-size:\s*var\(--body\);/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.total\s*{[^}]*border-top:\s*2px solid/s);
    expect(source).toContain("@keyframes lab-matrix-tray-loop");
    expect(source).toMatch(/\.visual-lab-matrix-screen \.tray-list\.is-looping\s*{[^}]*animation-name:\s*lab-matrix-tray-loop;/s);
    expect(source).toMatch(/\.visual-lab-matrix-screen \.card\s*{[^}]*border:\s*1px solid rgba\(145,\s*196,\s*192,\s*0\.66\);/s);
    expect(source).not.toContain("inset 4px 0 0 var(--current-task-tone)");
    expect(source).toContain(".visual-lab-matrix-screen .stat.blue");
    expect(source).toContain(".visual-lab-matrix-screen .stat.red");
    expect(source).toContain(".visual-lab-matrix-screen .stat.green");
    expect(source).toContain(".visual-lab-matrix-screen .stat.orange");
    expect(source).toContain(".visual-lab-matrix-screen .card.planned");
    expect(source).toContain(".visual-lab-matrix-screen .card.repair");
    expect(source).toContain(".visual-lab-matrix-screen .card.running");
    expect(source).toContain(".visual-lab-matrix-screen .card.near");
    expect(source).toContain(".visual-lab-matrix-screen .card.is-blinking");
    expect(source).toContain("@keyframes lab-matrix-pulse");
    expect(source).toContain(".visual-lab-matrix-screen .countdown");
    expect(source).toContain(".visual-lab-matrix-screen .progress");
    expect(source).toMatch(/\.visual-lab-matrix-screen \.progress i\s*{[^}]*width:\s*var\(--current-task-progress,\s*0%\);/s);
    expect(source).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)\s*{[^}]*\.visual-lab-matrix-screen \.card\.is-blinking\s*{[^}]*animation:\s*none;/s);
    expect(pageSource).toMatch(/class="visual-screen-close"[\s\S]*>\s*×\s*<\/button>/);
    expect(source).toMatch(/\.visual-screen-close\s*{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*min-width:\s*32px;[^}]*border-radius:\s*4px;/s);
  });

  test("analysis screen keeps custom time filtering in one row and reserves full-screen chart space", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toContain(".visual-analysis-board");
    expect(source).toMatch(/\.visual-analysis-filter-row\s*{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;/s);
    expect(source).toMatch(/\.visual-analysis-layout\s*{[^}]*grid-template-columns:\s*minmax\(430px,\s*0\.4fr\) minmax\(0,\s*0\.6fr\);[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) minmax\(128px,\s*0\.16fr\);/s);
    expect(source).toMatch(/\.visual-analysis-product-panel\s*{[^}]*grid-template-columns:\s*minmax\(640px,\s*0\.58fr\) minmax\(360px,\s*0\.42fr\);/s);
    expect(source).toMatch(/\.visual-analysis-custom-menu\s*{[^}]*position:\s*absolute;[^}]*right:\s*0;/s);
    expect(source).toMatch(/\.visual-analysis-top\s*{[^}]*z-index:\s*20;/s);
    expect(source).toMatch(/\.visual-analysis-custom-menu\s*{[^}]*z-index:\s*40;/s);
    expect(source).toMatch(/\.visual-analysis-picker-panel\.is-calendar,\s*\.visual-analysis-picker-panel\.is-range\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
    expect(source).toContain(".visual-analysis-calendar-wheel-panel");
    expect(source).toMatch(/\.visual-analysis-calendar-wheel-panel\s*{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-analysis-calendar-wheel-options\s*{[^}]*height:\s*120px;[^}]*overflow:\s*hidden;/s);
    expect(source).toMatch(/\.visual-analysis-calendar-wheel-track\s*{[^}]*transform:\s*translateY\(calc\(var\(--visual-wheel-index,\s*0\) \* -32px\)\);/s);
    expect(source).toContain(".visual-analysis-calendar-arrow");
    const closeZIndex = Number(source.match(/\.visual-screen-close\s*{[^}]*z-index:\s*(\d+);/s)?.[1] || 0);
    const customMenuZIndex = Number(source.match(/\.visual-analysis-custom-menu\s*{[^}]*z-index:\s*(\d+);/s)?.[1] || 0);
    expect(closeZIndex).toBeGreaterThan(customMenuZIndex);
  });
});
