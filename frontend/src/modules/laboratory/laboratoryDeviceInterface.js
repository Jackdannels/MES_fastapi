import { HOST_INTERFACE_MODES, readHostInterfaceMode } from "@/lib/hostInterfaceMode";
import { syncHostInterfaceMode } from "@/lib/hostInterfaceModeApi";
import { getLabHostInterfaceCapabilities } from "@/lib/labHostInterfaceCapabilities";
import { formatErrorMessage } from "./pageHelpers";

function createLaboratoryDeviceInterface({
  confirmedModalOpen,
  fixtureConfirmModalOpen,
  laboratoryConfig,
  laboratoryMqError,
  onFixturePublishFailure,
  readyPublishRetryAvailable,
}) {
  let hostInterfaceModeSync = null;
  let hostlessStartTimer = null;

  const isMqttHostInterfaceMode = () => readHostInterfaceMode() === HOST_INTERFACE_MODES.mqtt;
  const getCurrentLabHostInterfaceCapabilities = () => getLabHostInterfaceCapabilities({
    hostInterfaceMode: readHostInterfaceMode(),
    labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
    labName: laboratoryConfig.value.labName,
  });
  const isHostlessMqttLab = () => getCurrentLabHostInterfaceCapabilities().hostless;

  const clearHostlessStartTimer = () => {
    if (hostlessStartTimer && typeof window !== "undefined") {
      window.clearTimeout(hostlessStartTimer);
      hostlessStartTimer = null;
    }
  };

  const scheduleHostlessStart = (startExperiment) => {
    const capabilities = getCurrentLabHostInterfaceCapabilities();
    clearHostlessStartTimer();
    if (!capabilities.hostless) {
      return false;
    }
    const invokeStart = () => {
      hostlessStartTimer = null;
      startExperiment();
    };
    if (typeof window === "undefined" || capabilities.startDelayMs <= 0) {
      invokeStart();
      return true;
    }
    hostlessStartTimer = window.setTimeout(invokeStart, capabilities.startDelayMs);
    return true;
  };

  const ensureHostInterfaceModeSynced = async () => {
    if (!isMqttHostInterfaceMode()) {
      return;
    }
    hostInterfaceModeSync = hostInterfaceModeSync || syncHostInterfaceMode(HOST_INTERFACE_MODES.mqtt).finally(() => {
      hostInterfaceModeSync = null;
    });
    await hostInterfaceModeSync;
  };

  const clearLaboratoryMqError = () => {
    laboratoryMqError.value = null;
  };

  const publishLaboratoryMqSafely = async (publisher, payload, actionLabel) => {
    if (!isMqttHostInterfaceMode()) {
      return false;
    }
    try {
      clearLaboratoryMqError();
      if (actionLabel === "准备就绪") {
        readyPublishRetryAvailable.value = false;
      }
      await ensureHostInterfaceModeSynced();
      await publisher(payload);
      return true;
    } catch (error) {
      laboratoryMqError.value = {
        detail: formatErrorMessage(error),
        title: `${actionLabel}下发失败`,
      };
      if (actionLabel === "夹具安装") {
        onFixturePublishFailure();
        fixtureConfirmModalOpen.value = false;
      }
      if (actionLabel === "准备就绪") {
        confirmedModalOpen.value = false;
        readyPublishRetryAvailable.value = true;
      }
      return false;
    }
  };

  return {
    clearLaboratoryMqError,
    clearHostlessStartTimer,
    ensureHostInterfaceModeSynced,
    getCurrentLabHostInterfaceCapabilities,
    isHostlessMqttLab,
    isMqttHostInterfaceMode,
    publishLaboratoryMqSafely,
    scheduleHostlessStart,
  };
}

export { createLaboratoryDeviceInterface };
