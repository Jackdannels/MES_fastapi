<template>
  <span
    ref="rootElement"
    class="picker-only-input"
    :class="{ 'picker-only-input--manual-time': manualTimeEntryEnabled }"
  >
    <span
      v-if="manualTimeEntryEnabled"
      ref="inputElement"
      class="picker-only-input__manual-control"
      :class="inputClass"
      role="group"
      aria-label="开始时间"
    >
      <label
        class="picker-only-input__manual-part"
        :class="{ 'is-invalid': manualHourError }"
      >
        <input
          :aria-describedby="manualHintId"
          :aria-invalid="manualHourError ? 'true' : 'false'"
          aria-label="小时，允许输入00到23"
          autocomplete="off"
          data-testid="manual-time-hour"
          :disabled="manualInputDisabled"
          inputmode="numeric"
          maxlength="2"
          :name="manualHourName"
          placeholder="00"
          :readonly="manualInputReadonly"
          type="text"
          :value="manualHour"
          @blur="handleManualBlur('hour')"
          @input="handleManualInput('hour', $event)"
        />
        <span aria-hidden="true">时</span>
      </label>
      <span class="picker-only-input__manual-separator" aria-hidden="true">:</span>
      <label
        class="picker-only-input__manual-part"
        :class="{ 'is-invalid': manualMinuteError }"
      >
        <input
          :aria-describedby="manualHintId"
          :aria-invalid="manualMinuteError ? 'true' : 'false'"
          aria-label="分钟，允许输入00到59"
          autocomplete="off"
          data-testid="manual-time-minute"
          :disabled="manualInputDisabled"
          inputmode="numeric"
          maxlength="2"
          :name="manualMinuteName"
          placeholder="00"
          :readonly="manualInputReadonly"
          type="text"
          :value="manualMinute"
          @blur="handleManualBlur('minute')"
          @input="handleManualInput('minute', $event)"
        />
        <span aria-hidden="true">分</span>
      </label>
      <button
        class="picker-only-input__manual-trigger"
        type="button"
        :aria-expanded="pickerOpen ? 'true' : 'false'"
        aria-haspopup="dialog"
        aria-label="打开时间选择器"
        :disabled="isExternallyReadonly"
        @click="openPicker"
      >
        <span class="picker-only-input__indicator picker-only-input__indicator--time" aria-hidden="true"></span>
      </button>
    </span>
    <span
      v-if="manualTimeEntryEnabled"
      :id="manualHintId"
      class="picker-only-input__manual-hint"
      :class="{ 'is-error': manualValidationMessage }"
      :role="manualValidationMessage ? 'alert' : undefined"
    >
      {{ manualValidationMessage || "小时 00–23，分钟 00–59" }}
    </span>
    <input
      v-else
      ref="inputElement"
      v-bind="inputAttrs"
      :aria-expanded="pickerOpen ? 'true' : 'false'"
      aria-haspopup="dialog"
      :class="[{ 'format-hint-empty': !modelValue }, inputClass]"
      :data-format-hint="emptyDisplayHint"
      readonly
      type="text"
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
    <span v-if="!manualTimeEntryEnabled && !modelValue" class="picker-only-input__hint" aria-hidden="true">{{ emptyDisplayHint }}</span>
    <span
      v-if="!manualTimeEntryEnabled"
      class="picker-only-input__indicator"
      :class="{ 'picker-only-input__indicator--time': type === 'time' }"
      aria-hidden="true"
    ></span>
    <div
      v-if="pickerOpen"
      ref="popoverElement"
      class="picker-only-calendar"
      :class="{
        'picker-only-calendar--datetime': type === 'datetime-local',
        'picker-only-calendar--time': type === 'time',
      }"
      role="dialog"
      :aria-label="pickerAriaLabel"
      :style="popoverStyle"
      @click.stop
      @keydown.esc.stop.prevent="closePicker"
    >
      <template v-if="hasCalendar">
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
            :class="{
              'is-muted': !day.inMonth,
              'is-selected': day.value === selectedDateValue,
              'is-today': day.value === todayValue,
            }"
            type="button"
            :data-date-value="day.value"
            :disabled="day.disabled"
            @click="selectDate(day.value)"
          >
            {{ day.day }}
          </button>
        </div>
      </template>

      <div v-if="hasTime" class="picker-only-time">
        <strong class="picker-only-time__title">选择时间</strong>
        <div class="picker-only-time__fields">
          <div class="picker-only-time__field picker-only-time__field--hour">
            <span>时</span>
            <div
              class="picker-only-time__wheel"
              role="listbox"
              aria-label="小时"
              tabindex="0"
              @keydown.down.prevent="shiftTimePart('hour', 1)"
              @keydown.up.prevent="shiftTimePart('hour', -1)"
              @wheel.prevent="handleTimeWheel('hour', $event)"
            >
              <button
                v-for="item in hourWheelItems"
                :key="`hour-${item.offset}-${item.value}`"
                class="picker-only-time__wheel-item"
                :class="{ 'is-selected': item.offset === 0 }"
                type="button"
                role="option"
                :aria-selected="item.offset === 0 ? 'true' : 'false'"
                :data-distance="Math.abs(item.offset)"
                :data-wheel-value="item.value"
                tabindex="-1"
                @click="selectTimePart('hour', item.value)"
              >
                {{ item.value }}
              </button>
            </div>
          </div>
          <span class="picker-only-time__separator" aria-hidden="true">:</span>
          <div class="picker-only-time__field picker-only-time__field--minute">
            <span>分</span>
            <div
              class="picker-only-time__wheel"
              role="listbox"
              aria-label="分钟"
              tabindex="0"
              @keydown.down.prevent="shiftTimePart('minute', 1)"
              @keydown.up.prevent="shiftTimePart('minute', -1)"
              @wheel.prevent="handleTimeWheel('minute', $event)"
            >
              <button
                v-for="item in minuteWheelItems"
                :key="`minute-${item.offset}-${item.value}`"
                class="picker-only-time__wheel-item"
                :class="{ 'is-selected': item.offset === 0 }"
                type="button"
                role="option"
                :aria-selected="item.offset === 0 ? 'true' : 'false'"
                :data-distance="Math.abs(item.offset)"
                :data-wheel-value="item.value"
                tabindex="-1"
                @click="selectTimePart('minute', item.value)"
              >
                {{ item.value }}
              </button>
            </div>
          </div>
        </div>
        <p v-if="!draftValueIsValid" class="picker-only-time__warning" role="status">所选时间超出允许范围</p>
      </div>

      <div class="picker-only-calendar__footer">
        <button class="picker-only-calendar__clear" type="button" @click="clearValue">清除</button>
        <div v-if="hasTime" class="picker-only-calendar__actions">
          <button class="picker-only-calendar__cancel" type="button" @click="closePicker">取消</button>
          <button class="picker-only-calendar__confirm" type="button" :disabled="!draftValueIsValid" @click="confirmValue">确定</button>
        </div>
      </div>
    </div>
  </span>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useAttrs, watch } from "vue";
