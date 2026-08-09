<template>
  <div class="app-number-input" :class="[rootClass, { 'is-disabled': disabled, 'is-readonly': readonly, 'is-horizontal': controlsLayout === 'horizontal' }]">
    <button
      v-if="controlsLayout === 'horizontal'"
      class="app-number-input__step app-number-input__step--down"
      data-testid="number-step-down"
      type="button"
      aria-label="减少"
      :disabled="disabled || readonly"
      @click="stepBy(-1)"
    ></button>
    <input
      v-bind="inputAttrs"
      class="app-number-input__field"
      type="number"
      :value="modelText"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :readonly="readonly"
      :required="required"
      :placeholder="placeholder"
      :inputmode="inputmode"
      @keydown.down.prevent="stepBy(-1)"
      @keydown.up.prevent="stepBy(1)"
      @input="handleInput"
      @change="handleChange"
    />
    <button
      v-if="controlsLayout === 'horizontal'"
      class="app-number-input__step app-number-input__step--up"
      data-testid="number-step-up"
      type="button"
      aria-label="增加"
      :disabled="disabled || readonly"
      @click="stepBy(1)"
    ></button>
    <div v-else class="app-number-input__controls">
      <button
        class="app-number-input__step app-number-input__step--up"
        data-testid="number-step-up"
        type="button"
        tabindex="-1"
        aria-label="增加"
        :disabled="disabled || readonly"
        @click="stepBy(1)"
      ></button>
      <button
        class="app-number-input__step app-number-input__step--down"
        data-testid="number-step-down"
        type="button"
        tabindex="-1"
        aria-label="减少"
        :disabled="disabled || readonly"
        @click="stepBy(-1)"
      ></button>
    </div>
  </div>
</template>

<script setup>
import { computed, useAttrs } from "vue";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  inputmode: {
    type: String,
    default: "numeric",
  },
  max: {
    type: [Number, String],
    default: undefined,
  },
  min: {
    type: [Number, String],
    default: undefined,
  },
  modelValue: {
    type: [Number, String],
    default: "",
  },
  placeholder: {
    type: String,
    default: "",
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  required: {
    type: Boolean,
    default: false,
  },
  step: {
    type: [Number, String],
    default: 1,
  },
  stepDown: {
    type: [Number, String],
    default: undefined,
  },
  stepUp: {
    type: [Number, String],
    default: undefined,
  },
  controlsLayout: {
    type: String,
    default: "vertical",
    validator: (value) => ["vertical", "horizontal"].includes(value),
  },
});

const emit = defineEmits(["update:modelValue", "change"]);
const attrs = useAttrs();

const rootClass = computed(() => attrs.class);
const inputAttrs = computed(() => {
  const rest = { ...attrs };
  delete rest.class;
  return rest;
});
const modelText = computed(() => String(props.modelValue ?? ""));

const toFiniteNumber = (value) => {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const countDecimals = (value) => {
  const text = String(value ?? "");
  if (!text.includes(".")) {
    return 0;
  }
  return text.split(".")[1]?.length || 0;
};

const formatNumber = (value) => {
  const precision = Math.max(countDecimals(props.step), countDecimals(props.min), countDecimals(props.max));
  return String(Number(value.toFixed(Math.min(precision, 8))));
};

const clamp = (value) => {
  const min = toFiniteNumber(props.min);
  const max = toFiniteNumber(props.max);
  let next = value;
  if (min !== null) {
    next = Math.max(min, next);
  }
  if (max !== null) {
    next = Math.min(max, next);
  }
  return next;
};

const normalizeInputValue = (value) => {
  const text = String(value ?? "");
  if (!text) {
    return "";
  }
  const parsed = toFiniteNumber(text);
  if (parsed === null) {
    return text;
  }
  return formatNumber(clamp(parsed));
};

const stepBy = (direction) => {
  const directionalStep = direction > 0 ? props.stepUp : props.stepDown;
  const step = toFiniteNumber(directionalStep) || toFiniteNumber(props.step) || 1;
  const min = toFiniteNumber(props.min);
  const current = toFiniteNumber(props.modelValue);
  const base = current ?? min ?? 0;
  const nextValue = formatNumber(clamp(base + direction * step));
  emit("update:modelValue", nextValue);
  emit("change", nextValue);
};

const handleInput = (event) => {
  const nextValue = normalizeInputValue(event.target.value);
  event.target.value = nextValue;
  emit("update:modelValue", nextValue);
};

const handleChange = (event) => {
  const nextValue = normalizeInputValue(event.target.value);
  event.target.value = nextValue;
  emit("change", nextValue);
};
</script>
