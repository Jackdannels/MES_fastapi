import { onBeforeUnmount, onMounted } from "vue";

import { serverNowDate } from "@/lib/serverClock";

function useDeviceClock({ loadDevicesPage, now, syncTimedMaintenanceStatuses }) {
  let deviceClockTimer = null;
  const syncDeviceClock = () => {
    const currentDate = serverNowDate();
    now.value = currentDate;
    void syncTimedMaintenanceStatuses(currentDate);
  };

  onMounted(() => {
    syncDeviceClock();
    deviceClockTimer = window.setInterval(syncDeviceClock, 1000);
    loadDevicesPage();
  });

  onBeforeUnmount(() => {
    if (deviceClockTimer) {
      window.clearInterval(deviceClockTimer);
      deviceClockTimer = null;
    }
  });
}

export { useDeviceClock };
