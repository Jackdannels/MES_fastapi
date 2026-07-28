import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TodayTaskPlanScreen } from "./taskPlanScreen";

const buildView = () => ({
  date: "2026-07-28",
  summary: { assigned: 2, experiments: 2, samples: 12 },
  tasks: [
    {
      taskCode: "SYLU-2026-07-034",
      experiments: [{
        experimentCode: "EXP-034",
        experimentType: "冲击试验",
        lab: "冲击一室",
        sampleCount: 6,
        time: "14:31-18:01",
        trays: ["TP-001", "TP-002", "TP-003", "TP-004", "TP-005", "TP-006"],
      }],
    },
    {
      taskCode: "SYLU-2026-07-032",
      experiments: [{
        experimentCode: "EXP-032",
        experimentType: "振动试验",
        lab: "振动二室",
        sampleCount: 6,
        time: "14:43-18:13",
        trays: ["TP-101", "TP-102"],
      }],
    },
  ],
});

describe("TodayTaskPlanScreen", () => {
  const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
    } else {
      delete HTMLElement.prototype.scrollHeight;
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    } else {
      delete HTMLElement.prototype.clientHeight;
    }
  });

  test("shows every tray in its task row and loops the task rows only when the table overflows", async () => {
    let rowListHeight = 320;
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        if (!this.classList?.contains("visual-task-plan-row-list")) {
          return 0;
        }
        return rowListHeight;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.classList?.contains("visual-task-plan-row-viewport") ? 150 : 0;
      },
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });

    const wrapper = mount(TodayTaskPlanScreen, {
      props: { compact: false, todayTaskPlanView: buildView() },
    });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const rows = wrapper.findAll(".visual-task-plan-row-cycle:first-child .visual-task-plan-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes("style")).not.toBe(rows[1].attributes("style"));

    const rowViewport = wrapper.get(".visual-task-plan-row-viewport");
    expect(rowViewport.classes()).toContain("is-scrollable");
    expect(wrapper.text()).toContain("任务循环播放");
    expect(rowViewport.get(".visual-task-plan-row-list").classes()).toContain("is-looping");
    expect(wrapper.findAll('[data-testid="visual-task-plan-tray-chip"]')).toHaveLength(8);
    expect(wrapper.find(".visual-task-plan-tray-list.is-looping").exists()).toBe(false);

    wrapper.unmount();

    rowListHeight = 120;
    const fittingWrapper = mount(TodayTaskPlanScreen, {
      props: { compact: false, todayTaskPlanView: buildView() },
    });
    await fittingWrapper.vm.$nextTick();
    await fittingWrapper.vm.$nextTick();

    expect(fittingWrapper.get(".visual-task-plan-row-viewport").classes()).not.toContain("is-scrollable");
    expect(fittingWrapper.text()).not.toContain("任务循环播放");
    expect(fittingWrapper.findAll('[data-testid="visual-task-plan-tray-chip"]')).toHaveLength(8);
    fittingWrapper.unmount();
  });
});
