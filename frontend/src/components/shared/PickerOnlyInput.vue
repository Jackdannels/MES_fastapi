<template>
  <span class="picker-only-input">
    <input
      v-bind="inputAttrs"
      :class="[{ 'format-hint-empty': !modelValue }, inputClass]"
      :data-format-hint="formatHint"
      :readonly="isCustomDate || inputAttrs.readonly"
      :type="inputType"
      :value="displayValue"
      inputmode="none"
      @beforeinput.prevent
      @cut.prevent
      @drop.prevent
      @input="emit('update:modelValue', $event.target.value)"
      @keydown="handleKeydown"
      @paste.prevent
      @click="openPicker"
    />
    <span v-if="!modelValue" class="picker-only-input__hint" aria-hidden="true">{{ formatHint }}</span>
    <div v-if="isCustomDate && calendarOpen" class="picker-only-calendar" role="dialog" aria-label="选择日期" @click.stop>
      <div class="picker-only-calendar__header">
        <button class="picker-only-calendar__nav picker-only-calendar__nav--prev" type="button" aria-label="上一月" @click="shiftMonth(-1)"></button>
        <div class="picker-only-calendar__month">{{ calendarYear }}年{{ calendarMonth + 1 }}月</div>
        <button class="picker-only-calendar__nav picker-only-calendar__nav--next" type="button" aria-label="下一月" @click="shiftMonth(1)"></button>
      </div>
      <div class="picker-only-calendar__weekdays">
        <span v-for="weekday in weekdays" :key="weekday">{{ weekday }}</span>
      </div>
      <div class="picker-only-calendar__days">
        <button
          v-for="day in calendarDays"
          :key="day.value"
          class="picker-only-calendar__day"
          :class="{ 'is-muted': !day.inMonth, 'is-selected': day.value === modelValue, 'is-today': day.value === todayValue }"
          type="button"
          :data-date-value="day.value"
          @click="selectDate(day.value)"
        >
          {{ day.day }}
        </button>
      </div>
      <div class="picker-only-calendar__footer">
        <button class="picker-only-calendar__clear" type="button" @click="clearDate">清除</button>
      </div>
    </div>
  </span>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, watch } from "vue";

defineOptions({
  inheritAttrs: false,
});

const props = defineProps({
  modelValue: {
    type: String,
    default: "",
  },
  type: {
    type: String,
    default: "date",
    validator: (value) => ["date", "datetime-local", "time"].includes(value),
  },
  initialCalendarDate: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["update:modelValue"]);
const attrs = useAttrs();
const calendarOpen = ref(false);
const calendarCursor = ref(new Date());
const weekdays = Object.freeze(["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);

const inputClass = computed(() => attrs.class);
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
const isCustomDate = computed(() => props.type === "date");
const inputType = computed(() => (isCustomDate.value ? "text" : props.type));
const displayValue = computed(() => props.modelValue);
const calendarYear = computed(() => calendarCursor.value.getFullYear());
const calendarMonth = computed(() => calendarCursor.value.getMonth());
const todayValue = computed(() => toDateValue(new Date()));

const formatHint = computed(() => {
  if (props.type === "datetime-local") {
    return "年 / 月 / 日 --:--";
  }
  if (props.type === "time") {
    return "--:--";
  }
  return "年 / 月 / 日";
});

const navigationKeys = new Set(["Tab", "Escape"]);

const parseDateValue = (value) => {
  const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

function toDateValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const resolveCalendarCursor = () =>
  parseDateValue(props.modelValue)
  || parseDateValue(props.initialCalendarDate)
  || new Date();

const calendarDays = computed(() => {
  const firstOfMonth = new Date(calendarYear.value, calendarMonth.value, 1);
  const mondayFirstOffset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(calendarYear.value, calendarMonth.value, 1 - mondayFirstOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      day: date.getDate(),
      inMonth: date.getMonth() === calendarMonth.value,
      value: toDateValue(date),
    };
  });
});

watch(
  () => [props.modelValue, props.initialCalendarDate],
  () => {
    calendarCursor.value = resolveCalendarCursor();
  },
  { immediate: true },
);

const handleKeydown = (event) => {
  if (event.key === "Escape" && calendarOpen.value) {
    calendarOpen.value = false;
    event.preventDefault();
    return;
  }
  if (navigationKeys.has(event.key)) {
    return;
  }
  event.preventDefault();
};

const openPicker = (event) => {
  if (isCustomDate.value) {
    calendarCursor.value = resolveCalendarCursor();
    calendarOpen.value = true;
    return;
  }
  event?.target?.showPicker?.();
};

const shiftMonth = (delta) => {
  calendarCursor.value = new Date(calendarYear.value, calendarMonth.value + delta, 1);
};

const selectDate = (value) => {
  emit("update:modelValue", value);
  calendarOpen.value = false;
};

const clearDate = () => {
  emit("update:modelValue", "");
  calendarOpen.value = false;
};

const handleDocumentPointerDown = (event) => {
  if (!calendarOpen.value) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && target.closest(".picker-only-input")) {
    return;
  }
  calendarOpen.value = false;
};

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>
