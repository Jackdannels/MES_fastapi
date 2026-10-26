import { nextTick } from "vue";
import { iconPaths } from "@/components/shared/iconPaths";

const states = new WeakMap();
const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_BOUNDARY = ".page-header,.card,.section,.sample-flow-card";

function resolveBoundary(element, options) {
  return element.closest(options.boundary || DEFAULT_BOUNDARY) || element.parentElement;
}

function observeTargets(element, state) {
  if (!state.observer) return;
  const textTarget = state.options.textTarget ? element.querySelector(state.options.textTarget) : null;
  for (const target of new Set([element, state.boundary, element.querySelector(".nav-link-label"), textTarget].filter(Boolean))) state.observer.observe(target);
}

// Read text nodes only: the decorative SVG must never affect text measurement.
function textBounds(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const boxes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim() || node.parentElement?.closest("[data-app-icon]")) continue;
    const range = document.createRange();
    if (typeof range.getClientRects !== "function") return null;
    range.selectNodeContents(node);
    boxes.push(...Array.from(range.getClientRects()).filter((box) => box.width > 1 && box.height > 1));
  }
  if (!boxes.length) return null;
  return {
    left: Math.min(...boxes.map((box) => box.left)),
    right: Math.max(...boxes.map((box) => box.right)),
    top: Math.min(...boxes.map((box) => box.top)),
    bottom: Math.max(...boxes.map((box) => box.bottom)),
  };
}

const overlaps = (a, b) => a.left < b.right + 3 && a.right > b.left - 3 && a.top < b.bottom + 2 && a.bottom > b.top - 2;

function restoreButtonLabel(element, state) {
  if (!state.label) return;
  if (state.label.parentNode === element) {
    while (state.label.firstChild) element.insertBefore(state.label.firstChild, state.label);
    state.label.remove();
  }
  state.label = null;
}

function centerButtonLabel(element, state, rect, style) {
  const label = document.createElement("span");
  label.setAttribute("data-app-icon-label", "");
  Object.assign(label.style, { display: "inline-block", flex: "0 0 auto", lineHeight: "inherit", whiteSpace: "inherit" });
  const nodes = Array.from(element.childNodes).filter((node) => node !== state.svg);
  element.insertBefore(label, state.svg);
  label.append(...nodes);
  state.label = label;

  // A wrapper must not alter the button's intrinsic outer dimensions.
  const wrapped = element.getBoundingClientRect();
  const text = textBounds(element);
  if (!text || Math.abs(wrapped.width - rect.width) > 0.1 || Math.abs(wrapped.height - rect.height) > 0.1) {
    restoreButtonLabel(element, state);
    return null;
  }
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  const innerWidth = rect.width - borderLeft - borderRight;
  const textWidth = text.right - text.left;
  const gap = 6;
  const size = [16, 13].find((candidate) => textWidth + candidate + gap <= innerWidth - 16);
  if (!size || rect.height < 32) {
    restoreButtonLabel(element, state);
    return null;
  }
  const groupWidth = textWidth + size + gap;
  const left = rect.left + borderLeft + (innerWidth - groupWidth) / 2;
  const desiredTextLeft = left + size + gap;
  label.style.transform = `translateX(${desiredTextLeft - text.left}px)`;
  return { size, left, top: rect.top + (rect.height - size) / 2 };
}

function updateIcon(element, state) {
  if (!state.active) return;
  const options = state.options;
  const path = iconPaths[options.name];
  const svg = state.svg;
  svg.style.display = "none";
  restoreButtonLabel(element, state);
  if (!path || element.disabled || element.closest(".is-hidden,[hidden]")) return;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || style.visibility === "hidden") return;
  const textElement = options.textTarget ? element.querySelector(options.textTarget) || element : element;
  const text = textBounds(textElement);
  if (!text) return;
  if (element.querySelector("svg:not([data-app-icon])")) return;
  const placement = options.placement || "title";
  let size;
  let left;
  let top;
  if (placement === "nav") {
    size = 16;
    left = rect.right - 12 - size;
    top = rect.top + (rect.height - size) / 2;
    if (text.right + 10 >= left) return;
  } else if (placement === "button") {
    const centered = centerButtonLabel(element, state, rect, style);
    if (!centered) return;
    ({ size, left, top } = centered);
  } else {
    size = element.matches("h1") ? 24 : 18;
    left = text.right + 10;
    top = (text.top + text.bottom - size) / 2;
    const boundary = state.boundary;
    const edge = boundary.getBoundingClientRect();
    if (left + size > edge.right - 12) return;
    const box = { left, right: left + size, top, bottom: top + size };
    const controls = boundary.querySelectorAll("button,input,select,.action-btn,.visual-lab-state,.status,.attendance-chip");
    if (Array.from(controls).some((control) => overlaps(box, control.getBoundingClientRect()))) return;
  }
  if (left < 0 || left + size > document.documentElement.scrollWidth - 2) {
    restoreButtonLabel(element, state);
    return;
  }
  if (style.position === "static") {
    if (!state.positionChanged) state.originalPosition = element.style.position;
    state.positionChanged = true;
    element.style.position = "relative";
  }
  if (state.name !== options.name) {
    svg.innerHTML = path;
    svg.setAttribute("data-app-icon", options.name);
    state.name = options.name;
  }
  Object.assign(svg.style, {
    display: "block",
    left: `${left - rect.left - element.clientLeft}px`,
    top: `${top - rect.top - element.clientTop}px`,
    width: `${size}px`,
    height: `${size}px`,
    color: placement === "button" ? "currentColor" : "var(--accent)",
  });
}

function schedule(element, state) {
  if (state.scheduled || !state.active) return;
  state.scheduled = true;
  void nextTick(() => {
    state.scheduled = false;
    updateIcon(element, state);
  });
}

// Opt in at each supported heading/control. No global DOM scan or mutation listener.
export const vAppIcon = {
  mounted(element, binding) {
    const svg = document.createElementNS(SVG_NS, "svg");
    for (const [name, value] of Object.entries({
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", "data-app-icon": "",
    })) svg.setAttribute(name, value);
    Object.assign(svg.style, { position: "absolute", display: "none", pointerEvents: "none" });
    element.append(svg);
    const options = binding.value || {};
    const boundary = resolveBoundary(element, options);
    const state = { svg, boundary, options, active: true, scheduled: false, name: "" };
    states.set(element, state);
    if (typeof ResizeObserver !== "undefined") {
      state.observer = new ResizeObserver(() => schedule(element, state));
      observeTargets(element, state);
    }
    schedule(element, state);
    void document.fonts?.ready?.then(() => schedule(element, state));
  },
  beforeUpdate(element) {
    const state = states.get(element);
    if (state) restoreButtonLabel(element, state);
  },
  updated(element, binding) {
    const state = states.get(element);
    if (!state) return;
    const previousTextTarget = state.options.textTarget;
    state.options = binding.value || {};
    const boundary = resolveBoundary(element, state.options);
    if (boundary !== state.boundary || previousTextTarget !== state.options.textTarget) {
      state.boundary = boundary;
      state.observer?.disconnect();
      observeTargets(element, state);
    }
    // Vue textContent updates may replace the decorative node.
    if (!element.contains(state.svg)) element.append(state.svg);
    schedule(element, state);
  },
  beforeUnmount(element) {
    const state = states.get(element);
    if (!state) return;
    state.active = false;
    state.observer?.disconnect();
    restoreButtonLabel(element, state);
    state.svg.remove();
    if (state.positionChanged && element.style.position === "relative") element.style.position = state.originalPosition;
    states.delete(element);
  },
};
