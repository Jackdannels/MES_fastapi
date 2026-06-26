<template>
  <div class="modal" :class="{ 'is-open': open }" @keydown.esc="emitClose">
    <div v-if="open" class="modal-backdrop" @click="emitClose"></div>
    <div
      v-if="open"
      class="modal-content"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="title ? titleId : undefined"
      tabindex="-1"
    >
      <div class="modal-header">
        <strong :id="titleId">{{ title }}</strong>
        <button class="modal-close modal-close--touch" type="button" @click="emitClose">关闭</button>
      </div>
      <slot />
      <div v-if="$slots.footer" class="form-actions form-actions--touch">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["close"]);
const titleId = `app-modal-title-${Math.random().toString(36).slice(2, 10)}`;

const emitClose = () => {
  if (!props.open) {
    return;
  }
  emit("close");
};
</script>
