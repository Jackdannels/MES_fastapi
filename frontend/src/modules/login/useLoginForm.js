// 封装登录表单状态、提交反馈以及登录后的跳转行为。
import { ref } from "vue";

// 将认证输入和提交流程集中到一个可复用的组合函数中。
function useLoginForm({ login, navigate, redirectPath, resolveModuleHome }) {
  const username = ref("");
  const password = ref("");
  const moduleKey = ref("central");
  const errorMessage = ref("");
  const submitting = ref(false);

  const submitLogin = async () => {
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
