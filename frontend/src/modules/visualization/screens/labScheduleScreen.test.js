import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import { LabScheduleScreen } from "./labScheduleScreen";

const LAB_NAMES = [
  "冲击一室",
  "冲击二室",
  "振动一室",
  "振动二室",
  "四综合实验室",
  "温度冲击一室",
  "温度冲击二室",
  "高低温湿热一室",
  "高低温湿热二室",
  "盐雾试验室",
  "霉菌试验室",
];

const buildIdleSlot = (labName, index) => ({
  key: `${labName}-${index}`,
  state: "idle",
});

describe("LabScheduleScreen", () => {
  test("renders every laboratory in the expanded schedule including the mold laboratory after the first ten rows", () => {
    const wrapper = mount(LabScheduleScreen, {
      props: {
        scheduleView: {
          periodCounts: [],
          rows: LAB_NAMES.map((device) => ({
            device,
            slots: Array.from({ length: 6 }, (_, index) => buildIdleSlot(device, index)),
          })),
          summary: {},
        },
      },
    });

    const renderedLabNames = wrapper.findAll(".visual-schedule-lab-name").map((row) => row.text());
    expect(renderedLabNames).toEqual(LAB_NAMES);
    expect(renderedLabNames).toContain("霉菌试验室");
  });
});
