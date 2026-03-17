import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewSampleCodes from "./TaskOverviewSampleCodes.vue";

describe("TaskOverviewSampleCodes", () => {
  test("renders sample code chips", () => {
    const wrapper = mount(TaskOverviewSampleCodes, {
      props: {
        sampleCodes: ["TASK-001-SP-001", "TASK-001-SP-002"],
      },
    });

    expect(wrapper.text()).toContain("样品编号");
    expect(wrapper.text()).toContain("TASK-001-SP-001");
    expect(wrapper.text()).toContain("TASK-001-SP-002");
    expect(wrapper.findAll(".task-overview-chip")).toHaveLength(2);
  });
});
