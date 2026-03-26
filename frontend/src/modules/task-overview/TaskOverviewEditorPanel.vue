<template>
  <div class="task-overview-editor" @click.stop @dblclick.stop>
    <div class="task-overview-editor-grid">
      <label class="task-overview-editor-field">
        <span>任务类型</span>
        <select
          :value="editForm.taskType"
          class="search-input"
          @change="updateEditForm('taskType', $event.target.value)"
        >
          <option value="">请选择任务类型</option>
          <option v-for="type in taskTypeEditOptions" :key="type" :value="type">{{ type }}</option>
        </select>
      </label>
      <label class="task-overview-editor-field">
        <span>样品数量</span>
        <input
          :value="editForm.sampleCount"
          class="search-input"
          type="number"
          min="0"
          step="1"
          @input="updateEditForm('sampleCount', $event.target.valueAsNumber)"
        />
      </label>
      <label class="task-overview-editor-field task-overview-editor-field-full">
        <span>样品编号（换行、逗号分隔）</span>
        <textarea
          :value="editForm.sampleCodesText"
          class="search-input task-overview-editor-textarea"
          placeholder="例如：CJ-2026-007-SP-001"
          @input="updateEditForm('sampleCodesText', $event.target.value)"
        ></textarea>
      </label>
    </div>

    <div class="task-overview-editor-experiments">
      <div class="task-overview-editor-experiments-header">
        <span>实验列表</span>
        <button
          class="action-btn secondary"
          type="button"
          title="add-experiment"
          @click="appendExperiment()"
        >
          新增实验
        </button>
      </div>
      <div
        v-for="(experiment, index) in normalizedExperiments"
        :key="experiment.experimentCode || `experiment-${index}`"
        class="task-overview-editor-experiment-row"
      >
        <label class="task-overview-editor-field">
          <span>实验编号</span>
          <div class="search-input">{{ experiment.experimentCode }}</div>
        </label>
        <label class="task-overview-editor-field">
          <span>实验名称</span>
          <input
            :value="experiment.experimentName"
            :title="`experiment-name-${index}`"
            class="search-input"
            type="text"
            @input="updateExperiment(index, { experimentName: $event.target.value })"
          />
        </label>
        <label class="task-overview-editor-field">
          <span>实验类型</span>
          <select
            :value="experiment.requiredDevice"
            :title="`experiment-type-${index}`"
            class="search-input"
            @change="updateExperiment(index, { requiredDevice: $event.target.value })"
          >
            <option value="">请选择实验类型</option>
            <option v-for="type in taskTypeEditOptions" :key="`${experiment.experimentCode}-${type}`" :value="type">
              {{ type }}
            </option>
          </select>
        </label>
        <button
          class="action-btn danger"
          type="button"
          :title="`remove-experiment-${index}`"
          @click="removeExperiment(index)"
        >
          删除实验
        </button>
      </div>
    </div>

    <div v-if="editError" class="form-alert">{{ editError }}</div>
    <div v-if="editMessage" class="task-overview-success">{{ editMessage }}</div>

    <div class="form-actions">
      <button
        class="action-btn"
        type="button"
        title="save-edit"
        :disabled="saving || deleting"
        @click="emit('save-edit', row.taskCode)"
      >
        {{ saving ? "保存中..." : "保存修改" }}
      </button>
      <button
        class="action-btn secondary"
        type="button"
        title="generate-codes"
        @click="emit('generate-codes')"
      >
        按数量自动生成编号
      </button>
      <button
        class="action-btn danger task-overview-delete-btn"
        type="button"
        title="request-delete"
        :disabled="saving || deleting"
        @click="emit('request-delete', row.taskCode)"
      >
        {{ deleting ? "删除中..." : "删除任务" }}
      </button>
      <button class="action-btn secondary" type="button" title="cancel-edit" @click="emit('cancel-edit')">
        取消
      </button>
    </div>
    <div v-if="deleteConfirm.taskCode === row.taskCode" class="task-overview-delete-confirm">
      <div class="task-overview-delete-text">
        确认删除任务 <strong>{{ row.taskCode }}</strong>？
        将同步删除：样品 {{ deleteConfirm.sampleCount }} 条、排程 {{ deleteConfirm.scheduleCount }} 条、数据流
        {{ deleteConfirm.streamCount }} 条。该操作不可恢复。
      </div>
      <div class="form-actions task-overview-delete-actions">
        <button
          class="action-btn danger"
          type="button"
          title="confirm-delete"
          :disabled="deleting || saving"
          @click="emit('confirm-delete', row.taskCode)"
        >
          {{ deleting ? "删除中..." : "确认删除" }}
        </button>
        <button
          class="action-btn secondary"
          type="button"
          title="reset-delete-confirm"
          :disabled="deleting"
          @click="emit('reset-delete-confirm')"
        >
          取消删除
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";

