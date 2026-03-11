import { ref } from "vue";

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
