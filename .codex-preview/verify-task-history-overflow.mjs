import { chromium } from "playwright";

const baseUrl = "http://127.0.0.1:5174/task-history";
const tasks = [
  {
    id: "TASK-RETURNED-LONG",
    code: "TASK-RETURNED-LONG",
    name: "像素级验证-长日期任务",
    status: "厂家收回",
    updated_at: "2026-05-13T23:59:59.999+08:00",
  },
];
const samples = [
  {
    code: "SP-001",
    task_code: "TASK-RETURNED-LONG",
    status: "厂家收回",
    flow_status: "厂家收回",
    trays: [{ tray_code: "TP-001", status: "厂家收回" }],
    history: [
      { action: "批量入库", status: "到货", detail: "", time: "2026-05-13T08:01:02.987+08:00" },
      { action: "任务比对", status: "工装夹具安装", detail: "TP-001", time: "2026-05-13T09:15:22.456+08:00" },
      {
        action: "实验完成",
        status: "实验已完成",
        detail: "TASK-RETURNED-LONG / 高低温湿热试验 / 实验已完成",
        time: "2026-05-13T21:45:33.123+08:00",
      },
      { action: "厂家收回", status: "厂家收回", detail: "TP-001 厂家收回", time: "2026-05-13T23:59:59.999+08:00" },
    ],
  },
  {
    code: "SP-002",
    task_code: "TASK-RETURNED-LONG",
    status: "厂家收回",
    flow_status: "厂家收回",
    trays: [{ tray_code: "TP-002", status: "厂家收回" }],
    history: [
      { action: "实验完成", status: "实验已完成", detail: "TASK-RETURNED-LONG / 霉菌试验 / 实验已完成", time: "2026-05-13T20:05:01.777+08:00" },
      { action: "厂家收回", status: "厂家收回", detail: "TP-002 厂家收回", time: "2026-05-13T23:58:58.888+08:00" },
    ],
  },
];
const experiments = [
  {
    task_code: "TASK-RETURNED-LONG",
    experiment_code: "TASK-RETURNED-LONG-A",
    experiment_name: "高低温湿热试验",
    required_device: "高低温湿热试验",
    status: "实验已完成",
    updated_at: "2026-05-13T21:45:33.123+08:00",
  },
  {
    task_code: "TASK-RETURNED-LONG",
    experiment_code: "TASK-RETURNED-LONG-B",
    experiment_name: "霉菌试验",
    required_device: "霉菌试验",
    status: "实验已完成",
    updated_at: "2026-05-13T20:05:01.777+08:00",
  },
];
const experimentTrays = [
  { task_code: "TASK-RETURNED-LONG", experiment_code: "TASK-RETURNED-LONG-A", tray_code: "TP-001" },
  { task_code: "TASK-RETURNED-LONG", experiment_code: "TASK-RETURNED-LONG-B", tray_code: "TP-002" },
];
const storagePayload = {
  "mes.samples": samples,
  "mes.experiments": experiments,
  "mes.experiment_trays": experimentTrays,
  "mes.schedules": [],
  "mes.conflicts": [],
  "mes.tasks": tasks,
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];

try {
  for (const viewport of [
    { width: 1280, height: 900, name: "desktop" },
    { width: 900, height: 900, name: "tablet" },
    { width: 520, height: 900, name: "mobile" },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "mes_auth_session_v1",
        JSON.stringify({ username: "visual-check", module: "central", logged_at: "2026-05-13T00:00:00.000Z" }),
      );
    });
    await page.route("**/auth/session", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ username: "visual-check", module: "central", logged_at: "2026-05-13T00:00:00.000Z" }),
      }),
    );
    await page.route("**/api/tasks**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(tasks) }),
    );
    await page.route("**/api/storage", (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(storagePayload) });
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    try {
      await page.waitForSelector(".history-flow-strip-item", { timeout: 5000 });
    } catch (error) {
      await page.screenshot({ path: `.codex-preview/task-history-${viewport.name}-debug.png`, fullPage: true });
      console.log(JSON.stringify({
        viewport,
        bodyText: await page.locator("body").innerText({ timeout: 1000 }).catch(() => ""),
        url: page.url(),
      }, null, 2));
      throw error;
    }
    const screenshot = `.codex-preview/task-history-${viewport.name}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });

    const report = await page.evaluate(() => {
      const tolerance = 0.5;
      const nodes = Array.from(document.querySelectorAll(".history-flow-strip-item, .history-tray-flow-step"));
      return nodes.map((node, index) => {
        const parent = node.getBoundingClientRect();
        const children = Array.from(
          node.querySelectorAll(".history-flow-label, .history-flow-time, .history-flow-time__date, .history-flow-time__clock"),
        );
        return {
          index,
          className: node.className,
          parent: {
            left: parent.left,
            right: parent.right,
            top: parent.top,
            bottom: parent.bottom,
            width: parent.width,
            height: parent.height,
          },
          scrollOverflow: node.scrollWidth > Math.ceil(node.clientWidth) || node.scrollHeight > Math.ceil(node.clientHeight),
          title: node.querySelector(".history-flow-time")?.getAttribute("title") || "",
          children: children.map((child) => {
            const rect = child.getBoundingClientRect();
            const styles = window.getComputedStyle(child);
            return {
              className: child.className,
              text: child.textContent.trim(),
              visible: rect.width > 0 && rect.height > 0 && styles.display !== "none" && styles.visibility !== "hidden",
              rect: {
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
              },
              overflows:
                rect.left < parent.left - tolerance ||
                rect.right > parent.right + tolerance ||
                rect.top < parent.top - tolerance ||
                rect.bottom > parent.bottom + tolerance,
            };
          }),
        };
      });
    });

    const failures = report.flatMap((node) =>
      node.children.filter((child) => child.visible && child.overflows).map((child) => ({ node: node.index, child })),
    );
    const scrollFailures = report.filter((node) => node.scrollOverflow);
    const hiddenClockCount = await page.locator(".history-flow-strip .history-flow-time__clock").evaluateAll((items) =>
      items.filter((item) => getComputedStyle(item).display === "none").length,
    );

    results.push({
      viewport,
      nodeCount: report.length,
      failures,
      scrollFailures: scrollFailures.map((node) => ({ index: node.index, className: node.className, parent: node.parent })),
      hiddenClockCount,
      screenshot,
    });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));

if (results.some((result) => result.failures.length)) {
  process.exit(1);
}
