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
    // 追溯查询只依赖样品和排程两类快照。
    const snapshot = await loadSnapshot();
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
  };

  const runTrace = async () => {
    // 每次查询前先重新加载快照，确保时间线基于最新数据。
    await load();
    activeTaskCode.value = String(form.task_code ?? "").trim();
  };

  const resetTrace = () => {
    // 清空输入和激活任务号即可回到默认提示态。
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
