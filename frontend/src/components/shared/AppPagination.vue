<template>
  <div class="task-list-pagination" :class="{ 'task-list-pagination--numbers-only': !showStepControls }">
    <button
      v-if="showStepControls"
      class="page-btn task-list-pagination__step"
      type="button"
      data-page="prev"
      aria-label="上一页"
      title="上一页"
      :disabled="safeCurrentPage <= 1"
      @click="emitChange(safeCurrentPage - 1)"
    >
      ‹
    </button>

    <span class="task-list-pagination__status" data-testid="pagination-status">
      第 {{ safeCurrentPage }} / {{ safePageCount }} 页
    </span>

    <label class="task-list-pagination__jump">
      <input
        v-model="jumpValue"
        data-testid="pagination-jump-input"
        type="number"
        aria-label="页码"
        min="1"
        :max="safePageCount"
        inputmode="numeric"
        @keydown.enter.prevent="emitJump"
      />
      <span>页</span>
      <button
        class="page-btn task-list-pagination__jump-submit"
        data-testid="pagination-jump-submit"
        type="button"
        @click="emitJump"
      >
        跳转
      </button>
    </label>

    <button
      v-if="showStepControls"
      class="page-btn task-list-pagination__step"
      type="button"
      data-page="next"
      aria-label="下一页"
      title="下一页"
      :disabled="safeCurrentPage >= safePageCount"
      @click="emitChange(safeCurrentPage + 1)"
    >
      ›
    </button>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  currentPage: {
    type: Number,
    default: 1,
  },
  pageCount: {
    type: Number,
    default: 1,
  },
  showStepControls: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(["change"]);

const safePageCount = computed(() => Math.max(Number.parseInt(String(props.pageCount || 1), 10) || 1, 1));
const safeCurrentPage = computed(() => {
  const parsedPage = Number.parseInt(String(props.currentPage || 1), 10);
  const currentPage = Number.isFinite(parsedPage) ? parsedPage : 1;
  return Math.min(Math.max(currentPage, 1), safePageCount.value);
});

const jumpValue = ref(String(safeCurrentPage.value));

watch([safeCurrentPage, safePageCount], () => {
  jumpValue.value = String(safeCurrentPage.value);
});

const normalizePage = (page) => {
  const parsedPage = Number.parseInt(String(page ?? ""), 10);
  const nextPage = Number.isFinite(parsedPage) ? parsedPage : safeCurrentPage.value;
  return Math.min(Math.max(nextPage, 1), safePageCount.value);
};

const emitChange = (page) => {
  const nextPage = normalizePage(page);
  if (nextPage === safeCurrentPage.value) {
    jumpValue.value = String(safeCurrentPage.value);
    return;
  }
  emit("change", nextPage);
};

const emitJump = () => {
  emitChange(jumpValue.value);
};
</script>
