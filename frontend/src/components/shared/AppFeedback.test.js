import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";

import AppFeedback from "./AppFeedback.vue";

describe("AppFeedback", () => {
  test("uses the full row while keeping the feedback container vertically compact", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/shared/AppFeedback.vue"), "utf8");
    const rule = source.match(/\.app-feedback\s*\{[^}]*\}/)?.[0] || "";

    expect(rule).toContain("justify-self: stretch;");
    expect(rule).toContain("width: 100%;");
    expect(rule).toContain("box-sizing: border-box;");
    expect(rule).toContain("align-self: start;");
    expect(rule).toContain("min-height: 0;");
    expect(rule).toContain("padding: 8px 10px;");
  });

  test("renders tone-specific feedback and emits close when clicked", async () => {
    const wrapper = mount(AppFeedback, {
      props: {
        message: "任务已确认入库",
        tone: "success",
      },
    });

    expect(wrapper.text()).toContain("任务已确认入库");
    expect(wrapper.classes()).toContain("app-feedback--success");

    await wrapper.trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
    expect(wrapper.find(".app-feedback").exists()).toBe(false);
  });

  test("renders nothing without a message", () => {
    const wrapper = mount(AppFeedback, {
      props: {
        message: "",
      },
    });

    expect(wrapper.find(".app-feedback").exists()).toBe(false);
  });

  test("removes English transport errors from the visible warning without assigning new codes", () => {
    const message = "过期排程清理未完成，Failed to write storage schedule patch: 409 Conflict，删除后将自动撤回至发货点，请确认：SYLUN-2026-10-001-TP-001";
    const wrapper = mount(AppFeedback, { props: { message, tone: "warning", autoDismissMs: 0 } });
    expect(wrapper.text()).toContain("请求失败（409）");
    expect(wrapper.text()).toContain("SYLUN-2026-10-001-TP-001");
    expect(wrapper.text()).toContain("删除后将自动撤回至发货点");
    expect(wrapper.text()).not.toMatch(/Failed|Conflict|错误编号/);
    expect(wrapper.props("message")).toBe(message);
    wrapper.unmount();
  });

  test("hides itself after the default 10 seconds", async () => {
    vi.useFakeTimers();
    const wrapper = mount(AppFeedback, {
      props: {
        message: "托盘分配已保存",
        tone: "success",
      },
    });

    expect(wrapper.find(".app-feedback").exists()).toBe(true);

    vi.advanceTimersByTime(10000);
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".app-feedback").exists()).toBe(false);
    vi.useRealTimers();
  });
});
