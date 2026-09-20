import { onBeforeUnmount, onMounted, ref } from "vue";
import { useStorageSnapshotRefresh } from "./useStorageSnapshotRefresh";
import { readResourceInventory, RESOURCE_INVENTORY_KEY } from "@/lib/resourceInventoryApi";

export function useResourceInventory() {
  const inventory = ref(null), error = ref(""), loading = ref(false);
  let generation = 0, stopped = false, timer;
  const acceptInventory = (value) => {
    generation += 1; inventory.value = value; error.value = ""; loading.value = false;
  };
  const refresh = async () => {
    const current = ++generation;
    loading.value = true;
    try {
      const result = await readResourceInventory();
      if (!stopped && current === generation) { inventory.value = result; error.value = ""; }
    } catch (reason) {
      if (!stopped && current === generation) error.value = reason.message || "资源余量读取失败";
    } finally {
      if (!stopped && current === generation) loading.value = false;
    }
  };
  useStorageSnapshotRefresh({ keys: [RESOURCE_INVENTORY_KEY, "mes.experiment_runs", "mes.experiment_run_trays", "mes.samples"], refresh });
  onMounted(() => {
    refresh();
    timer = window.setInterval(() => { if (!document.hidden && !loading.value) refresh(); }, 30000);
  });
  onBeforeUnmount(() => { stopped = true; generation += 1; window.clearInterval(timer); });
  return { inventory, error, loading, refresh, acceptInventory };
}
