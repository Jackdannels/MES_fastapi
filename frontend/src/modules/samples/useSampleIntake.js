// 封装样品收样表单，以及新样品记录的持久化流程。
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import {
  buildSampleIntakeTaskOptions,
  createSampleIntakeForm,
  nextTaskSampleCode,
  submitSampleIntake,
} from "./sampleIntakeModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const SAMPLES_UPDATED_EVENT = "mes:samples-updated";

// 负责生成绑定任务的样品编号，并将收样结果写回存储。
function useSampleIntake() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.samples]);

  const rawTasks = ref([]);
  const rawSamples = ref([]);
  const warning = ref("");
  const form = reactive(createSampleIntakeForm());

  const taskOptions = computed(() => buildSampleIntakeTaskOptions(rawTasks.value));

  const syncCode = () => {
    // 任务切换后自动刷新推荐样品号，避免手工维护编号。
    form.code = form.task_code ? nextTaskSampleCode(form.task_code, rawSamples.value) : "";
  };

  const applySnapshot = (snapshot) => {
    // 每次重新加载快照后，都重新派生任务选项和推荐编号。
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    syncCode();
  };

  const load = async () => {
    const snapshot = await loadSnapshot();
    applySnapshot(snapshot);
  };

  const resetForm = () => {
    Object.assign(form, createSampleIntakeForm());
  };

  const setTaskCode = (value) => {
    form.task_code = String(value ?? "").trim();
    syncCode();
  };

  const save = async (mode = "submit") => {
    const result = submitSampleIntake({
      form,
      mode,
      tasks: rawTasks.value,
      samples: rawSamples.value,
      now: new Date().toISOString(),
    });
    if (result.error) {
      warning.value = result.error;
      return;
    }

    // 收样成功后广播全局事件，让其他样品页面自行刷新。
    rawTasks.value = result.tasks;
    rawSamples.value = result.samples;
    await persistSnapshot({
      [STORAGE_KEYS.tasks]: result.tasks,
      [STORAGE_KEYS.samples]: result.samples,
    });
    resetForm();
    warning.value = "";
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
  };

  const handleSamplesUpdated = () => {
    // 其他页面更新样品后，当前收样页也需要同步最新编号和任务状态。
    void load();
  };

  onMounted(() => {
    void load();
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  onBeforeUnmount(() => {
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  return {
    form,
    taskOptions,
    warning,
    saveDraft: () => save("draft"),
    submit: () => save("submit"),
    setTaskCode,
  };
}

export { SAMPLES_UPDATED_EVENT, useSampleIntake };
