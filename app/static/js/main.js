/* FILE: main.js
 * Frontend boot: bind handlers, render all pages.
 */
import { getLabels } from "./labels.js";
import { renderAll } from "./render.js";
import { attachActionHandlers } from "./actions.js";
import { attachDrawerHandlers, attachFilterHandlers, attachModalHandlers, attachSortHandlers, attachTabHandlers } from "./ui.js";
import { initLabSelects, initTestLabSelects, initDispatchTargetSelects, initTestTypeSelects } from "./labs.js";
import { initRemoteStore } from "./storage.js";

function onReady(fn) {
  if (document.readyState !== "loading") {
    fn();
  } else {
    document.addEventListener("DOMContentLoaded", fn);
  }
}

function attachManualScheduleTimeHandlers() {
  const form = document.querySelector('[data-form="manual-schedule"]');
  if (!form || form.dataset.timeBound === "1") {
    return;
  }
  const slotSelect = form.querySelector('[data-time-slot]');
  const dateInput = form.querySelector('input[name="schedule_date"]');
  const customFields = form.querySelectorAll("[data-custom-time]");
  const toggleCustom = () => {
    const isCustom = slotSelect?.value === "custom";
    customFields.forEach((field) => field.classList.toggle("is-hidden", !isCustom));
  };
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }
  if (slotSelect) {
    slotSelect.addEventListener("change", toggleCustom);
    toggleCustom();
  }
  form.dataset.timeBound = "1";
}

function attachPickerHandlers() {
  const formatHints = {
    date: "年/月/日",
    "datetime-local": "年/月/日",
    time: "时:分",
  };
  document.querySelectorAll('input[type="date"], input[type="time"], input[type="datetime-local"]').forEach((input) => {
    if (input.dataset.pickerBound === "1") {
      return;
    }
    const hint = formatHints[input.type] || "";
    if (hint) {
      input.dataset.formatHint = hint;
      input.setAttribute("title", `格式：${hint}`);
      input.setAttribute("placeholder", hint);
    }
    const syncHintState = () => {
      if (!hint) {
        return;
      }
      input.classList.toggle("format-hint-empty", !input.value);
    };
    const openPicker = () => {
      if (typeof input.showPicker === "function") {
        try {
          input.showPicker();
        } catch {
          return;
        }
      }
    };
    input.addEventListener("input", syncHintState);
    input.addEventListener("change", syncHintState);
    input.addEventListener("blur", syncHintState);
    input.addEventListener("focus", openPicker);
    input.addEventListener("click", openPicker);
    syncHintState();
    input.dataset.pickerBound = "1";
  });
}

// Boot legacy UI bindings for the static pages.
async function bootLegacyUI() {
  await initRemoteStore();
  const labels = getLabels();
  initLabSelects();
  initTestLabSelects();
  initDispatchTargetSelects();
  initTestTypeSelects();
  attachManualScheduleTimeHandlers();
  attachPickerHandlers();
  attachModalHandlers();
  attachDrawerHandlers();
  attachFilterHandlers();
  attachSortHandlers();
  attachTabHandlers();
  attachActionHandlers(labels);
  renderAll(labels);
}

const shouldAutoBoot = !(typeof window !== "undefined" && window.__MES_VUE_BOOT__);
if (shouldAutoBoot) {
  onReady(bootLegacyUI);
}

if (typeof window !== "undefined") {
  window.__MES_LEGACY_BOOT__ = bootLegacyUI;
}

export { bootLegacyUI };
