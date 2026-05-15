import { computed, getCurrentInstance, onBeforeUnmount, ref } from "vue";

const DEFAULT_FEEDBACK_DISMISS_MS = 10000;

function useFeedback(options = {}) {
  const message = ref("");
  const tone = ref(options.defaultTone || "info");
  let dismissTimer = null;

  const clearTimer = () => {
    if (dismissTimer && typeof window !== "undefined") {
      window.clearTimeout(dismissTimer);
    }
    dismissTimer = null;
  };

  const clear = () => {
    clearTimer();
    message.value = "";
  };

  const show = (nextMessage, nextTone = options.defaultTone || "info", showOptions = {}) => {
    clearTimer();
    message.value = String(nextMessage || "").trim();
    tone.value = String(nextTone || options.defaultTone || "info").trim() || "info";
    const dismissMs = Number.isFinite(showOptions.autoDismissMs)
      ? showOptions.autoDismissMs
      : Number.isFinite(options.autoDismissMs)
        ? options.autoDismissMs
        : DEFAULT_FEEDBACK_DISMISS_MS;

    if (message.value && dismissMs > 0 && typeof window !== "undefined") {
      dismissTimer = window.setTimeout(() => {
        message.value = "";
        dismissTimer = null;
      }, dismissMs);
    }
  };

  if (getCurrentInstance()) {
    onBeforeUnmount(clearTimer);
  }

  return {
    clear,
    message,
    show,
    tone,
    visible: computed(() => Boolean(message.value)),
  };
}

export { DEFAULT_FEEDBACK_DISMISS_MS, useFeedback };
