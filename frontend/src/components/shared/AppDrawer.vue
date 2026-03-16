<template>
  <div class="drawer" :class="{ 'is-open': open }">
    <div v-if="open" class="modal-backdrop" @click="emitClose"></div>
    <div v-if="open" class="drawer-content">
      <div class="drawer-header">
        <strong>{{ title }}</strong>
        <button class="drawer-close" type="button" @click="emitClose">关闭</button>
      </div>
      <slot />
      <div v-if="$slots.footer" class="form-actions">
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

const emitClose = () => {
  if (!props.open) {
    return;
  }
  emit("close");
};
</script>
