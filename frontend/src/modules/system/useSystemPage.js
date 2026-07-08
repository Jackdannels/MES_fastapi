// 负责系统页的员工账号管理界面状态，并暴露页面模型。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useTableControls } from "@/composables/useTableControls";
import {
  createAttendanceUser,
  deleteAttendanceUser,
  listAttendanceWorkTimes,
  readAttendanceUserQrToken,
  resetAttendanceUserQrToken,
  resetAttendanceUserPassword,
} from "@/lib/attendanceApi";
import { buildQrCodeSvg, buildSvgImageDataUrl } from "@/lib/qrCode";
import { buildSystemPageState, createEmployeeForm, createEmployeeRow, EMPTY_EMPLOYEE_FORM } from "./model";

const EMPLOYEE_ROLE_OPTIONS = Object.freeze(["试验员", "试验组长"]);
const WORK_TIME_REFRESH_INTERVAL_MS = 30 * 1000;
const WORK_TIME_TICK_INTERVAL_MS = 1000;

const resolveLiveTodaySeconds = (employee, nowMs) => {
  const baseSeconds = Number(employee?.todaySeconds || 0);
  const activeCount = Number(employee?.activeWorkIntervalCount || 0);
  if (!activeCount) {
    return baseSeconds;
  }
  const calculatedAtMs = Date.parse(String(employee?.calculatedAt || ""));
  if (!Number.isFinite(calculatedAtMs)) {
    return baseSeconds;
  }
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - calculatedAtMs) / 1000));
  return baseSeconds + elapsedSeconds * activeCount;
};