import { serverNowDate } from "@/lib/serverClock";

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
  emptyHint: {
    type: String,
    default: "",
  },
  displaySlashDate: {
    type: Boolean,
    default: false,
  },
  manualTimeEntry: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update:modelValue"]);
const attrs = useAttrs();
const pickerOpen = ref(false);
const calendarCursor = ref(serverNowDate());
const draftDate = ref("");
const draftHour = ref("00");
const draftMinute = ref("00");
const manualHour = ref("");
const manualMinute = ref("");
const manualTouched = ref({ hour: false, minute: false });
const lastEmittedModelValue = ref(null);
const rootElement = ref(null);
const inputElement = ref(null);
const popoverElement = ref(null);
const popoverStyle = ref({});
const weekdays = Object.freeze(["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);
const wheelOffsets = Object.freeze([-2, -1, 0, 1, 2]);
const wheelThrottleMilliseconds = 160;
const wheelLockedUntil = { hour: 0, minute: 0 };

const inputClass = computed(() => attrs.class);
const inputAttrs = computed(() => {
  const rest = { ...attrs };
  delete rest.class;
  return rest;
});
const hasBooleanAttr = (value) => value !== undefined && value !== null && value !== false;
const isExternallyReadonly = computed(() => [inputAttrs.value.readonly, inputAttrs.value.disabled]
  .some(hasBooleanAttr));
const manualTimeEntryEnabled = computed(() => props.manualTimeEntry && props.type === "time");
const manualInputDisabled = computed(() => hasBooleanAttr(inputAttrs.value.disabled));
const manualInputReadonly = computed(() => hasBooleanAttr(inputAttrs.value.readonly));
const manualFieldName = computed(() => String(inputAttrs.value.name || "time"));
const manualHourName = computed(() => `${manualFieldName.value}_hour`);
const manualMinuteName = computed(() => `${manualFieldName.value}_minute`);
const manualHintId = `picker-time-hint-${Math.random().toString(36).slice(2, 9)}`;
const hasCalendar = computed(() => props.type !== "time");
const hasTime = computed(() => props.type !== "date");
const displayValue = computed(() => {
  if (props.displaySlashDate && props.type === "date") {
    return String(props.modelValue || "").replaceAll("-", " / ");
  }
  if (props.type === "datetime-local") {
    return String(props.modelValue || "").replace("T", " ");
  }
  return props.modelValue;
});
const calendarYear = computed(() => calendarCursor.value.getFullYear());
const calendarMonth = computed(() => calendarCursor.value.getMonth());
const todayValue = computed(() => toDateValue(serverNowDate()));
const selectedDateValue = computed(() => (props.type === "date" ? props.modelValue : draftDate.value));
const pickerAriaLabel = computed(() => {
  if (props.type === "datetime-local") {
    return "选择日期和时间";
  }
  return props.type === "time" ? "选择时间" : "选择日期";
});

const formatHint = computed(() => {
  if (props.type === "datetime-local") {
    return "年 / 月 / 日 --:--";
  }
  if (props.type === "time") {
    return "--:--";
  }
  return "年 / 月 / 日";
});
const emptyDisplayHint = computed(() => String(props.emptyHint || "").trim() || formatHint.value);

const navigationKeys = new Set(["Tab"]);

const parseDateValue = (value) => {
  const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) {
    return null;
  }
  const year = Number(matched[1]);
  const month = Number(matched[2]) - 1;
  const day = Number(matched[3]);
  const date = new Date(year, month, day);
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
};

const parseTimeValue = (value) => {
  const matched = String(value || "").match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!matched || Number(matched[1]) > 23 || Number(matched[2]) > 59) {
    return null;
  }
  return { hour: matched[1], minute: matched[2] };
};

