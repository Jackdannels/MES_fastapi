import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useLaboratoryFixtureConfirmation } from "./useLaboratoryFixtureConfirmation";

const mountConfirmation = () => {
  const fixtureConfirmCountdown = ref(0);
  const fixtureConfirmHostless = ref(false);
  const fixtureConfirmModalOpen = ref(false);
  const fixtureConfirmSuccessModalOpen = ref(false);
  const resumePreparationFixtureReady = ref(false);
  const onConfirmationSettled = vi.fn();
  let confirmation;
  const wrapper = mount(defineComponent({
    setup() {
      confirmation = useLaboratoryFixtureConfirmation({
        fixtureConfirmCountdown,
        fixtureConfirmHostless,
        fixtureConfirmModalOpen,
        fixtureConfirmSuccessModalOpen,
        flushPendingRealtimeRefresh: vi.fn(),
        getCurrentLabHostInterfaceCapabilities: () => ({ fixtureReadyDelayMs: 0, fixtureReadyInterface: "mqtt" }),
        isMqttHostInterfaceMode: () => true,
        laboratoryMqError: ref(null),
        onConfirmationSettled,
        persistFixtureReadyForTask: vi.fn(),
        refreshAuthoritativeState: vi.fn(async () => {}),
        resumePreparationFixtureReady,
        workflow: ref({ fixtureReadyDone: false }),
      });
      return () => null;
    },
  }));
  return {
    confirmation,
    fixtureConfirmModalOpen,
    fixtureConfirmSuccessModalOpen,
    onConfirmationSettled,
    resumePreparationFixtureReady,
    wrapper,
  };
};

describe("useLaboratoryFixtureConfirmation", () => {
  afterEach(() => vi.useRealTimers());

  test("finishes immediately when the resume-preparation fixture ACK becomes authoritative", async () => {
    vi.useFakeTimers();
    const mounted = mountConfirmation();
    mounted.confirmation.startFixtureConfirmCountdown({ taskCode: "TASK-1", trayCodes: ["TP-1"] });
    expect(mounted.fixtureConfirmModalOpen.value).toBe(true);

    mounted.resumePreparationFixtureReady.value = true;
    await nextTick();

    expect(mounted.fixtureConfirmModalOpen.value).toBe(false);
    expect(mounted.fixtureConfirmSuccessModalOpen.value).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(mounted.onConfirmationSettled).toHaveBeenCalledTimes(1);
    mounted.wrapper.unmount();
  });
});
