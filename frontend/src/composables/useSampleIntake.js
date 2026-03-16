import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import {
  buildSampleIntakeTaskOptions,
  createSampleIntakeForm,
  nextTaskSampleCode,
  submitSampleIntake,
} from "@/lib/sampleIntakeModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const SAMPLES_UPDATED_EVENT = "mes:samples-updated";

function useSampleIntake() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.samples]);

  const rawTasks = ref([]);
  const rawSamples = ref([]);
  const warning = ref("");
  const form = reactive(createSampleIntakeForm());

  const taskOptions = computed(() => buildSampleIntakeTaskOptions(rawTasks.value));

  const syncCode = () => {
    form.code = form.task_code ? nextTaskSampleCode(form.task_code, rawSamples.value) : "";
  };

  const applySnapshot = (snapshot) => {
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
