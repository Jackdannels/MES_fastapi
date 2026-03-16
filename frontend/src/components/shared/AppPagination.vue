<template>
  <div class="task-list-pagination">
    <button class="page-btn" type="button" data-page="prev" :disabled="currentPage <= 1" @click="emitChange(currentPage - 1)">
      上一页
    </button>
    <button
      v-for="page in pages"
      :key="page"
      class="page-btn"
      type="button"
      :data-page="String(page)"
      :class="{ active: page === currentPage }"
      @click="emitChange(page)"
    >
      {{ page }}
    </button>
    <button
      class="page-btn"
      type="button"
      data-page="next"
      :disabled="currentPage >= pageCount"
      @click="emitChange(currentPage + 1)"
    >
      下一页
    </button>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  currentPage: {
    type: Number,
    default: 1,
  },
  pageCount: {
    type: Number,
    default: 1,
  },
});

const emit = defineEmits(["change"]);

const pages = computed(() => Array.from({ length: Math.max(props.pageCount, 1) }, (_, index) => index + 1));

const emitChange = (page) => {
  const nextPage = Math.min(Math.max(page, 1), Math.max(props.pageCount, 1));
  if (nextPage === props.currentPage) {
    return;
  }
  emit("change", nextPage);
};
</script>
