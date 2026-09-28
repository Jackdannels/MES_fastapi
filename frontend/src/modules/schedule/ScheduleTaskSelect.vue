<template>
  <div ref="root" class="schedule-task-select" @focusout="onFocusOut">
    <!-- 保留原生表单字段和值；可见控件负责跨浏览器一致的优先级标签展示。 -->
    <select v-model="value" name="task_code" hidden tabindex="-1" aria-hidden="true">
      <option value="">{{ options.length ? placeholder : emptyLabel }}</option>
      <option v-for="option in options" :key="option.code" :value="option.code">{{ option.label }}</option>
    </select>
    <div class="schedule-task-select__control">
      <button
        :id="id"
        ref="trigger"
        type="button"
        class="schedule-task-select__trigger"
        role="combobox"
        aria-label="任务编号"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="`${id}-listbox`"
        :aria-activedescendant="open ? `${id}-option-${activeIndex}` : undefined"
        :aria-describedby="hint ? `${id}-hint` : undefined"
        :disabled="!options.length"
        @click="toggle"
        @keydown="onKeydown"
      >
        <span class="schedule-task-select__code">{{ selected?.label || (options.length ? placeholder : emptyLabel) }}</span>
        <span v-if="selected" class="schedule-task-select__badge" :class="`priority-${tone(selected.priority)}`">
          {{ priorityLabel(selected.priority) }}
        </span>
        <span class="schedule-task-select__chevron" aria-hidden="true"></span>
      </button>
      <div v-if="open" class="schedule-task-select__popup">
        <div class="schedule-task-select__caption">可排程任务 · {{ options.length }} 项</div>
        <ul :id="`${id}-listbox`" role="listbox" aria-label="可排程任务" class="schedule-task-select__list">
          <li
            v-for="(option, index) in choices"
            :id="`${id}-option-${index}`"
            :key="option.code"
            role="option"
            :aria-selected="value === option.code"
            class="schedule-task-select__option"
            :class="[{ 'is-active': activeIndex === index }, option.code ? `priority-row-${tone(option.priority)}` : undefined]"
            @pointermove="activeIndex = index"
            @mousedown.prevent
            @click="choose(option.code)"
          >
            <span class="schedule-task-select__code">{{ option.label }}</span>
            <span v-if="option.code" class="schedule-task-select__badge" :class="`priority-${tone(option.priority)}`">
              {{ priorityLabel(option.priority) }}
            </span>
            <span class="schedule-task-select__check" aria-hidden="true">{{ value === option.code ? '✓' : '' }}</span>
          </li>
        </ul>
      </div>
    </div>
    <p v-if="hint" :id="`${id}-hint`" class="schedule-task-select__hint" role="status">{{ hint }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({
  id: { type: String, required: true },
  modelValue: { type: String, default: "" },
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: "请选择已接收任务" },
  emptyLabel: { type: String, default: "暂无已接收任务" },
});
const emit = defineEmits(["update:modelValue"]);
const root = ref(null);
const trigger = ref(null);
const open = ref(false);
const activeIndex = ref(0);
const value = computed({ get: () => props.modelValue, set: (code) => emit("update:modelValue", code) });
const selected = computed(() => props.options.find((option) => option.code === value.value));
const choices = computed(() => [{ code: "", label: props.placeholder }, ...props.options]);
const ranks = new Map([["高", 3], ["中", 2], ["低", 1]]);
const tones = new Map([["高", "high"], ["中", "medium"], ["低", "low"]]);
const tone = (priority) => tones.get(priority) || "unknown";
const priorityLabel = (priority) => ranks.has(priority) ? `${priority}优先级` : "优先级未设置";
// 仅提示当前可选任务，不修改排序、可排程资格或提交条件；缺失值不猜测等级。
const hint = computed(() => {
  const rank = ranks.get(selected.value?.priority);
  if (!rank) return "";
  const higherCount = props.options.filter((option) => ranks.get(option.priority) > rank).length;
  return higherCount ? `当前选择${selected.value.priority}优先级，仍有 ${higherCount} 项更高优先级任务待排，请留意安排。` : "";
});
let searchText = "";
let searchAt = 0;

function scrollActiveIntoView() {
  nextTick(() => root.value?.querySelector(`[id="${props.id}-option-${activeIndex.value}"]`)?.scrollIntoView?.({ block: "nearest" }));
}

function show() {
  if (!props.options.length) return;
  activeIndex.value = Math.max(0, choices.value.findIndex((option) => option.code === value.value));
  open.value = true;
  searchText = "";
  scrollActiveIntoView();
}

function toggle() {
  if (open.value) open.value = false;
  else show();
}

function choose(code) {
  value.value = code;
  open.value = false;
  trigger.value?.focus();
}