const normalizeManualPart = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 2);
const manualPartIsValid = (part, value) => {
  if (!/^\d{1,2}$/.test(value)) {
    return false;
  }
  return Number(value) <= (part === "hour" ? 23 : 59);
};

const parseDateTimeValue = (value) => {
  const matched = String(value || "").match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  const date = parseDateValue(matched?.[1]);
  const time = parseTimeValue(matched?.[2]);
  if (!date || !time) {
    return null;
  }
  return { date, dateValue: matched[1], ...time };
};

function toDateValue(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function toTimeValue(date) {
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
}

const normalizedMin = computed(() => normalizeBoundaryValue(inputAttrs.value.min));
const normalizedMax = computed(() => normalizeBoundaryValue(inputAttrs.value.max));

function normalizeBoundaryValue(value) {
  const normalized = String(value || "").trim();
  if (props.type === "date") {
    return parseDateValue(normalized) ? normalized : "";
  }
  if (props.type === "time") {
    return parseTimeValue(normalized) ? normalized.slice(0, 5) : "";
  }
  const parsed = parseDateTimeValue(normalized);
  return parsed ? `${parsed.dateValue}T${parsed.hour}:${parsed.minute}` : "";
}

const isValueWithinBounds = (value) => (
  (!normalizedMin.value || value >= normalizedMin.value)
  && (!normalizedMax.value || value <= normalizedMax.value)
);

const normalizedManualValue = computed(() => {
  if (!manualPartIsValid("hour", manualHour.value) || !manualPartIsValid("minute", manualMinute.value)) {
    return "";
  }
  return `${manualHour.value.padStart(2, "0")}:${manualMinute.value.padStart(2, "0")}`;
});
const rawManualValue = computed(() => `${manualHour.value}:${manualMinute.value}`);
const manualHourError = computed(() => (
  manualTouched.value.hour && !manualPartIsValid("hour", manualHour.value)
));
const manualMinuteError = computed(() => (
  manualTouched.value.minute && !manualPartIsValid("minute", manualMinute.value)
));
const manualValidationMessage = computed(() => {
  if (manualHourError.value) {
    return manualHour.value ? "小时应为 00–23" : "请输入小时";
  }
  if (manualMinuteError.value) {
    return manualMinute.value ? "分钟应为 00–59" : "请输入分钟";
  }
  if (
    (manualTouched.value.hour || manualTouched.value.minute)
    && normalizedManualValue.value
    && !isValueWithinBounds(normalizedManualValue.value)
  ) {
    if (normalizedMin.value && normalizedManualValue.value < normalizedMin.value) {
      return `开始时间不能早于 ${normalizedMin.value}`;
    }
    if (normalizedMax.value && normalizedManualValue.value > normalizedMax.value) {
      return `开始时间不能晚于 ${normalizedMax.value}`;
    }
    return "时间超出允许范围";
  }
  return "";
});

const isDateWithinBounds = (value) => {
  if (props.type === "date") {
    return isValueWithinBounds(value);
  }
  const minDate = normalizedMin.value.slice(0, 10);
  const maxDate = normalizedMax.value.slice(0, 10);
  return (!minDate || value >= minDate) && (!maxDate || value <= maxDate);
};

const draftValue = computed(() => {
  const time = `${draftHour.value}:${draftMinute.value}`;
  return props.type === "time" ? time : `${draftDate.value}T${time}`;
});
const draftValueIsValid = computed(() => {
  if (!hasTime.value || (hasCalendar.value && !parseDateValue(draftDate.value))) {
    return false;
  }
  return isValueWithinBounds(draftValue.value);
});
const buildWheelItems = (value, size) => {
  const selected = Number.parseInt(String(value || "0"), 10) || 0;
  return wheelOffsets.map((offset) => ({
    offset,
    value: String((selected + offset + size) % size).padStart(2, "0"),
  }));
};
const hourWheelItems = computed(() => buildWheelItems(draftHour.value, 24));
const minuteWheelItems = computed(() => buildWheelItems(draftMinute.value, 60));

const resolveCalendarCursor = () => {
  if (props.type === "date") {
    return parseDateValue(props.modelValue) || parseDateValue(props.initialCalendarDate) || serverNowDate();
  }
  return parseDateValue(draftDate.value) || parseDateValue(props.initialCalendarDate) || serverNowDate();
};

const calendarDays = computed(() => {
  const firstOfMonth = new Date(calendarYear.value, calendarMonth.value, 1);
  const mondayFirstOffset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(calendarYear.value, calendarMonth.value, 1 - mondayFirstOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const value = toDateValue(date);
    return {
      day: date.getDate(),
      disabled: !isDateWithinBounds(value),
      inMonth: date.getMonth() === calendarMonth.value,
      value,
    };
  });
});

