import { ref } from "vue";

import { logoutSession, resolveModuleHome, switchSessionModule } from "@/auth";

function useTransferWorkbenchExit(router) {
  const exitDialogOpen = ref(false);

  const handleLogout = () => {
    exitDialogOpen.value = true;
  };

  const closeExitDialog = () => {
    exitDialogOpen.value = false;
  };

  const confirmLogout = async () => {
    closeExitDialog();
    await logoutSession();
    router.replace("/login");
  };

  const switchModule = async (targetModule) => {
    closeExitDialog();
    const module = typeof targetModule === "string" ? targetModule : targetModule?.module;
    const labName = typeof targetModule === "object" && targetModule !== null ? targetModule.labName : "";
    const result = await switchSessionModule(module);
    if (!result.ok) {
      return;
    }
    if (module === "laboratory" && labName) {
      await router.push({ path: "/laboratory", query: { lab: labName } });
      return;
    }
    await router.push(resolveModuleHome(module));
  };

  return {
    closeExitDialog,
    confirmLogout,
    exitDialogOpen,
    handleLogout,
    switchModule,
  };
}

export { useTransferWorkbenchExit };
