<template>
  <input
    v-bind="$attrs"
    :type="type"
    :value="modelValue"
    inputmode="none"
    @beforeinput.prevent
    @cut.prevent
    @drop.prevent
    @input="emit('update:modelValue', $event.target.value)"
    @keydown="handleKeydown"
    @paste.prevent
    @click="openPicker"
  />
</template>

<script setup>
defineOptions({
  inheritAttrs: false,
});

defineProps({
  modelValue: {
    type: String,
    default: "",
  },
  type: {
    type: String,
    default: "date",
    validator: (value) => ["date", "datetime-local", "time"].includes(value),
  },
});

const emit = defineEmits(["update:modelValue"]);

const navigationKeys = new Set(["Tab", "Escape"]);

const handleKeydown = (event) => {
  if (navigationKeys.has(event.key)) {
    return;
  }
  event.preventDefault();
};

const openPicker = (event) => {
  event?.target?.showPicker?.();
};
</script>
