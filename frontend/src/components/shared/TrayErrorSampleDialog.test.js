import { mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import { describe, expect, test, vi } from "vitest";

import TrayErrorSampleDialog from "./TrayErrorSampleDialog.vue";

const createModel = (trayStatus, trayDisplayStatus = trayStatus) => ({
  clearFeedback: vi.fn(),
  close: vi.fn(),
  feedbackMessage: ref(""),
  feedbackTone: ref("info"),
  lookupTray: vi.fn(),
  state: reactive({
    open: true,
    scanCode: "",
    loading: false,
    submitting: false,
    tray: {
      trayNo: "TP-POST-STAGING",
      taskNo: "TASK-POST-STAGING",
      taskName: "外观出库撤回",
      sampleCount: 1,
      trayStatus,
      trayDisplayStatus,
      experimentLabels: ["盐雾试验"],
    },
  }),
  withdrawDispatch: vi.fn(),
});

describe("TrayErrorSampleDialog", () => {
  test("shows regular staging status for a tray dispatched to staging", async () => {
    const model = createModel("送至暂存间");

    const wrapper = mount(TrayErrorSampleDialog, {
      props: { model },
      global: {
        stubs: {
          AppFeedback: true,
          AppModal: {
            props: ["open"],
            template: '<div v-if="open" class="modal is-open"><slot /><div class="form-actions"><slot name="footer" /></div></div>',
          },
        },
      },
    });

    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("送至暂存间");
    expect(wrapper.find('[data-testid="tray-error-sample-withdraw"]').exists()).toBe(true);

    await wrapper.get('[data-testid="tray-error-sample-withdraw"]').trigger("click");

    expect(wrapper.get('[data-testid="tray-error-sample-withdraw-modal"]').text()).toContain(
      "撤回后将恢复到本次出库前状态。",
    );
  });

  test("shows target lab for a tray dispatched to a laboratory", () => {
    const model = createModel("送至实验室", "盐雾试验室");

    const wrapper = mount(TrayErrorSampleDialog, {
      props: { model },
      global: {
        stubs: {
          AppFeedback: true,
          AppModal: {
            props: ["open"],
            template: '<div v-if="open" class="modal is-open"><slot /><div class="form-actions"><slot name="footer" /></div></div>',
          },
        },
      },
    });

    expect(wrapper.get('[data-testid="tray-error-sample-result"]').text()).toContain("盐雾试验室");
    expect(wrapper.find('[data-testid="tray-error-sample-withdraw"]').exists()).toBe(true);
  });
});
