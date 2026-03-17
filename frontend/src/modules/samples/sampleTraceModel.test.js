import { describe, expect, test } from "vitest";

import { buildSampleTraceView } from "./sampleTraceModel";

describe("sampleTraceModel", () => {
  test("returns default prompt when task code is empty", () => {
    const view = buildSampleTraceView({
      taskCode: "",
      samples: [],
      schedules: [],
    });

    expect(view.summaryText).toBe("请输入试验序号查询样品全生命周期。");
    expect(view.timelineItems).toEqual([]);
  });

  test("builds sorted timeline items from sample history and schedule events", () => {
    const view = buildSampleTraceView({
      taskCode: "SZH-2026-020",
      samples: [
        {
          code: "SP-001",
          task_code: "SZH-2026-020",
          history: [
            {
              time: "2026-03-16T10:00:00.000Z",
              action: "送至暂存间",
              location: "恒温恒湿间（暂存间）",
              owner: "张三",
              status: "送至暂存间",
              detail: "",
            },
            {
              time: "2026-03-16T08:00:00.000Z",
              action: "样品登记",
              location: "接驳区",
              owner: "张三",
              status: "运输中",
              detail: "",
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: "SZH-2026-020",
          device: "振动一室",
          start_at: "2026-03-17T01:00:00.000Z",
          end_at: "2026-03-17T05:00:00.000Z",
          status: "已排程",
        },
      ],
    });

    expect(view.summaryText).toBe("试验序号 SZH-2026-020：样品 1 个，流转记录 4 条。");
    expect(view.timelineItems).toHaveLength(4);
    expect(view.timelineItems[0].title).toBe("SP-001 · 样品登记");
    expect(view.timelineItems[1].title).toBe("SP-001 · 送至暂存间");
    expect(view.timelineItems[2].title).toBe("SZH-2026-020 · 排程开始");
    expect(view.timelineItems[3].title).toBe("SZH-2026-020 · 排程结束");
  });

  test("renders normalized history text directly from stored sample data", () => {
    const view = buildSampleTraceView({
      taskCode: "SZH-2026-021",
      samples: [
        {
          code: "SP-002",
          task_code: "SZH-2026-021",
          history: [
            {
              time: "2026-03-16T08:00:00.000Z",
              action: "样品编号重排",
              location: "室外接驳区",
              owner: "",
              status: "运输中",
              detail: "任务 SZH-2026-021；样品绑定任务",
            },
          ],
        },
      ],
      schedules: [],
    });

    expect(view.timelineItems[0].title).toBe("SP-002 · 样品编号重排");
    expect(view.timelineItems[0].meta).toContain("室外接驳区");
    expect(view.timelineItems[0].meta).toContain("运输中");
    expect(view.timelineItems[0].meta).toContain("任务 SZH-2026-021");
    expect(view.timelineItems[0].meta).toContain("样品绑定任务");
  });
});
