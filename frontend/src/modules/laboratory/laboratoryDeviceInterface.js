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

  const isMqttHostInterfaceMode = () => readHostInterfaceMode() === HOST_INTERFACE_MODES.mqtt;
  const getCurrentLabHostInterfaceCapabilities = () => getLabHostInterfaceCapabilities({
    hostInterfaceMode: readHostInterfaceMode(),
    labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
    labName: laboratoryConfig.value.labName,
  });
  const isHostlessFixtureLab = () => getCurrentLabHostInterfaceCapabilities().fixtureReadyInterface === "hostless";
  const usesMqttExperimentStart = () => getCurrentLabHostInterfaceCapabilities().experimentStartInterface === "mqtt";
  const usesMqttExperimentEnd = () => getCurrentLabHostInterfaceCapabilities().experimentEndInterface === "mqtt";

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
      const result = await publisher(payload);
      return result ?? true;
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
    ensureHostInterfaceModeSynced,
    getCurrentLabHostInterfaceCapabilities,
    isHostlessFixtureLab,
    isMqttHostInterfaceMode,
    publishLaboratoryMqSafely,
    usesMqttExperimentEnd,
    usesMqttExperimentStart,
  };
}

export { createLaboratoryDeviceInterface };
