<template>
  <div class="task-overview-header">
    <div class="task-overview-topline">
      <div class="task-overview-module-cards">
        <button
          class="task-overview-module-card"
          :class="{ active: viewMode === 'task' }"
          type="button"
          @click="emit('update:viewMode', 'task')"
        >
          <span>
            <strong>任务总览</strong>
            <small>任务进度、排程状态</small>
          </span>
        </button>
        <button
          class="task-overview-module-card"
          :class="{ active: viewMode === 'tray' }"
          type="button"
          @click="emit('update:viewMode', 'tray')"
        >
          <span>
            <strong>托盘总览</strong>
            <small>托盘占用、目标实验室</small>
          </span>
        </button>
      </div>
    </div>

    <div class="task-overview-schedule-strip">
      <div
        v-if="viewMode === 'task'"
        class="task-overview-schedule-card is-blue-tint"
      >
        <span>全部任务</span>
        <strong>{{ totalTaskCount }}</strong>
      </div>
      <button
        class="task-overview-schedule-card task-overview-schedule-card--interactive is-blue-tint"
        :class="{
          'is-scheduled': taskScheduleFilter === 'scheduled',
          'is-unscheduled': taskScheduleFilter === 'unscheduled',
          'is-alert': viewMode === 'tray' && isTrayCounterAlert,
        }"
        data-testid="task-overview-schedule-cycle"
        type="button"
        @click="viewMode === 'task' ? emit('cycle-task-schedule-filter') : null"
      >
        <span>{{ viewMode === 'task' ? taskScheduleCounterLabel : overviewCounterLabel }}</span>
        <strong>{{ viewMode === 'task' ? taskScheduleCounterValue : overviewCounterValue }}</strong>
      </button>
      <div v-if="viewMode === 'task' && experimentCounterLabel" class="task-overview-schedule-card is-blue-tint">
        <span>{{ experimentCounterLabel }}</span>
        <strong>{{ experimentCounterValue }}</strong>
      </div>
    </div>

    <div class="task-overview-actions">
      <input
        :value="keywordInput"
        class="search-input task-overview-search-input"
        placeholder="按任务编号、试验内容或样品编号筛选"
        @compositionend="handleCompositionEnd"
        @compositionstart="handleCompositionStart"
        @input="handleInput"
      />
      <select
        :value="timeFilter"
        aria-label="按任务新建或外部受理确认时间筛选"
        class="search-input"
        title="内部任务按新建时间，外部任务按确认受理时间"
        @change="emit('update:timeFilter', $event.target.value)"
      >
        <option value="all">全部时间</option>
        <option value="today">今天</option>
        <option value="last7">近7天</option>
        <option value="last30">近30天</option>
        <option value="thisYear">本年</option>
        <option value="custom">自定义</option>
      </select>
      <div v-if="timeFilter === 'custom'" class="task-overview-custom-range">
        <PickerOnlyInput
          :model-value="customStartDate"
          class="search-input"
          :max="customEndDate || undefined"
          type="date"
          @update:model-value="emit('update:customStartDate', $event)"
        />
        <span class="task-overview-range-sep">至</span>
        <PickerOnlyInput
          :model-value="customEndDate"
          class="search-input"
          :min="customStartDate || undefined"
          type="date"
          @update:model-value="emit('update:customEndDate', $event)"
        />
      </div>
      <select :value="testTypeFilter" class="search-input" @change="emit('update:testTypeFilter', $event.target.value)">
        <option value="">全部实验类型</option>
        <option v-for="type in testTypeOptions" :key="type" :value="type">{{ type }}</option>
      </select>
      <select
        v-if="viewMode === 'tray'"
        :value="trayTaskFilter"
        class="search-input"
        data-testid="task-overview-tray-task-filter"
        @change="emit('update:trayTaskFilter', $event.target.value)"
      >
        <option value="">全部任务</option>
        <option v-for="taskCode in trayTaskOptions" :key="taskCode" :value="taskCode">{{ taskCode }}</option>
      </select>
      <button class="action-btn secondary" type="button" @click="emit('refresh')">刷新数据</button>
      <div v-if="viewMode === 'task'" class="task-overview-toolbar-pagination">
        <AppPagination :current-page="currentTaskPage" :page-count="taskPageCount" @change="emit('change-task-page', $event)" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import AppPagination from "@/components/shared/AppPagination.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";

const props = defineProps({
  customEndDate: {
    type: String,
    default: "",
  },
  customStartDate: {
    type: String,
    default: "",
  },
  currentTaskPage: {
    type: Number,
    default: 1,
  },
  experimentCounterLabel: {
    type: String,
    default: "",
  },
  experimentCounterValue: {
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
  taskScheduleCounterLabel: {
    type: String,
    default: "已排程/总任务数",
  },
  taskScheduleCounterValue: {
    type: String,
    default: "",
  },
  taskScheduleFilter: {
    type: String,
    default: "all",
  },
  trayTaskFilter: {
    type: String,
    default: "",
  },
  trayTaskOptions: {
    type: Array,
    default: () => [],
  },
  taskPageCount: {
    type: Number,
    default: 1,
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
  "change-task-page",
  "cycle-task-schedule-filter",
  "refresh",
  "update:customEndDate",
  "update:customStartDate",
  "update:keyword",
  "update:testTypeFilter",
  "update:timeFilter",
  "update:trayTaskFilter",
  "update:viewMode",
]);

const keywordInput = ref(props.keyword);
const isComposing = ref(false);

const totalTaskCount = computed(() => {
  const segments = String(props.overviewCounterValue || "").split("/");
  return segments[1] || props.overviewCounterValue || "0";
});

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
