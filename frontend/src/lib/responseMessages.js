// 统一响应提示的中文展示；不改动接口状态码或业务数据。
const RESPONSE_MESSAGES = {
  "Invalid administrator credentials": "管理员账号或密码错误",
  "New password is required": "请输入新密码",
  "Username is required": "请输入员工账号",
  "Employee username already exists": "员工账号已存在",
  "Employee account not found": "员工账号不存在",
  "Employee QR code not generated": "尚未生成员工二维码",
  "Invalid employee credentials": "员工账号或密码错误",
  "Invalid employee QR code": "员工二维码无效，请重新生成或扫码",
  "Laboratory employee login is required": "请先登录试验间员工账号",
  "Invalid date": "日期格式无效，请重新选择日期",
  "Invalid credentials": "账号或密码错误",
  "Not authenticated": "请先登录",
  "Invalid session": "登录状态无效，请重新登录",
  "Session expired": "登录已过期，请重新登录",
  "Demo auth is not configured": "登录服务尚未配置，请联系管理员",
  "Auth session secret is not configured": "登录服务尚未配置，请联系管理员",
  "Invalid module": "所选模块无效",
  "Invalid laboratory": "所选试验间无效",
  "Terminal binding changed": "终端绑定已变更，请重新登录",
  "Fixed terminal cannot switch module": "固定终端不能切换模块",
  "Invalid terminal ticket": "终端凭据无效，请重新登录",
  "Terminal ticket expired": "终端凭据已过期，请重新登录",
  "Failed to fetch": "网络连接失败，请检查网络后重试",
  "Network Error": "网络连接失败，请检查网络后重试",
  "Load failed": "加载失败，请检查网络后重试",
  "Internal Server Error": "服务器暂时无法处理请求，请稍后重试",
  "Service Unavailable": "服务暂不可用，请稍后重试",
  "Not Found": "请求的资源不存在",
  "Forbidden": "没有执行此操作的权限",
  "Tray not found": "未找到托盘",
};

const FIELD_NAMES = {
  adminUsername: "管理员账号", adminPassword: "管理员密码", newPassword: "新密码",
  username: "员工账号", employeeName: "员工姓名", roleName: "角色", password: "密码",
  date: "日期", user_id: "员工编号",
  trayLimit: "托盘样品上限",
};

function localizeResponseMessage(value, fallback = "操作未完成，请稍后重试") {
  if (Array.isArray(value)) {
    return value.map((error) => {
      const field = FIELD_NAMES[error?.loc?.at(-1)] || "请求参数";
      return error?.type === "missing" ? `请填写${field}` : `${field}格式不正确，请检查后重试`;
    }).join("；") || fallback;
  }
  if (value && typeof value === "object") {
    return localizeResponseMessage(value.detail || value.message, fallback);
  }
  let message = String(value || "").trim();
  if (!message) return fallback;
  for (const [english, chinese] of Object.entries(RESPONSE_MESSAGES)) {
    message = message.replaceAll(english, chinese);
  }
  message = message.replace(/Input should be less than or equal to ([\d.]+)/g, "输入值不能大于 $1")
    .replace(/Input should be greater than or equal to ([\d.]+)/g, "输入值不能小于 $1")
    .replace(/Field required/g, "此项必填");
  for (const [field, label] of Object.entries(FIELD_NAMES)) {
    message = message.replaceAll(`body.${field}:`, `${label}：`);
  }
  // 保留中文业务说明及其中的账号、设备编号等，不向用户展示纯英文异常栈。
  return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
}

export { localizeResponseMessage };
