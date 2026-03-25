// 封装登录表单状态、提交反馈以及登录后的跳转行为。
import { ref } from "vue";

// 将认证输入和提交流程集中到一个可复用的组合函数中。
function useLoginForm({ login, navigate, redirectPath, resolveModuleHome }) {
  const username = ref("admin");
  const password = ref("123");
  const moduleKey = ref("central");
  const errorMessage = ref("");
  const submitting = ref(false);

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

      // 明确 redirectPath 时优先使用，否则按模块类型回到对应首页。
      const target = redirectPath || resolveModuleHome(result.module);
      navigate(target);
    } finally {
      submitting.value = false;
    }
  };

  return {
    errorMessage,
    moduleKey,
    password,
    submitLogin,
    submitting,
    username,
  };
}

export { useLoginForm };
