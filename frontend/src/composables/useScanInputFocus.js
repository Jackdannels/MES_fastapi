import { nextTick } from "vue";

export const useScanInputFocus = (inputRef) => {
  const focusScanInput = async () => {
    await nextTick();
    const element = inputRef?.value;
    if (!element?.focus || element.disabled) {
      return false;
    }
    element.focus();
    return typeof document !== "undefined" ? document.activeElement === element : true;
  };

  return {
    focusScanInput,
  };
};
