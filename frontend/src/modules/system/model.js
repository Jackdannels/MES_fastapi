// 定义系统页渲染使用的静态卡片、角色行和设置数据。
const SYSTEM_SUMMARY_CARDS = Object.freeze([
  { label: "用户", note: "本周活跃", value: 42 },
  { label: "班次", note: "白班/中班/夜班", value: 3 },
  { label: "角色权限", note: "核心角色", value: 6 },
]);

const ROLE_ROWS = Object.freeze([
  {
    id: "role-scheduler",
    keyPermissions: "创建、改排",
    name: "排程员",
    scope: "任务 + 排程",
  },
  {
    id: "role-supervisor",
    keyPermissions: "审批、数据锁定",
    name: "试验主管",
    scope: "过程 + 数据",
  },
  {
    id: "role-device-engineer",
    keyPermissions: "校准、维护",
    name: "设备工程师",
    scope: "设备",
  },
]);

const BASE_SETTINGS = Object.freeze({
  notificationChannel: "站内通知",
  retentionPeriod: "36 个月",
  shiftConfig: "白班 08:00-16:00",
});

const EMPTY_ROLE_FORM = Object.freeze({
  keyPermissions: "",
  name: "",
  scope: "",
});

// 将角色数据标准化为新增和编辑操作共用的表单结构。
function createRoleForm(role = EMPTY_ROLE_FORM) {
  return {
    // 角色表单不直接复用原始对象，避免编辑态误改静态数据。
    keyPermissions: String(role?.keyPermissions || ""),
    name: String(role?.name || ""),
    scope: String(role?.scope || ""),
  };
}

// 将系统页的静态卡片、角色行和设置打包为统一对象。
function buildSystemPageState() {
  return {
    roleRows: ROLE_ROWS.map((role) => ({
      ...role,
      // 每一行都预先挂载对应表单快照，便于页面直接进入编辑态。
      form: createRoleForm(role),
    })),
    settings: { ...BASE_SETTINGS },
    summaryCards: SYSTEM_SUMMARY_CARDS.map((card) => ({ ...card })),
  };
}

export { buildSystemPageState, createRoleForm, EMPTY_ROLE_FORM };
