import { describe, expect, test } from "vitest";

import {
  buildTrayAuditCsv,
  buildTrayAuditJson,
  buildTrayAuditLog,
  buildTrayAuditSvg,
  formatAuditExportTime,
  formatAuditDuration,
} from "./trayAuditLog";

describe("tray audit log", () => {
  test("builds one chronological tray log and enriches sample history from staging events", () => {
    const taskCode = "SYLU-2026-08-001";
    const trayCode = `${taskCode}-TP-003`;
    const samples = ["SP-001", "SP-002"].map((sampleCode) => ({
      code: sampleCode,
      task_code: taskCode,
      trays: [{ tray_code: trayCode }],
      history: [
        {
          id: `history-${sampleCode}-dispatch`,
          detail: `${trayCode} 送至暂存间（实验前）`,
          status: "送至暂存间",
          time: "2026-08-01T15:49:30+08:00",
        },
        {
          id: `history-${sampleCode}-complete`,
          detail: `${taskCode} / 霉菌试验 / 实验已完成`,
          owner: "扫码登记",
          status: "实验已完成",
          time: "2026-08-01T15:59:52+08:00",
        },
      ],
    }));
    const stagingEvents = [
      {
        id: "staging-dispatch",
        action: "stock_out",
        operator: "转运员02",
        room: "appearance",
        target_lab: "恒温恒湿间（暂存间）",
        target_type: "staging",
        task_code: taskCode,
        time: "2026-08-01T15:49:30+08:00",
        tray_code: trayCode,
      },
      {
        id: "staging-return",
        action: "manufacturer_return",
        operator: "暂存员01",
        task_code: taskCode,
        time: "2026-08-01T18:18:05+08:00",
        tray_code: trayCode,
      },
      {
        id: "other-tray",
        action: "manufacturer_return",
        operator: "不应出现",
        task_code: taskCode,
        time: "2026-08-01T18:19:00+08:00",
        tray_code: `${taskCode}-TP-004`,
      },
    ];
    const attendanceOperations = [{
      action: "完成试验",
      employeeName: "张三",
      experimentCode: `${taskCode}-A`,
      id: 88,
      operatedAt: "2026-08-01T15:59:52+08:00",
      taskCode,
      username: "zhangsan",
    }];

    const log = buildTrayAuditLog({
      attendanceOperations,
      experimentTrays: [{ experiment_code: `${taskCode}-A`, task_code: taskCode, tray_code: trayCode }],
      samples,
      stagingEvents,
      taskCode,
      trayCode,
    });

    expect(log.events.map((event) => event.label)).toEqual([
      "送至暂存间（实验前）",
      "霉菌试验已完成",
      "厂家收回",
    ]);
    expect(log.events[0]).toMatchObject({
      operator: "转运员02",
      source: "暂存事件 / 样品历史",
      stage: "转运",
    });
    expect(log.events[0].sampleCodes).toEqual(["SP-001", "SP-002"]);
    expect(log.events[1]).toMatchObject({
      operator: "张三（zhangsan）",
      source: "职工操作记录 / 样品历史",
      stage: "实验",
    });
    expect(log.events[2]).toMatchObject({ operator: "暂存员01", source: "暂存事件", stage: "闭环" });
    expect(log.missingOperatorCount).toBe(0);
    expect(log.durationText).toBe("02:28:35");
    expect(log.events[1].elapsedText).toBe("10:22");
  });

  test("exports audit rows as BOM CSV, structured JSON, and escaped SVG", () => {
    const events = [{
      elapsedText: "01:00",
      eventId: "evt-1",
      label: "厂家收回 <完成>",
      operator: "操作员A",
      sampleCodes: ["SP-001"],
      source: "暂存事件",
      stage: "闭环",
      time: "2026-08-01T18:18:05+08:00",
    }];

    const csv = buildTrayAuditCsv({ events, taskCode: "TASK-1", trayCode: "TP-1" });
    const json = JSON.parse(buildTrayAuditJson({ events, generatedAt: "2026-08-01T10:18:05Z", taskCode: "TASK-1", trayCode: "TP-1" }));
    const svg = buildTrayAuditSvg({ events, taskCode: "TASK-1", trayCode: "TP-1" });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"2026年8月1日 18时18分05秒"');
    expect(csv).toContain('"厂家收回 <完成>"');
    expect(json).toMatchObject({ eventCount: 1, generatedAt: "2026-08-01T10:18:05Z", schemaVersion: "1.0" });
    expect(json.events[0].displayTime).toBe("2026年8月1日 18时18分05秒");
    expect(svg).toContain("托盘审计事件时间轴");
    expect(svg).toContain("厂家收回 &lt;完成&gt;");
    expect(svg).not.toContain("厂家收回 <完成>");
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="100%"');
    expect(svg).toContain('preserveAspectRatio="xMidYMin meet"');
    expect(svg).toContain('style="display:block;min-height:100vh;background:#0f172a"');
    expect(svg).toContain('<title id="tray-audit-title">TP-1 托盘审计事件时间轴</title>');
    expect(formatAuditDuration(2 * 60 * 60 * 1000 + 35 * 1000)).toBe("02:00:35");
    expect(formatAuditExportTime("2026-07-27 15:49:30")).toBe("2026年7月27日 15时49分30秒");
  });

  test("shows the optional mid-experiment appearance conclusion in tray logs", () => {
    const taskCode = "TASK-SALT";
    const trayCode = "TP-SALT";
    const base = {
      action: "stock_out",
      appearance_phase: "mid_experiment",
      room: "appearance",
      target_lab: "盐雾试验室",
      target_lab_code: "LAB_SALT",
      task_code: taskCode,
      tray_code: trayCode,
    };
    const log = buildTrayAuditLog({
      stagingEvents: [
        { ...base, id: "with-result", inspection_result: "轻微腐蚀，继续实验", time: "2026-08-13 01:00:00" },
        { ...base, id: "without-result", inspection_result: "", time: "2026-08-13 02:00:00" },
      ],
      taskCode,
      trayCode,
    });

    expect(log.events.map((event) => event.label)).toEqual([
      "送至盐雾试验室 · 中途外观结论：轻微腐蚀，继续实验",
      "送至盐雾试验室 · 中途外观结论：未填写",
    ]);
    expect(buildTrayAuditSvg({ events: log.events, taskCode, trayCode })).toContain("中途外观结论：未填写");
    expect(buildTrayAuditCsv({ events: log.events, taskCode, trayCode })).toContain("中途外观结论：轻微腐蚀，继续实验");
  });
});
