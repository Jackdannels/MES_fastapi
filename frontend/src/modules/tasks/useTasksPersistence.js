import { readTasks } from "@/lib/tasksApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";

function useTasksPersistence({
  persistSnapshot,
  rawExperimentRunTrays,
  rawExperimentRuns,
  rawExperimentSamples,
  rawExperimentTrays,
  rawExperiments,
  rawExternalTaskIntakes,
  rawSamples,
  rawSchedules,
  rawStreams,
}) {
  const readAllTasks = () => readTasks({ includeArchived: true });

  const buildSnapshotFallback = () => ({
    [STORAGE_KEYS.external_task_intakes]: rawExternalTaskIntakes.value,
    [STORAGE_KEYS.schedules]: rawSchedules.value,
    [STORAGE_KEYS.samples]: rawSamples.value,
    [STORAGE_KEYS.streams]: rawStreams.value,
    [STORAGE_KEYS.experiments]: rawExperiments.value,
    [STORAGE_KEYS.experiment_trays]: rawExperimentTrays.value,
    [STORAGE_KEYS.experiment_samples]: rawExperimentSamples.value,
    [STORAGE_KEYS.experiment_runs]: rawExperimentRuns.value,
    [STORAGE_KEYS.experiment_run_trays]: rawExperimentRunTrays.value,
  });

  const applySnapshotArray = (snapshot, key, target) => {
    if (Array.isArray(snapshot?.[key])) {
      target.value = snapshot[key];
    }
  };

  const persistRelated = async (updates) => {
    // 任务已切到独立 API，当前只把关联集合继续写回快照桥接层。
    await persistSnapshot(updates);
    if (Array.isArray(updates[STORAGE_KEYS.schedules])) {
      rawSchedules.value = updates[STORAGE_KEYS.schedules];
    }
    if (Array.isArray(updates[STORAGE_KEYS.samples])) {
      rawSamples.value = updates[STORAGE_KEYS.samples];
    }
    if (Array.isArray(updates[STORAGE_KEYS.streams])) {
      rawStreams.value = updates[STORAGE_KEYS.streams];
    }
    if (Array.isArray(updates[STORAGE_KEYS.experiment_trays])) {
      rawExperimentTrays.value = updates[STORAGE_KEYS.experiment_trays];
    }
    if (Array.isArray(updates[STORAGE_KEYS.experiment_samples])) {
      rawExperimentSamples.value = updates[STORAGE_KEYS.experiment_samples];
    }
  };

  return {
    applySnapshotArray,
    buildSnapshotFallback,
    persistRelated,
    readAllTasks,
  };
}

export { useTasksPersistence };
