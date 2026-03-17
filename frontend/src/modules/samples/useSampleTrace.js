// 封装按任务号查询样品追溯信息及时间线展示的逻辑。
import { computed, reactive, ref } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { buildSampleTraceView } from "./sampleTraceModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

// 加载当前快照，并为单个任务号构建追溯结果。
function useSampleTrace() {
  const { loadSnapshot } = useStorageSnapshot([STORAGE_KEYS.samples, STORAGE_KEYS.schedules]);

  const rawSamples = ref([]);
  const rawSchedules = ref([]);
  const form = reactive({
    task_code: "",
  });
  const activeTaskCode = ref("");

  const view = computed(() =>
    buildSampleTraceView({
      taskCode: activeTaskCode.value,
      samples: rawSamples.value,
      schedules: rawSchedules.value,
    }),
  );

  const load = async () => {
    const snapshot = await loadSnapshot();
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
  };

  const runTrace = async () => {
    await load();
    activeTaskCode.value = String(form.task_code ?? "").trim();
  };

  const resetTrace = () => {
    form.task_code = "";
    activeTaskCode.value = "";
  };

  return {
    form,
    resetTrace,
    runTrace,
    summaryText: computed(() => view.value.summaryText),
    timelineItems: computed(() => view.value.timelineItems),
  };
}

export { useSampleTrace };
