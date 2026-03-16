import { ref } from "vue";

function useDialogState(initialPayload = null) {
  const open = ref(false);
  const payload = ref(initialPayload);

  const openWith = (nextPayload = null) => {
    payload.value = nextPayload;
    open.value = true;
  };

  const close = () => {
    open.value = false;
    payload.value = null;
  };

  return {
    close,
    open,
    openWith,
    payload,
  };
}

export { useDialogState };