const emit = defineEmits([
  "cancel-edit",
  "confirm-delete",
  "generate-codes",
  "request-delete",
  "reset-delete-confirm",
  "save-edit",
  "update-edit-form",
]);

const props = defineProps({
  deleteConfirm: {
    type: Object,
    default: () => ({}),
  },
  deleting: {
    type: Boolean,
    default: false,
  },
  editError: {
    type: String,
    default: "",
  },
  editForm: {
    type: Object,
    default: () => ({
      experiments: [],
      sampleCodesText: "",
      sampleCount: 0,
      taskType: "",
    }),
  },
  editMessage: {
    type: String,
    default: "",
  },
  row: {
    type: Object,
    required: true,
  },
  saving: {
    type: Boolean,
    default: false,
  },
  taskTypeEditOptions: {
    type: Array,
    default: () => [],
  },
});

const resolveExperimentType = (currentType, occupiedTypes = []) => {
  const normalizedCurrentType = String(currentType || "").trim();
  if (normalizedCurrentType) {
    return normalizedCurrentType;
  }
  const excludedTypes = new Set(
    [props.editForm?.taskType]
      .concat(Array.isArray(occupiedTypes) ? occupiedTypes : [])
      .map((type) => String(type || "").trim())
      .filter(Boolean),
  );
  const nextType = props.taskTypeEditOptions.find((type) => !excludedTypes.has(String(type || "").trim()));
  return nextType || props.taskTypeEditOptions[0] || String(props.editForm?.taskType || "").trim();
};

const normalizeExperiment = (experiment, index, existingExperiments = []) => {
  const taskCode = String(props.row?.taskCode || props.editForm?.taskCode || "").trim();
  const suffix = String.fromCharCode(65 + index);
  return {
    experimentCode: String(experiment?.experimentCode || "").trim() || `${taskCode}-${suffix}`,
    experimentName: String(experiment?.experimentName || `${suffix}实验`).trim() || `${suffix}实验`,
    plannedHours: Number.isFinite(experiment?.plannedHours) ? experiment.plannedHours : 0,
    priority: String(experiment?.priority || "").trim(),
    requiredDevice: resolveExperimentType(
      experiment?.requiredDevice || experiment?.required_device,
      (Array.isArray(existingExperiments) ? existingExperiments : []).map((item) => item?.requiredDevice || item?.required_device),
    ),
  };
};

const normalizedExperiments = computed(() =>
  (Array.isArray(props.editForm?.experiments) ? props.editForm.experiments : []).map((experiment, index, experiments) =>
    normalizeExperiment(experiment, index, experiments.slice(0, index))
  )
);

const normalizeSampleCount = (value) => {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
};

const updateEditForm = (field, value) => {
  if (!field) {
    return;
  }
  emit("update-edit-form", {
    [field]: field === "sampleCount" ? normalizeSampleCount(value) : value,
  });
};

const updateExperiments = (experiments) => {
  emit("update-edit-form", {
    experiments,
  });
};

const updateExperiment = (index, patch) => {
  updateExperiments(
    normalizedExperiments.value.map((experiment, experimentIndex) =>
      experimentIndex === index ? { ...experiment, ...patch } : experiment
    )
  );
};

const appendExperiment = () => {
  const nextIndex = normalizedExperiments.value.length;
  const nextExperiment = normalizeExperiment({}, nextIndex, normalizedExperiments.value);
  updateExperiments(normalizedExperiments.value.concat(nextExperiment));
};

const removeExperiment = (index) => {
  updateExperiments(normalizedExperiments.value.filter((_, experimentIndex) => experimentIndex !== index));
};
</script>