// 将系统配置页的员工账号抽屉、弹窗和表格控制集中管理。
function useSystemPage() {
  const systemState = buildSystemPageState();
  const employeeRows = ref(systemState.employeeRows);
  const summaryCards = ref(systemState.summaryCards);
  const settings = ref(systemState.settings);
  const workTimeTickMs = ref(Date.now());
  let workTimeTickTimer = null;
  let workTimeRefreshTimer = null;

  const createEmployeeDialog = useDialogState();
  const editEmployeeDialog = useDialogState();
  const qrEmployeeDialog = useDialogState();

  const { query, sortDirection, sortKey, visibleRows } = useTableControls({
    pageSize: 20,
    rows: employeeRows,
    searchFields: ["employeeName", "username", "roleName", "statusLabel"],
  });
  const workTimeRows = computed(() =>
    employeeRows.value.map((employee) => ({
      ...employee,
      todayWorkTime: createEmployeeRow({
        ...employee,
        todaySeconds: resolveLiveTodaySeconds(employee, workTimeTickMs.value),
      }).todayWorkTime,
    })),
  );

  const createEmployeeFields = ref(createEmployeeForm(EMPTY_EMPLOYEE_FORM));
  const createEmployeeError = ref("");
  const adminActionFields = ref({
    adminPassword: "",
    adminUsername: "",
    newPassword: "",
  });
  const adminActionError = ref("");
  const adminActionSubmitting = ref(false);
  const adminActionSuccess = ref("");
  const qrPayload = ref("");
  const qrSvg = ref("");
  const qrError = ref("");
  const qrSubmitting = ref(false);

  // 编辑弹窗始终从当前 payload 重新派生表单，避免残留上一次编辑状态。
  const editEmployeeFields = computed(() => createEmployeeForm(editEmployeeDialog.payload.value?.form || EMPTY_EMPLOYEE_FORM));

  const refreshSummaryCards = () => {
    summaryCards.value = [
      { label: "员工账号", note: "全部试验间可登录", value: employeeRows.value.length },
      { label: "班次", note: "白班/中班/夜班", value: 3 },
      { label: "在线员工", note: "当前试验间登录", value: employeeRows.value.filter((row) => row.online).length },
    ];
  };

  const loadEmployees = async () => {
    try {
      const rows = await listAttendanceWorkTimes();
      if (Array.isArray(rows) && rows.length) {
        employeeRows.value = rows.map((row) => {
          const employee = createEmployeeRow(row);
          return {
            ...employee,
            form: createEmployeeForm(employee),
          };
        });
      }
    } finally {
      refreshSummaryCards();
    }
  };

  const toggleSort = (nextKey) => {
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = "asc";
  };

  const openEmployeeModal = () => {
    // 每次打开新增弹窗都重置为空白员工表单。
    createEmployeeFields.value = createEmployeeForm(EMPTY_EMPLOYEE_FORM);
    createEmployeeError.value = "";
    createEmployeeDialog.openWith({ id: "new-employee" });
  };

  const closeEmployeeModal = () => {
    createEmployeeError.value = "";
    createEmployeeDialog.close();
  };

  const formatCreateEmployeeError = (error) => {
    const message = String(error?.message || error || "").trim();
    if (message.includes("already exists") || message.includes("已存在")) {
      return "账号已存在，无法保存";
    }
    return message || "新增人员失败，无法保存";
  };

  const saveNewEmployee = async () => {
    const form = createEmployeeFields.value;
    createEmployeeError.value = "";
    let createdEmployee;
    try {
      createdEmployee = await createAttendanceUser({
        active: true,
        employeeName: form.employeeName,
        password: form.password,
        roleName: form.roleName || EMPLOYEE_ROLE_OPTIONS[0],
        username: form.username,
      });
    } catch (error) {
      createEmployeeError.value = formatCreateEmployeeError(error);
      return;
    }
    const employee = createEmployeeRow(createdEmployee);
    employeeRows.value = [
      ...employeeRows.value,
      {
        ...employee,
        form: createEmployeeForm(employee),
      },
    ];
    refreshSummaryCards();
    closeEmployeeModal();
    void loadEmployees();
  };

  const openEmployeeDrawer = (employee) => {
    // 保持对外方法名不变，内部改为居中弹窗，避免表格调用侧改动过大。
    adminActionFields.value = {
      adminPassword: "",
      adminUsername: "",
      newPassword: "",
    };
    adminActionError.value = "";
    adminActionSuccess.value = "";
    editEmployeeDialog.openWith(employee);
  };

  const closeEmployeeDrawer = () => {
    adminActionError.value = "";
    adminActionSuccess.value = "";
    editEmployeeDialog.close();
  };

  const resetEmployeePassword = async () => {
    const employee = editEmployeeDialog.payload.value;
    if (!employee?.id || adminActionSubmitting.value) {
      return;
    }
    adminActionError.value = "";
    adminActionSuccess.value = "";
    adminActionSubmitting.value = true;
    try {
      await resetAttendanceUserPassword(employee.id, adminActionFields.value);
      adminActionFields.value = {
        ...adminActionFields.value,
        newPassword: "",
      };
      adminActionSuccess.value = "密码已重置";
    } catch (error) {
      adminActionError.value = String(error?.message || error || "重置密码失败");
    } finally {
      adminActionSubmitting.value = false;
    }
  };

  const deleteEmployee = async () => {
    const employee = editEmployeeDialog.payload.value;
    if (!employee?.id || adminActionSubmitting.value) {
      return;
    }
    adminActionError.value = "";
    adminActionSuccess.value = "";
    adminActionSubmitting.value = true;
    try {
      await deleteAttendanceUser(employee.id, adminActionFields.value);
      employeeRows.value = employeeRows.value.filter((row) => row.id !== employee.id);
      refreshSummaryCards();
      closeEmployeeDrawer();
    } catch (error) {
      adminActionError.value = String(error?.message || error || "删除账号失败");
    } finally {
      adminActionSubmitting.value = false;
    }
  };

  const renderQrPayload = async (payload) => {
    qrPayload.value = String(payload || "").trim();
    qrSvg.value = await buildQrCodeSvg(qrPayload.value);
  };

  const openEmployeeQrModal = async (employee) => {
    qrPayload.value = "";
    qrSvg.value = "";
    qrError.value = "";
    qrEmployeeDialog.openWith(employee);
    if (!employee?.id || !employee?.hasQrToken) {
      return;
    }
    qrSubmitting.value = true;
    try {
      const result = await readAttendanceUserQrToken(employee.id);
      await renderQrPayload(result?.qrPayload);
      if (result?.user) {
        updateEmployeeRow(result.user);
      }
    } catch (error) {
      qrError.value = String(error?.message || error || "读取员工二维码失败");
    } finally {
      qrSubmitting.value = false;
    }
  };

  const closeEmployeeQrModal = () => {
    qrError.value = "";
    qrEmployeeDialog.close();
  };

  const updateEmployeeRow = (nextUser) => {
    const nextEmployee = createEmployeeRow(nextUser);
    employeeRows.value = employeeRows.value.map((row) => {
      if (String(row.id) !== String(nextEmployee.id)) {
        return row;
      }
      const mergedEmployee = createEmployeeRow({
        ...row,
        ...nextUser,
      });
      return {
        ...row,
        ...mergedEmployee,
        form: createEmployeeForm(mergedEmployee),
      };
    });
    if (qrEmployeeDialog.payload.value && String(qrEmployeeDialog.payload.value.id) === String(nextEmployee.id)) {
      const mergedEmployee = createEmployeeRow({
        ...qrEmployeeDialog.payload.value,
        ...nextUser,
      });
      qrEmployeeDialog.payload.value = {
        ...qrEmployeeDialog.payload.value,
        ...mergedEmployee,
        form: createEmployeeForm(mergedEmployee),
      };
    }
    refreshSummaryCards();
  };

  const resetEmployeeQrToken = async () => {
    const employee = qrEmployeeDialog.payload.value;
    if (!employee?.id || qrSubmitting.value) {
      return;
    }
    qrSubmitting.value = true;
    qrError.value = "";
    try {
      const result = await resetAttendanceUserQrToken(employee.id);
      await renderQrPayload(result?.qrPayload);
      if (result?.user) {
        updateEmployeeRow(result.user);
      }
    } catch (error) {
      qrError.value = String(error?.message || error || "生成员工二维码失败");
    } finally {
      qrSubmitting.value = false;
    }
  };

  const downloadEmployeeQrCode = async () => {
    if (!qrPayload.value) {
      return;
    }
    try {
      const href = buildSvgImageDataUrl(qrSvg.value || (await buildQrCodeSvg(qrPayload.value)));
      if (!href) {
        return;
      }
      const employee = qrEmployeeDialog.payload.value || {};
      const fileBaseName = String(employee.username || employee.employeeName || "employee")
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "-") || "employee";
      const link = document.createElement("a");
      link.href = href;
      link.download = `${fileBaseName}-qr-code.svg`;
      link.click();
    } catch (error) {
      qrError.value = String(error?.message || error || "下载员工二维码失败");
    }
  };

  onMounted(() => {
    void loadEmployees();
    workTimeTickTimer = window.setInterval(() => {
      workTimeTickMs.value = Date.now();
    }, WORK_TIME_TICK_INTERVAL_MS);
    workTimeRefreshTimer = window.setInterval(() => {
      void loadEmployees();
    }, WORK_TIME_REFRESH_INTERVAL_MS);
  });

  onBeforeUnmount(() => {
    if (workTimeTickTimer) {
      window.clearInterval(workTimeTickTimer);
      workTimeTickTimer = null;
    }
    if (workTimeRefreshTimer) {
      window.clearInterval(workTimeRefreshTimer);
      workTimeRefreshTimer = null;
    }
  });

  return {
    adminActionError,
    adminActionFields,
    adminActionSubmitting,
    adminActionSuccess,
    closeEmployeeDrawer,
    closeEmployeeModal,
    closeEmployeeQrModal,
    createEmployeeError,
    createEmployeeFields,
    editEmployeeFields,
    employeeRoleOptions: EMPLOYEE_ROLE_OPTIONS,
    deleteEmployee,
    downloadEmployeeQrCode,
    employeeDrawerOpen: editEmployeeDialog.open,
    employeeModalOpen: createEmployeeDialog.open,
    employeeQrModalOpen: qrEmployeeDialog.open,
    openEmployeeQrModal,
    openEmployeeDrawer,
    openEmployeeModal,
    query,
    qrEmployee: qrEmployeeDialog.payload,
    qrError,
    qrPayload,
    qrSubmitting,
    qrSvg,
    resetEmployeeQrToken,
    resetEmployeePassword,
    settings,
    saveNewEmployee,
    summaryCards,
    sortDirection,
    sortKey,
    toggleSort,
    visibleEmployeeRows: visibleRows,
    workTimeRows,
  };
}

export { useSystemPage };
