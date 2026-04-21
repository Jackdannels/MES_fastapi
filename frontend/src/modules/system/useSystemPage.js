// 负责系统页的角色管理界面状态，并暴露静态页面模型。
import { computed, ref } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useTableControls } from "@/composables/useTableControls";
import { buildSystemPageState, createRoleForm, EMPTY_ROLE_FORM } from "./model";

// 将系统配置页的抽屉、弹窗和表格控制集中管理。
function useSystemPage() {
  const systemState = buildSystemPageState();
  const roleRows = ref(systemState.roleRows);
  const summaryCards = ref(systemState.summaryCards);
  const settings = ref(systemState.settings);

  const createRoleDialog = useDialogState();
  const editRoleDrawer = useDialogState();

  const { query, sortDirection, sortKey, visibleRows } = useTableControls({
    pageSize: 20,
    rows: roleRows,
    searchFields: ["name", "scope", "keyPermissions"],
  });

  const createRoleFields = ref(createRoleForm(EMPTY_ROLE_FORM));

  // 编辑抽屉始终从当前 payload 重新派生表单，避免残留上一次编辑状态。
  const editRoleFields = computed(() => createRoleForm(editRoleDrawer.payload.value?.form || EMPTY_ROLE_FORM));

  const toggleSort = (nextKey) => {
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = "asc";
  };

  const openRoleModal = () => {
    // 每次打开新增弹窗都重置为空白角色表单。
    createRoleFields.value = createRoleForm(EMPTY_ROLE_FORM);
    createRoleDialog.openWith({ id: "new-role" });
  };

  const closeRoleModal = () => {
    createRoleDialog.close();
  };

  const openRoleDrawer = (role) => {
    // 抽屉直接持有选中角色，字段展示通过 editRoleFields 再做一层标准化。
    editRoleDrawer.openWith(role);
  };

  const closeRoleDrawer = () => {
    editRoleDrawer.close();
  };

  return {
    closeRoleDrawer,
    closeRoleModal,
    createRoleFields,
    editRoleFields,
    openRoleDrawer,
    openRoleModal,
    query,
    roleDrawerOpen: editRoleDrawer.open,
    roleModalOpen: createRoleDialog.open,
    settings,
    summaryCards,
    sortDirection,
    sortKey,
    toggleSort,
    visibleRoleRows: visibleRows,
  };
}

export { useSystemPage };
