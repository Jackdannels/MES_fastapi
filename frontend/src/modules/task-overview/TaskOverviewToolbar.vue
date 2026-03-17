<template>
  <div class="task-overview-header">
    <div class="task-overview-heading">
      <h3>任务/托盘总览</h3>
      <div class="task-overview-counter" :class="{ 'is-alert': isTrayCounterAlert }">
        <div class="task-overview-counter-label">{{ overviewCounterLabel }}</div>
        <div class="task-overview-counter-value">{{ overviewCounterValue }}</div>
      </div>
    </div>
    <div class="task-overview-actions">
      <div class="tabs task-overview-mode-switch">
        <button class="tab-btn" :class="{ active: viewMode === 'task' }" type="button" @click="emit('update:viewMode', 'task')">
          任务总览
        </button>
        <button class="tab-btn" :class="{ active: viewMode === 'tray' }" type="button" @click="emit('update:viewMode', 'tray')">
          托盘总览
        </button>
      </div>
      <input
        :value="keywordInput"
        class="search-input"
        placeholder="按任务编号、任务类型或样品编号筛选"
        @compositionend="handleCompositionEnd"
        @compositionstart="handleCompositionStart"
        @input="handleInput"
      />
      <select :value="timeFilter" class="search-input" @change="emit('update:timeFilter', $event.target.value)">
        <option value="all">全部时间</option>
        <option value="today">今天</option>
        <option value="last7">近7天</option>
        <option value="last30">近30天</option>
        <option value="thisYear">本年</option>
        <option value="custom">自定义</option>
      </select>
      <div v-if="timeFilter === 'custom'" class="task-overview-custom-range">
        <input
          :value="customStartDate"
          class="search-input"
          type="date"
          @input="emit('update:customStartDate', $event.target.value)"
        />
        <span class="task-overview-range-sep">至</span>
        <input
          :value="customEndDate"
          class="search-input"
          type="date"
          @input="emit('update:customEndDate', $event.target.value)"
        />
      </div>
      <select :value="testTypeFilter" class="search-input" @change="emit('update:testTypeFilter', $event.target.value)">
        <option value="">全部实验类型</option>
        <option v-for="type in testTypeOptions" :key="type" :value="type">{{ type }}</option>
      </select>
      <button class="action-btn secondary" type="button" @click="emit('refresh')">刷新数据</button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from "vue";

const props = defineProps({
  customEndDate: {
    type: String,
    default: "",
  },
  customStartDate: {
    type: String,
    default: "",
  },
  isTrayCounterAlert: {
    type: Boolean,
    default: false,
  },
  keyword: {
    type: String,
    default: "",
  },
  overviewCounterLabel: {
    type: String,
    default: "",
  },
  overviewCounterValue: {
    type: String,
    default: "",
  },
  testTypeFilter: {
    type: String,
    default: "",
  },
  testTypeOptions: {
    type: Array,
    default: () => [],
  },
  timeFilter: {
    type: String,
    default: "all",
  },
  viewMode: {
    type: String,
    default: "task",
  },
});

const emit = defineEmits([
  "refresh",
  "update:customEndDate",
  "update:customStartDate",
  "update:keyword",
  "update:testTypeFilter",
  "update:timeFilter",
  "update:viewMode",
]);

const keywordInput = ref(props.keyword);
const isComposing = ref(false);

watch(
  () => props.keyword,
  (value) => {
    if (!isComposing.value) {
      keywordInput.value = value;
    }
  }
);

const commitKeyword = (value) => {
  emit("update:keyword", String(value || "").trim());
};

const handleCompositionStart = () => {
  isComposing.value = true;
};

const handleCompositionEnd = (event) => {
  isComposing.value = false;
  keywordInput.value = event?.target?.value ?? "";
  commitKeyword(keywordInput.value);
};

const handleInput = (event) => {
  keywordInput.value = event?.target?.value ?? "";
  if (!isComposing.value) {
    commitKeyword(keywordInput.value);
  }
};
</script>
