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
  "Unknown storage key": "未找到存储项",
  "Unsupported storage read profile": "不支持此数据读取方式",
  "No valid storage keys provided": "未提供有效的存储项",
  "Bad Request": "请求参数不正确",
  "Unauthorized": "请先登录",
  "Conflict": "当前状态不允许此操作",
  "Unprocessable Entity": "请求内容不符合要求",
  "Gateway Timeout": "服务响应超时，请核对操作结果后重试",
  "Bad Gateway": "服务连接异常，请稍后重试",
  "Too Many Requests": "请求过于频繁，请稍后重试",
  "Permission denied": "访问权限不足",
  "Access is denied": "访问被拒绝",
  "No such file or directory": "文件或目录不存在",
  "The system cannot find the file specified": "系统找不到指定文件",
  "The system cannot find the path specified": "系统找不到指定路径",
  "Network is unreachable": "网络不可达",
  "Connection refused": "连接被拒绝",
  "Connection reset by peer": "连接已中断",
  "timed out": "连接超时",
  "TimeoutError": "请求超时",
  "broker offline": "消息服务未连接",
  "AbortError": "请求已中止",
  "Failed to publish laboratory MQ command": "试验间消息发送失败",
  "Failed to load laboratory telemetry": "试验间状态读取失败",
  "Failed to synchronize server time": "服务器时间同步失败",
};

const FIELD_NAMES = {
  adminUsername: "管理员账号", adminPassword: "管理员密码", newPassword: "新密码",
  username: "员工账号", employeeName: "员工姓名", roleName: "角色", password: "密码",
  date: "日期", user_id: "员工编号",
  trayLimit: "托盘样品上限",
};

// Protect values that identify the affected object, rather than English error
// prose. These placeholders contain no Latin letters and are restored verbatim.
function protectErrorIdentifiers(message) {
  const values = [];
  const save = (value) => `\uE000${values.push(value) - 1}\uE001`;
  const protectedMessage = message
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\r\n<>"'，。；]+|https?:\/\/[^\s<>"'，。；]+/g, save)
    .replace(/(['"])[A-Za-z0-9][A-Za-z0-9_.-]*\1/g, save)
    .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b|\b[A-Z0-9]+(?:[-_][A-Z0-9]+)+\b|\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b|\b[A-Z]{2,}\d[A-Za-z0-9.-]*\b/g, save)
    .replace(/((?:账号|用户|设备|任务|托盘|样品|实验|试验间|轴向|文件名|目录名)[：:]?\s*)([A-Za-z][A-Za-z0-9.@-]*)(?=\s*[\u3400-\u9fff，。；,:：）)]|$)/g,
      (_, label, value) => label + save(value));
  return { message: protectedMessage, restore: (value) => value.replace(/\uE000(\d+)\uE001/g, (_, index) => values[Number(index)]) };
}

function removeEnglishErrorProse(value) {
  let message = value
    // Retain the original HTTP number; do not introduce a new UI error code.
    .replace(/Failed to [^:：\r\n\u3400-\u9fff]+:\s*(\d{3})(?:\s+[A-Za-z][A-Za-z -]*)?/gi, "请求失败（$1）")
    .replace(/\b(\d{3})\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Unprocessable Entity|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|Too Many Requests)\b/gi, "请求失败（$1）")
    .replace(/\[(?:WinError|Errno)\s+(\d+)\]/gi, "（系统错误 $1）");
  for (const [field, label] of Object.entries(FIELD_NAMES)) {
    message = message.replaceAll(`body.${field}:`, `${label}：`);
  }
  const protectedValues = protectErrorIdentifiers(message);
  message = protectedValues.message;
  for (const [english, chinese] of Object.entries(RESPONSE_MESSAGES).sort(([a], [b]) => b.length - a.length)) {
    message = message.replaceAll(english, chinese);
  }
  message = message.replace(/Input should be less than or equal to ([\d.]+)/g, "输入值不能大于 $1")
    .replace(/Input should be greater than or equal to ([\d.]+)/g, "输入值不能小于 $1")
    .replace(/Field required/g, "此项必填");
  for (const [field, label] of Object.entries(FIELD_NAMES)) {
    message = message.replaceAll(`body.${field}:`, `${label}：`);
  }
  // Protocol/file-format names in explanatory text use Chinese. Existing
  // symbolic error codes, paths and business identifiers remain protected.
  message = message.replace(/\bMQTT\b/g, "消息接口").replace(/\bLIMS\b/g, "外部业务系统")
    .replace(/\bPDF\b/g, "报告文件").replace(/\bHTTP\b/g, "请求")
    .replace(/\bJSON\b/g, "响应数据").replace(/\bSQL\b/g, "数据库")
    .replace(/\bURL\b/g, "下载地址")
    .replace(/\b(?:Error|Exception|TypeError|SyntaxError)\s*[:：]?\s*/g, "")
    .replace(/[A-Za-z][A-Za-z0-9'’.-]*(?:[ \t]+[A-Za-z][A-Za-z0-9'’.-]*)*/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/([，,；;：:])\s*[，,；;：:]+/g, "$1")
    .replace(/^[\s，,；;：:]+|[\s，,；;：:]+$/g, "");
  return protectedValues.restore(message).trim();
}

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
  const message = String(value || "").trim();
  if (!message) return fallback;
  const localized = removeEnglishErrorProse(message);
  // 保留中文业务说明及其中的账号、设备编号等，不向用户展示纯英文异常栈。
  return /[\u3400-\u9fff]/u.test(localized) ? localized : fallback;
}

export { localizeResponseMessage };