const clampDraftValue = (value) => {
  if (normalizedMin.value && value < normalizedMin.value) {
    return normalizedMin.value;
  }
  if (normalizedMax.value && value > normalizedMax.value) {
    return normalizedMax.value;
  }
  return value;
};

const initializeDraft = () => {
  const now = serverNowDate();
  if (props.type === "time") {
    const parsed = parseTimeValue(props.modelValue);
    const initial = clampDraftValue(parsed ? `${parsed.hour}:${parsed.minute}` : toTimeValue(now));
    const resolved = parseTimeValue(initial) || { hour: "00", minute: "00" };
    draftHour.value = resolved.hour;
    draftMinute.value = resolved.minute;
    return;
  }
  if (props.type === "datetime-local") {
    const parsed = parseDateTimeValue(props.modelValue);
    const fallback = `${toDateValue(now)}T${toTimeValue(now)}`;
    const initial = clampDraftValue(parsed ? `${parsed.dateValue}T${parsed.hour}:${parsed.minute}` : fallback);
    const resolved = parseDateTimeValue(initial) || parseDateTimeValue(fallback);
    draftDate.value = resolved.dateValue;
    draftHour.value = resolved.hour;
    draftMinute.value = resolved.minute;
  }
};

const syncManualFields = (value) => {
  const parsed = parseTimeValue(value);
  manualHour.value = parsed?.hour || "";
  manualMinute.value = parsed?.minute || "";
  manualTouched.value = { hour: false, minute: false };
};

const emitModelValue = (value) => {
  lastEmittedModelValue.value = value;
  emit("update:modelValue", value);
};

const commitManualValue = () => {
  const value = normalizedManualValue.value;
  emitModelValue(value && isValueWithinBounds(value) ? value : rawManualValue.value);
};

const handleManualInput = (part, event) => {
  if (isExternallyReadonly.value) {
    return;
  }
  const value = normalizeManualPart(event?.target?.value);
  if (event?.target) {
    event.target.value = value;
  }
  if (part === "hour") {
    manualHour.value = value;
  } else {
    manualMinute.value = value;
  }
  commitManualValue();
};

const handleManualBlur = (part) => {
  const current = part === "hour" ? manualHour.value : manualMinute.value;
  if (manualPartIsValid(part, current)) {
    if (part === "hour") {
      manualHour.value = current.padStart(2, "0");
    } else {
      manualMinute.value = current.padStart(2, "0");
    }
  }
  manualTouched.value = { ...manualTouched.value, [part]: true };
  commitManualValue();
};

