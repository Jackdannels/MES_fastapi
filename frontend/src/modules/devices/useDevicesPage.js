// 负责设备台账状态、维护表单和点位管理流程。
import { computed, onMounted, ref, watch } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useTableControls } from "@/composables/useTableControls";
import {
  appendDevice,
  appendPoint,
  buildDeviceForm,
  buildDeviceMetrics,
  buildDeviceRows,
  buildLocationOptions,
  buildSelectedDevice,
  buildTestTypeOptions,
  buildVisiblePointRows,
  createConnectionForm,
  createDeviceForm,
  createMaintenanceForm,
  createPointForm,
  createPointRows,
  syncDeviceTypeWithLocation,
  upsertDevice,
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

// 将设备存储记录转换为页面所需的表格、表单、抽屉和弹窗状态。
function useDevicesPage() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([STORAGE_KEYS.devices, STORAGE_KEYS.schedules]);
  const rawDevices = ref([]);
  const rawSchedules = ref([]);
  const deviceForm = ref(createDeviceForm());
  const selectedDevice = ref(buildSelectedDevice());
  const maintenanceForm = ref(createMaintenanceForm());
  const pointForm = ref(createPointForm());
  const connectionForm = ref(createConnectionForm());
  const pointRows = ref(createPointRows());
  const pointQuery = ref("");
  const deviceDrawer = useDialogState();
  const pointModal = useDialogState();

  const baseRows = computed(() => buildDeviceRows(rawDevices.value, rawSchedules.value));
  const metrics = computed(() => buildDeviceMetrics(baseRows.value));
  const locationOptions = computed(() => buildLocationOptions(rawDevices.value));
  const testTypeOptions = computed(() => buildTestTypeOptions(rawDevices.value));
  const visiblePointRows = computed(() => buildVisiblePointRows(pointRows.value, pointQuery.value));

  const { query, sortDirection, sortKey, visibleRows } = useTableControls({
    rows: baseRows,
    searchFields: ["code", "name", "type", "status", "location"],
    pageSize: 100,
  });

  const toggleSort = (nextKey) => {
    // 设备表格采用单列排序，重复点击同一列时切换方向。
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = "asc";
  };

  const syncFormTypeWithLocation = () => {
    // 设备位置一旦能命中实验室映射，就自动带出推荐试验类型。
    const mappedType = syncDeviceTypeWithLocation(deviceForm.value.location, deviceForm.value.type);
    if (mappedType) {
      deviceForm.value.type = mappedType;
    }
  };

  const persistDevices = async (nextDevices) => {
    // 先更新本地响应式数据，再把最新快照落盘。
    rawDevices.value = nextDevices;
    await persistSnapshot({
      [STORAGE_KEYS.devices]: nextDevices,
    });
  };

  const saveCurrentDevice = async () => {
    const nextDevices = upsertDevice(rawDevices.value, deviceForm.value);
    await persistDevices(nextDevices);
  };

  const createNewDevice = async () => {
    const nextDevices = appendDevice(rawDevices.value, deviceForm.value);
    await persistDevices(nextDevices);
  };

  const openDeviceDrawer = (row) => {
    // 抽屉标题和维护表单都以当前选中设备为准同步刷新。
    const nextSelected = buildSelectedDevice(row ?? deviceForm.value);
    selectedDevice.value = nextSelected;
    maintenanceForm.value = createMaintenanceForm(row ?? deviceForm.value);
    deviceDrawer.openWith(nextSelected);
  };

  const closeDeviceDrawer = () => {
    deviceDrawer.close();
  };

  const openPointModal = () => {
    pointModal.openWith({ id: "point-modal" });
  };

  const closePointModal = () => {
    pointModal.close();
  };

  const savePoint = () => {
    const nextPoints = appendPoint(pointRows.value, pointForm.value);
    // 长度未变化说明表单缺少关键字段，本次新增直接忽略。
    if (nextPoints.length === pointRows.value.length) {
      return;
    }
    pointRows.value = nextPoints;
    pointForm.value = createPointForm();
    closePointModal();
  };

  const loadDevicesPage = async () => {
    const snapshot = await loadSnapshot();
    rawDevices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
  };

  watch(
    () => deviceForm.value.location,
    () => {
      // 位置变化时持续保持试验类型的自动联动。
      syncFormTypeWithLocation();
    },
  );

  onMounted(loadDevicesPage);

  return {
    closeDeviceDrawer,
    closePointModal,
    connectionForm,
    createNewDevice,
    deviceDrawerOpen: deviceDrawer.open,
    deviceForm,
    deviceRows: visibleRows,
    locationOptions,
    maintenanceForm,
    metrics,
    openDeviceDrawer,
    openPointModal,
    pointForm,
    pointModalOpen: pointModal.open,
    pointQuery,
    pointRows: visiblePointRows,
    query,
    saveCurrentDevice,
    savePoint,
    selectedDevice,
    sortDirection,
    sortKey,
    testTypeOptions,
    toggleSort,
  };
}

export { useDevicesPage };
