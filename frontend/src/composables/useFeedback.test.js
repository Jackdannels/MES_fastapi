import { describe, expect, test, vi } from "vitest";

import { useFeedback } from "./useFeedback";

describe("useFeedback", () => {
  test("shows feedback and clears it after the default 10 seconds", () => {
    vi.useFakeTimers();
    const feedback = useFeedback();

    feedback.show("任务已确认入库", "success");

    expect(feedback.message.value).toBe("任务已确认入库");
    expect(feedback.tone.value).toBe("success");

    vi.advanceTimersByTime(9999);
    expect(feedback.message.value).toBe("任务已确认入库");

    vi.advanceTimersByTime(1);
    expect(feedback.message.value).toBe("");

    vi.useRealTimers();
  });

  test("does not let an old timer clear a newer feedback message", () => {
    vi.useFakeTimers();
    const feedback = useFeedback();

    feedback.show("第一条提示", "info");
    vi.advanceTimersByTime(5000);
    feedback.show("第二条提示", "warning");
    vi.advanceTimersByTime(5000);

    expect(feedback.message.value).toBe("第二条提示");

    vi.advanceTimersByTime(5000);
    expect(feedback.message.value).toBe("");

    vi.useRealTimers();
  });
});
