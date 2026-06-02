// 封装登录表单状态、提交反馈以及登录后的跳转行为。
import { ref } from "vue";
import { syncHostInterfaceMode } from "@/lib/hostInterfaceModeApi";
import { readHostInterfaceMode, writeHostInterfaceMode } from "@/lib/hostInterfaceMode";
import { LABORATORY_OPTIONS } from "@/lib/moduleCatalog";

// 将认证输入和提交流程集中到一个可复用的组合函数中。
function useLoginForm({ login, navigate, redirectPath, resolveModuleHome }) {
  const username = ref("admin");
  const password = ref("123");
  const moduleKey = ref("central");
  const selectedLabName = ref(LABORATORY_OPTIONS[0]?.key || "");
  const interfaceMode = ref(readHostInterfaceMode());
  const errorMessage = ref("");
  const submitting = ref(false);

  const setInterfaceMode = async (mode) => {
    interfaceMode.value = writeHostInterfaceMode(mode);
    errorMessage.value = "";
    return syncSelectedInterfaceMode();
  };

  const syncSelectedInterfaceMode = async () => {
    try {
      await syncHostInterfaceMode(interfaceMode.value);
      return true;
    } catch (error) {
      errorMessage.value = error?.message || "接口模式切换失败";
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
      const result = await login(username.value, password.value, moduleKey.value);
      if (!result.ok) {
        errorMessage.value = result.message || "登录失败";
        return;
      }
      const interfaceModeSynced = await syncSelectedInterfaceMode();
      if (!interfaceModeSynced) {
        return;
      }

      // 明确 redirectPath 时优先使用，否则按模块类型回到对应首页。
      const target = redirectPath || (result.module === "laboratory" && selectedLabName.value
        ? { path: resolveModuleHome(result.module), query: { lab: selectedLabName.value } }
        : resolveModuleHome(result.module));
      navigate(target);
    } finally {
      submitting.value = false;
    }
  };

  return {
    errorMessage,
    interfaceMode,
    moduleKey,
    password,
    selectedLabName,
    setInterfaceMode,
    submitLogin,
    submitting,
    username,
  };
}

export { useLoginForm };
