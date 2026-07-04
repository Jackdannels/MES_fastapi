// 定义人员信息页渲染使用的静态卡片、员工账号行和设置数据。
const SYSTEM_SUMMARY_CARDS = Object.freeze([
  { label: "员工账号", note: "全部试验间可登录", value: 0 },
  { label: "班次", note: "白班/中班/夜班", value: 3 },
  { label: "在线员工", note: "当前试验间登录", value: 0 },
]);

const EMPLOYEE_ROWS = Object.freeze([
  {
    active: true,
    allowedLabs: ["*"],
    currentLabName: "",
    employeeName: "张三",
    hasQrToken: false,
    id: "employee-zhangsan",
    lastLoginAt: "",
    online: false,
    qrTokenCreatedAt: "",
    roleName: "试验员",
    todaySeconds: 0,
    username: "zhangsan",
  },
  {
    active: true,
    allowedLabs: ["*"],
    currentLabName: "",
    employeeName: "李四",
    hasQrToken: false,
    id: "employee-lisi",
    lastLoginAt: "",
    online: false,
    qrTokenCreatedAt: "",
    roleName: "试验组长",
    todaySeconds: 0,
    username: "lisi",
  },
]);

const BASE_SETTINGS = Object.freeze({
  notificationChannel: "站内通知",
  retentionPeriod: "36 个月",
  shiftConfig: "白班 08:00-16:00",
});

const EMPTY_EMPLOYEE_FORM = Object.freeze({
  active: true,
  employeeName: "",
  password: "",
  roleName: "试验员",
  username: "",
});

function formatWorkDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secondsOnly = safeSeconds % 60;
  return `${hours}小时${minutes}分${secondsOnly}秒`;
}

function createEmployeeRow(row = {}) {
  const allowedLabs = Array.isArray(row?.allowedLabs) ? row.allowedLabs : [];
  const currentLabNames = Array.isArray(row?.currentLabNames)
    ? row.currentLabNames.map((labName) => String(labName || "").trim()).filter(Boolean)
    : [];
  const currentLabName = currentLabNames.length > 0 ? currentLabNames.join("、") : String(row?.currentLabName || "").trim();
  return {
    active: row?.active !== false,
    allowedLabs,
    currentLabName,
    currentLabNames,
    employeeName: String(row?.employeeName || "").trim(),
    hasQrToken: Boolean(row?.hasQrToken),
    id: row?.id || row?.username || "",
    lastLoginAt: String(row?.lastLoginAt || "").trim(),
    online: Boolean(row?.online),
    qrTokenCreatedAt: String(row?.qrTokenCreatedAt || "").trim(),
    roleName: String(row?.roleName || "").trim(),
    statusLabel: row?.online ? "在线" : (row?.active === false ? "停用" : "离线"),
    todaySeconds: Number(row?.todaySeconds || 0),
    todayWorkTime: formatWorkDuration(row?.todaySeconds || 0),
    username: String(row?.username || "").trim(),
  };
}

// 将员工数据标准化为新增和编辑操作共用的表单结构。
function createEmployeeForm(employee = EMPTY_EMPLOYEE_FORM) {
  return {
    active: employee?.active !== false,
    employeeName: String(employee?.employeeName || ""),
    password: "",
    roleName: String(employee?.roleName || ""),
    username: String(employee?.username || ""),
  };
}

// 将系统页的静态卡片、员工行和设置打包为统一对象。
function buildSystemPageState() {
  const employeeRows = EMPLOYEE_ROWS.map(createEmployeeRow);
  return {
    employeeRows: employeeRows.map((employee) => ({
      ...employee,
      form: createEmployeeForm(employee),
    })),
    settings: { ...BASE_SETTINGS },
    summaryCards: SYSTEM_SUMMARY_CARDS.map((card) => ({
      ...card,
      value: card.label === "员工账号" ? employeeRows.length : card.label === "在线员工" ? employeeRows.filter((row) => row.online).length : card.value,
    })),
  };
}

export { buildSystemPageState, createEmployeeForm, createEmployeeRow, EMPTY_EMPLOYEE_FORM, formatWorkDuration };