function onKeydown(event) {
  if (event.key === "Tab" || event.key === "Escape") {
    open.value = false;
    if (event.key === "Escape") event.preventDefault();
    return;
  }
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    if (open.value) choose(choices.value[activeIndex.value]?.code ?? "");
    else show();
    return;
  }
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (!open.value) show();
    const last = choices.value.length - 1;
    if (event.key === "Home") activeIndex.value = 0;
    else if (event.key === "End") activeIndex.value = last;
    else activeIndex.value = Math.max(0, Math.min(last, activeIndex.value + (event.key === "ArrowDown" ? 1 : -1)));
    scrollActiveIntoView();
    return;
  }
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (!open.value) show();
    searchText = Date.now() - searchAt > 700 ? event.key : searchText + event.key;
    searchAt = Date.now();
    const index = choices.value.findIndex((option) => option.code.toLowerCase().startsWith(searchText.toLowerCase()));
    if (index >= 0) activeIndex.value = index;
    scrollActiveIntoView();
  }
}

function onOutsidePointer(event) {
  if (!root.value?.contains(event.target)) open.value = false;
}

function onFocusOut(event) {
  if (!root.value?.contains(event.relatedTarget)) open.value = false;
}

// 实时刷新/重置时关闭旧菜单，避免键盘提交已经失效的选项。
watch([() => props.options, () => props.modelValue], () => { open.value = false; });
onMounted(() => document.addEventListener("pointerdown", onOutsidePointer));
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutsidePointer));
</script>

<style scoped>
.schedule-task-select {
  --priority-high-text: #ffa99c;
  --priority-high-bg: #362624;
  --priority-medium-text: #f2cd7e;
  --priority-medium-bg: #302c21;
  --priority-low-text: #9ac8fa;
  --priority-low-bg: #202e3e;
  position: relative;
  min-width: 0;
}
:global(:root[data-theme="light"] .schedule-task-select) {
  --priority-high-text: #9f3427;
  --priority-high-bg: #fff0ec;
  --priority-medium-text: #795008;
  --priority-medium-bg: #fff5da;
  --priority-low-text: #235b91;
  --priority-low-bg: #edf5ff;
}
.schedule-task-select__trigger, .schedule-task-select__option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 9px 10px;
  color: var(--text);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.schedule-task-select__control { position: relative; }
.schedule-task-select__trigger {
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--bg-panel-strong);
  font-family: inherit;
}
.schedule-task-select__trigger:hover:not(:disabled) { border-color: var(--border-strong); }
.schedule-task-select__trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.schedule-task-select__trigger:disabled { color: var(--muted); cursor: not-allowed; }
.schedule-task-select__code { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.schedule-task-select__badge {
  flex: none;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.6;
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  color: var(--muted);
  background: var(--bg-panel-strong);
}
.priority-high { color: var(--priority-high-text); background: var(--priority-high-bg); }
.priority-medium { color: var(--priority-medium-text); background: var(--priority-medium-bg); }
.priority-low { color: var(--priority-low-text); background: var(--priority-low-bg); }
.schedule-task-select__chevron {
  flex: none;
  width: 6px;
  height: 6px;
  border: solid var(--muted);
  border-width: 0 1px 1px 0;
  transform: rotate(45deg);
  margin: 0 2px 4px;
}
.schedule-task-select__popup {
  position: absolute;
  top: calc(100% + 5px);
  inset-inline: 0;
  z-index: 30;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface-overlay);
  box-shadow: var(--shadow);
}
.schedule-task-select__caption { padding: 8px 10px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); }
.schedule-task-select__list { margin: 0; padding: 4px; max-height: min(300px, 45dvh); overflow-y: auto; list-style: none; }
.schedule-task-select__option {
  border-radius: 3px;
  min-height: 44px;
  border-left: 3px solid var(--priority-row-color, transparent);
  background: var(--priority-row-bg, transparent);
}
.schedule-task-select__option + .schedule-task-select__option { margin-top: 4px; }
/* 方案 B：色条和浅底只表达优先级，正文保留主题文字色。 */
.priority-row-high { --priority-row-color: var(--priority-high-text); --priority-row-bg: var(--priority-high-bg); }
.priority-row-medium { --priority-row-color: var(--priority-medium-text); --priority-row-bg: var(--priority-medium-bg); }
.priority-row-low { --priority-row-color: var(--priority-low-text); --priority-row-bg: var(--priority-low-bg); }
.schedule-task-select__option.is-active {
  background: var(--priority-row-bg, rgba(var(--industrial-accent-rgb), 0.12));
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}
.schedule-task-select__check { width: 12px; flex: none; color: var(--accent); }
.schedule-task-select__hint { margin: 7px 0 0; color: var(--priority-medium-text); font-size: 12px; line-height: 1.6; }
@media (max-width: 640px) { .schedule-task-select__trigger { min-height: 44px; } }
</style>
