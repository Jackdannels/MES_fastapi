import { onBeforeUnmount, watch } from "vue";

import { formatErrorMessage } from "./pageHelpers";

const FIXTURE_CONFIRM_COUNTDOWN_SECONDS = 10;
const FIXTURE_CONFIRM_SUCCESS_MS = 1000;

function useLaboratoryFixtureConfirmation({
  fixtureConfirmCountdown,
  fixtureConfirmHostless,
  fixtureConfirmModalOpen,
  fixtureConfirmSuccessModalOpen,
  flushPendingRealtimeRefresh,
  getCurrentLabHostInterfaceCapabilities,
  isMqttHostInterfaceMode,
  laboratoryMqError,
  persistFixtureReadyForTask,
  refreshAuthoritativeState,
  workflow,
}) {
  let fixtureConfirmTimer = null;
  let fixtureConfirmSuccessTimer = null;
  let hostlessFixtureReadyTimer = null;

  const clearFixtureConfirmTimer = () => {
    if (fixtureConfirmTimer && typeof window !== "undefined") {
      window.clearInterval(fixtureConfirmTimer);
      fixtureConfirmTimer = null;
    }
  };

  const clearFixtureConfirmSuccessTimer = () => {
    if (fixtureConfirmSuccessTimer && typeof window !== "undefined") {
      window.clearTimeout(fixtureConfirmSuccessTimer);
      fixtureConfirmSuccessTimer = null;
    }
  };

  const clearHostlessFixtureReadyTimer = () => {
    if (hostlessFixtureReadyTimer && typeof window !== "undefined") {
      window.clearTimeout(hostlessFixtureReadyTimer);
      hostlessFixtureReadyTimer = null;
    }
  };

  const openFixtureConfirmSuccess = () => {
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    fixtureConfirmModalOpen.value = false;
    fixtureConfirmSuccessModalOpen.value = true;
    if (typeof window === "undefined") {
      return;
    }
    fixtureConfirmSuccessTimer = window.setTimeout(() => {
      fixtureConfirmSuccessModalOpen.value = false;
      fixtureConfirmSuccessTimer = null;
      flushPendingRealtimeRefresh();
    }, FIXTURE_CONFIRM_SUCCESS_MS);
  };

  const startFixtureConfirmCountdown = ({ taskCode, trayCodes }) => {
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    fixtureConfirmHostless.value = false;
    fixtureConfirmSuccessModalOpen.value = false;
    fixtureConfirmCountdown.value = FIXTURE_CONFIRM_COUNTDOWN_SECONDS;
    fixtureConfirmModalOpen.value = true;
    if (typeof window === "undefined") {
      return;
    }
    fixtureConfirmTimer = window.setInterval(() => {
      fixtureConfirmCountdown.value = Math.max(0, fixtureConfirmCountdown.value - 1);
      if (fixtureConfirmCountdown.value > 0) {
        return;
      }
      clearFixtureConfirmTimer();
      if (isMqttHostInterfaceMode()) {
        fixtureConfirmModalOpen.value = false;
        void Promise.resolve(refreshAuthoritativeState())
          .then(() => {
            if (workflow.value.fixtureReadyDone) {
              openFixtureConfirmSuccess();
              return;
            }
            flushPendingRealtimeRefresh();
          })
          .catch(() => {
            flushPendingRealtimeRefresh();
          });
        return;
      }
      openFixtureConfirmSuccess();
      void persistFixtureReadyForTask({ taskCode, trayCodes });
    }, 1000);
  };

  const openFixtureConfirmPending = () => {
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    fixtureConfirmHostless.value = false;
    fixtureConfirmSuccessModalOpen.value = false;
    fixtureConfirmCountdown.value = FIXTURE_CONFIRM_COUNTDOWN_SECONDS;
    fixtureConfirmModalOpen.value = true;
  };

  const scheduleHostlessFixtureReady = ({ taskCode, trayCodes }) => {
    const capabilities = getCurrentLabHostInterfaceCapabilities();
    clearHostlessFixtureReadyTimer();
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    if (capabilities.fixtureReadyInterface !== "hostless") {
      return;
    }
    const confirmFixtureReady = () => {
      hostlessFixtureReadyTimer = null;
      clearFixtureConfirmTimer();
      void persistFixtureReadyForTask({ taskCode, trayCodes })
        .then(() => {
          openFixtureConfirmSuccess();
        })
        .catch((error) => {
          laboratoryMqError.value = {
            detail: formatErrorMessage(error),
            title: "夹具安装确认失败",
          };
        });
    };
    if (typeof window === "undefined" || capabilities.fixtureReadyDelayMs <= 0) {
      confirmFixtureReady();
      return;
    }
    fixtureConfirmHostless.value = true;
    fixtureConfirmSuccessModalOpen.value = false;
    fixtureConfirmCountdown.value = Math.ceil(capabilities.fixtureReadyDelayMs / 1000);
    fixtureConfirmModalOpen.value = true;
    fixtureConfirmTimer = window.setInterval(() => {
      fixtureConfirmCountdown.value = Math.max(0, fixtureConfirmCountdown.value - 1);
      if (fixtureConfirmCountdown.value <= 0) {
        clearFixtureConfirmTimer();
      }
    }, 1000);
    hostlessFixtureReadyTimer = window.setTimeout(confirmFixtureReady, capabilities.fixtureReadyDelayMs);
  };

  watch(
    () => workflow.value.fixtureReadyDone,
    (fixtureReadyDone) => {
      if (fixtureReadyDone && fixtureConfirmModalOpen.value && isMqttHostInterfaceMode()) {
        openFixtureConfirmSuccess();
      }
    },
  );

  onBeforeUnmount(() => {
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    clearHostlessFixtureReadyTimer();
  });

  return {
    clearFixtureConfirmSuccessTimer,
    clearFixtureConfirmTimer,
    clearHostlessFixtureReadyTimer,
    openFixtureConfirmPending,
    scheduleHostlessFixtureReady,
    startFixtureConfirmCountdown,
  };
}

export { useLaboratoryFixtureConfirmation };
