import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { PROCESS_LABS, buildProcessLabCards, buildTaskOverviewPath } from "@/lib/processLabModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

import { useStorageSnapshot } from "./useStorageSnapshot";

function useProcessLabs(options = {}) {
  const labs = Array.isArray(options.labs) ? options.labs : PROCESS_LABS;
  const storage = options.storage || useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.schedules]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;
  const autoLoad = options.autoLoad !== false;
  const now = options.now;
  const navigate =
    options.navigate ||
    ((path) => {
      const router = options.router || useRouter();
      return router.push(path);
    });

  const loading = ref(false);
  const labCards = ref([]);

  const loadLabStatus = async () => {
    loading.value = true;
    try {
      const snapshot = await loadSnapshot();
      labCards.value = buildProcessLabCards(labs, snapshot[STORAGE_KEYS.tasks], snapshot[STORAGE_KEYS.schedules], now);
    } finally {
      loading.value = false;
    }
  };

  const runningCount = computed(() => labCards.value.filter((lab) => lab.status === "实验中").length);
  const scheduledCount = computed(() => labCards.value.filter((lab) => lab.status === "已排期").length);
  const idleCount = computed(() => labCards.value.filter((lab) => lab.status === "空闲").length);

  const openTaskOverview = (lab) => navigate(buildTaskOverviewPath(lab));

  if (autoLoad) {
    onMounted(loadLabStatus);
  }

  return {
    idleCount,
    labCards,
    loadLabStatus,
    loading,
    openTaskOverview,
    runningCount,
    scheduledCount,
  };
}

export { useProcessLabs };
