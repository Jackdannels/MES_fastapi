import { reactive } from "vue";
import { localizeResponseMessage } from "./responseMessages";

// 当前页面内保留凭据并自动填入；不把密码写入任务数据或浏览器持久存储。
const taskAdminAuthState = reactive({
  open: false,
  action: "",
  adminUsername: "admin",
  adminPassword: "123",
  submitting: false,
  error: "",
});

let pendingAction = null;

class TaskAdminCancelledError extends Error {
  constructor() {
    super("");
    this.name = "TaskAdminCancelledError";
  }
}

function requestTaskAdminAction(action, execute) {
  if (pendingAction) return Promise.reject(new Error("请先完成或取消当前管理员认证"));
  taskAdminAuthState.action = action;
  taskAdminAuthState.error = "";
  taskAdminAuthState.open = true;
  return new Promise((resolve, reject) => {
    pendingAction = { execute, resolve, reject };
  });
}

function cancelTaskAdminAction() {
  if (taskAdminAuthState.submitting) return;
  const pending = pendingAction;
  pendingAction = null;
  taskAdminAuthState.open = false;
  taskAdminAuthState.error = "";
  pending?.reject(new TaskAdminCancelledError());
}

async function confirmTaskAdminAction() {
  if (!pendingAction || taskAdminAuthState.submitting) return;
  const adminUsername = taskAdminAuthState.adminUsername.trim();
  const adminPassword = taskAdminAuthState.adminPassword;
  if (!adminUsername || !adminPassword.trim()) {
    taskAdminAuthState.error = "请输入管理员账号和密码";
    return;
  }
  const pending = pendingAction;
  taskAdminAuthState.submitting = true;
  taskAdminAuthState.error = "";
  try {
    // 接口先校验管理员，再执行本次操作；401 时保留待执行操作以便重试。
    const result = await pending.execute({ adminUsername, adminPassword });
    pendingAction = null;
    taskAdminAuthState.open = false;
    pending.resolve(result);
  } catch (error) {
    if (error?.status === 401) {
      taskAdminAuthState.error = localizeResponseMessage(error.message);
    } else {
      pendingAction = null;
      taskAdminAuthState.open = false;
      pending.reject(error);
    }
  } finally {
    taskAdminAuthState.submitting = false;
  }
}

export { taskAdminAuthState, requestTaskAdminAction, confirmTaskAdminAction, cancelTaskAdminAction };
