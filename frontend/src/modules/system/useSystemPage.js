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
    createRoleFields.value = createRoleForm(EMPTY_ROLE_FORM);
    createRoleDialog.openWith({ id: "new-role" });
  };

  const closeRoleModal = () => {
    createRoleDialog.close();
  };

  const openRoleDrawer = (role) => {
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
    toggleSort,
    visibleRoleRows: visibleRows,
  };
}

export { useSystemPage };
