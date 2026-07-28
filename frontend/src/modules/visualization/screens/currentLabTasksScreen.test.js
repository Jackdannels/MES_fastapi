import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CurrentLabTasksScreen } from "./currentLabTasksScreen";

describe("CurrentLabTasksScreen", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("updates countdown text locally without rebuilding the laboratory task model", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-07-28T14:00:00+08:00"));
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const startTime = Date.now();
    const currentLabTaskView = {
      counts: { running: 1 },
      labs: [{
        countdown: {
          active: true,
          endTime: startTime + 10_000,
          progressPercent: 0,
          remainingLabel: "00:00:10",
          startTime,
        },
        experimentName: "冲击试验",
        labName: "冲击一室",
        planTimeLabel: "14:00-15:00",
        sampleCount: 1,
        shouldBlink: true,
        stageLabel: "实验进行中",
        statusLabel: "实验进行中",
        statusTone: "running",
        taskCode: "TASK-LIVE-CLOCK",
        trayItems: [],
        traySummaryLabel: "托盘 0，样品 1",
      }],
    };

    const wrapper = mount(CurrentLabTasksScreen, { props: { currentLabTaskView } });
    expect(wrapper.get('[data-testid="lab-matrix-countdown"]').text()).toContain("00:00:10");

    await vi.advanceTimersByTimeAsync(1000);
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="lab-matrix-countdown"]').text()).toContain("00:00:09");
    expect(wrapper.props("currentLabTaskView")).toStrictEqual(currentLabTaskView);
    wrapper.unmount();
  });
});
