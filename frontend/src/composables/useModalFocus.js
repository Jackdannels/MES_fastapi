import { nextTick, onBeforeUnmount, watch } from "vue";

const modalStack = [];
const focusableSelector = [
  "button:not(:disabled)", "a[href]", "input:not(:disabled):not([type='hidden'])",
  "select:not(:disabled)", "textarea:not(:disabled)", "summary",
  "[contenteditable='true']", "[tabindex]",
].join(",");

const canFocus = (element) => {
  if (!element?.isConnected || element.matches(":disabled") || element.tabIndex < 0) {
    return false;
  }
  for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.inert || style.display === "none" || style.visibility === "hidden") {
      return false;
    }
  }
  return true;
};

export const useModalFocus = (dialogElement, open) => {
  const scope = { element: () => dialogElement.value };
  let triggerElement = null;
  let activation = 0;
  const isTopModal = () => modalStack.at(-1) === scope;
  const controls = () => [...(dialogElement.value?.querySelectorAll(focusableSelector) || [])].filter(canFocus);
  const focusFirst = () => (controls()[0] || dialogElement.value)?.focus({ preventScroll: true });

  const handleFocus = (event) => {
    if (isTopModal() && !dialogElement.value?.contains(event.target)) {
      focusFirst();
    }
  };

  const handleTab = (event) => {
    if (event.key !== "Tab" || !isTopModal()) {
      return;
    }
    const elements = controls();
    const first = elements[0];
    const last = elements.at(-1);
    const active = document.activeElement;
    if (!first) {
      event.preventDefault();
      dialogElement.value?.focus({ preventScroll: true });
    } else if (!dialogElement.value?.contains(active) || active === dialogElement.value
      || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    }
  };

  const release = () => {
    const wasTop = isTopModal();
    const index = modalStack.indexOf(scope);
    if (index >= 0) {
      modalStack.splice(index, 1);
    }
    document.removeEventListener("keydown", handleTab, true);
    document.removeEventListener("focusin", handleFocus, true);
    if (wasTop) {
      const parent = modalStack.at(-1)?.element();
      if (canFocus(triggerElement) && (!parent || parent.contains(triggerElement))) {
        triggerElement.focus({ preventScroll: true });
      } else if (parent) {
        parent.focus({ preventScroll: true });
      }
    }
    triggerElement = null;
  };

  watch(open, async (isOpen) => {
    const currentActivation = ++activation;
    if (!isOpen) {
      release();
      return;
    }
    triggerElement = document.activeElement;
    await nextTick();
    if (currentActivation !== activation || !open.value || !dialogElement.value?.isConnected) {
      return;
    }
    modalStack.push(scope);
    document.addEventListener("keydown", handleTab, true);
    document.addEventListener("focusin", handleFocus, true);
    // A consumer may already have focused its preferred input on this tick.
    if (!dialogElement.value.contains(document.activeElement)) {
      focusFirst();
    }
  }, { immediate: true, flush: "post" });

  onBeforeUnmount(() => {
    activation += 1;
    release();
  });

  return { isTopModal };
};
