<template>
  <div class="task-list-pagination" :class="{ 'task-list-pagination--numbers-only': !showStepControls }">
    <button
      v-if="showStepControls"
      class="page-btn"
      type="button"
      data-page="prev"
      :disabled="currentPage <= 1"
      @click="emitChange(currentPage - 1)"
    >
      上一页
    </button>
    <div class="task-list-pagination__pages">
      <template v-for="item in pageItems" :key="item.key">
        <button
          v-if="item.type === 'page'"
          class="page-btn"
          type="button"
          :data-page="String(item.value)"
          :class="{ active: item.value === currentPage }"
          @click="emitChange(item.value)"
        >
          {{ item.value }}
        </button>
        <span v-else class="page-ellipsis" data-page="ellipsis">...</span>
      </template>
    </div>
    <button
      v-if="showStepControls"
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
  showStepControls: {
    type: Boolean,
    default: true,
  },
});

const { showStepControls } = props;

const emit = defineEmits(["change"]);

const buildPageItem = (page) => ({
  key: `page-${page}`,
  type: "page",
  value: page,
});

const pageItems = computed(() => {
  const total = Math.max(props.pageCount, 1);
  const current = Math.min(Math.max(props.currentPage, 1), total);

  if (total <= 5) {
    return Array.from({ length: total }, (_, index) => buildPageItem(index + 1));
  }

  if (current <= 3) {
    return [
      ...Array.from({ length: 4 }, (_, index) => buildPageItem(index + 1)),
      { key: "ellipsis-end", type: "ellipsis" },
      buildPageItem(total),
    ];
  }

  if (current >= total - 2) {
    return [
      buildPageItem(1),
      { key: "ellipsis-start", type: "ellipsis" },
      ...Array.from({ length: 4 }, (_, index) => buildPageItem(total - 3 + index)),
    ];
  }

  const visibleStart = Math.max(2, current - 1);
  const visibleEnd = Math.min(total - 1, current + 1);
  const items = [buildPageItem(1)];

  if (visibleStart > 2) {
    items.push({ key: "ellipsis-start", type: "ellipsis" });
  }

  for (let page = visibleStart; page <= visibleEnd; page += 1) {
    items.push(buildPageItem(page));
  }

  if (visibleEnd < total - 1) {
    items.push({ key: "ellipsis-end", type: "ellipsis" });
  }

  items.push(buildPageItem(total));
  return items;
});

const emitChange = (page) => {
  const nextPage = Math.min(Math.max(page, 1), Math.max(props.pageCount, 1));
  if (nextPage === props.currentPage) {
    return;
  }
  emit("change", nextPage);
};
</script>
