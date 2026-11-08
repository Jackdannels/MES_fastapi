// 封装登录表单状态、提交反馈以及登录后的跳转行为。
import { ref } from "vue";
import { syncHostInterfaceMode } from "@/lib/hostInterfaceModeApi";
import { HOST_INTERFACE_MODES } from "@/lib/hostInterfaceMode";
import { LABORATORY_OPTIONS, MODULE_LABELS } from "@/lib/moduleCatalog";
import { resolveLaboratoryRouteKey } from "@/lib/labs";
import { getDesktopHome, getDesktopLaboratory, getDesktopModule } from "@/lib/desktopClient";

// 将认证输入和提交流程集中到一个可复用的组合函数中。
function useLoginForm({ login, navigate, redirectPath, resolveModuleHome }) {
  const username = ref("admin");
  const password = ref("123");
  const fixedModule = getDesktopModule();
  const fixedLaboratory = getDesktopLaboratory();
  const fixedModuleLabel = fixedLaboratory || MODULE_LABELS[fixedModule] || "";
  const moduleKey = ref(fixedModule || "central");
  const selectedLabName = ref(fixedLaboratory || LABORATORY_OPTIONS[0]?.key || "");
  const errorMessage = ref("");
  const submitting = ref(false);

  const syncSelectedInterfaceMode = async () => {
    try {
      await syncHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
      return true;
    } catch (error) {
      errorMessage.value = error?.message || "MQTT接口同步失败";
      return false;
    }
  };

  const submitLogin = async () => {
    // 防重复提交，避免连续点击触发多次认证请求。
    if (submitting.value) {
      return;
    }

    errorMessage.value = "";
    submitting.value = true;
    try {
      const result = await login(username.value, password.value, fixedModule || moduleKey.value);
      if (!result.ok) {
        errorMessage.value = result.message || "登录失败";
        return;
      }
      const interfaceModeSynced = await syncSelectedInterfaceMode();
      if (!interfaceModeSynced) {
        return;
      }

      // 明确 redirectPath 时优先使用，否则按模块类型回到对应首页。
      const target = fixedModule ? getDesktopHome() : redirectPath || (result.module === "laboratory" && selectedLabName.value
        ? { path: resolveModuleHome(result.module), query: { lab: resolveLaboratoryRouteKey(selectedLabName.value) } }
        : resolveModuleHome(result.module));
      navigate(target);
    } finally {
      submitting.value = false;
    }
  };

  return {
    errorMessage,
    fixedModule,
    fixedLaboratory,
    fixedModuleLabel,
    moduleKey,
    password,
    selectedLabName,
    submitLogin,
    submitting,
    username,
  };
}

export { useLoginForm };