const updatePopoverPosition = () => {
  if (!pickerOpen.value || !inputElement.value || !popoverElement.value) {
    return;
  }
  const gap = 6;
  const viewportPadding = 12;
  const inputRect = inputElement.value.getBoundingClientRect();
  const popoverRect = popoverElement.value.getBoundingClientRect();
  const maxLeft = Math.max(viewportPadding, window.innerWidth - popoverRect.width - viewportPadding);
  const left = Math.min(Math.max(viewportPadding, inputRect.right - popoverRect.width), maxLeft);
  const belowTop = inputRect.bottom + gap;
  const aboveTop = inputRect.top - popoverRect.height - gap;
  const fitsBelow = belowTop + popoverRect.height <= window.innerHeight - viewportPadding;
  const top = fitsBelow
    ? belowTop
    : Math.max(viewportPadding, aboveTop);
  popoverStyle.value = {
    left: `${Math.round(left)}px`,
    maxHeight: `${Math.max(180, window.innerHeight - (viewportPadding * 2))}px`,
    top: `${Math.round(top)}px`,
  };
};

watch(
  () => [props.modelValue, props.initialCalendarDate],
  () => {
    if (!pickerOpen.value) {
      calendarCursor.value = resolveCalendarCursor();
    }
  },
  { immediate: true },
);

watch(
  () => props.modelValue,
  (value) => {
    if (value === lastEmittedModelValue.value) {
      lastEmittedModelValue.value = null;
      return;
    }
    syncManualFields(value);
  },
  { immediate: true },
);

watch(
  () => props.type,
  () => {
    pickerOpen.value = false;
  },
);

const handleKeydown = (event) => {
  if (event.key === "Escape" && pickerOpen.value) {
    closePicker();
    event.preventDefault();
    return;
  }
  if (navigationKeys.has(event.key)) {
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    openPicker();
  }
  event.preventDefault();
};

const openPicker = async () => {
  if (isExternallyReadonly.value) {
    return;
  }
  wheelLockedUntil.hour = 0;
  wheelLockedUntil.minute = 0;
  initializeDraft();
  calendarCursor.value = resolveCalendarCursor();
  pickerOpen.value = true;
  await nextTick();
  updatePopoverPosition();
};

const closePicker = () => {
  pickerOpen.value = false;
};

const selectTimePart = (part, value) => {
  if (part === "hour") {
    draftHour.value = value;
    return;
  }
  draftMinute.value = value;
};

const shiftTimePart = (part, delta) => {
  const size = part === "hour" ? 24 : 60;
  const current = Number.parseInt(part === "hour" ? draftHour.value : draftMinute.value, 10) || 0;
  selectTimePart(part, String((current + delta + size) % size).padStart(2, "0"));
};

const handleTimeWheel = (part, event) => {
  const direction = Math.sign(Number(event?.deltaY) || 0);
  if (!direction) {
    return;
  }
  const now = Date.now();
  if (now < wheelLockedUntil[part]) {
    return;
  }
  wheelLockedUntil[part] = now + wheelThrottleMilliseconds;
  shiftTimePart(part, direction);
};

const shiftMonth = (delta) => {
  calendarCursor.value = new Date(calendarYear.value, calendarMonth.value + delta, 1);
};

const selectDate = (value) => {
  if (isExternallyReadonly.value || !isDateWithinBounds(value)) {
    return;
  }
  if (props.type === "date") {
    emit("update:modelValue", value);
    closePicker();
    return;
  }
  draftDate.value = value;
};

const clearValue = () => {
  if (isExternallyReadonly.value) {
    return;
  }
  if (manualTimeEntryEnabled.value) {
    syncManualFields("");
  }
  emitModelValue("");
  closePicker();
};

const confirmValue = () => {
  if (isExternallyReadonly.value || !draftValueIsValid.value) {
    return;
  }
  if (manualTimeEntryEnabled.value) {
    syncManualFields(draftValue.value);
  }
  emitModelValue(draftValue.value);
  closePicker();
};

const handleDocumentPointerDown = (event) => {
  if (!pickerOpen.value) {
    return;
  }
  const target = event.target;
  if (target instanceof Element && rootElement.value?.contains(target)) {
    return;
  }
  closePicker();
};

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  window.addEventListener("resize", updatePopoverPosition);
  window.addEventListener("scroll", updatePopoverPosition, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  window.removeEventListener("resize", updatePopoverPosition);
  window.removeEventListener("scroll", updatePopoverPosition, true);
});
</script>
