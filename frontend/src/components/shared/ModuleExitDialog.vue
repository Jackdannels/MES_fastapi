<template>
  <AppModal :open="open" title="退出登录" @close="handleClose">
    <div class="form-grid">
      <label class="form-field">
        <span>切换界面</span>
        <select v-model="selectedModule" class="search-input" data-testid="module-exit-select">
          <option v-for="option in moduleOptions" :key="option.key" :value="option.key">
            {{ option.label }}
          </option>
        </select>
      </label>
    </div>
    <AppFeedback :message="errorMessage" tone="warning" @close="errorMessage = ''" />
    <template #footer>
      <button class="action-btn secondary" data-testid="module-exit-cancel" type="button" @click="handleClose">取消</button>
      <button class="action-btn danger" data-testid="module-exit-logout" type="button" @click="handleLogout">彻底退出</button>
      <button class="action-btn" data-testid="module-exit-switch" type="button" @click="handleSwitch">切换其他界面</button>
    </template>
  </AppModal>
</template>

<script setup>
import { ref, watch } from "vue";
import AppFeedback from "@/components/shared/AppFeedback.vue";

import { MODULE_OPTIONS } from "@/lib/moduleCatalog";
import AppModal from "./AppModal.vue";

const props = defineProps({
  currentModule: {
    type: String,
    default: "central",
  },
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close", "logout", "switch-module"]);

const moduleOptions = MODULE_OPTIONS;
const selectedModule = ref(props.currentModule);
const errorMessage = ref("");

watch(
  () => [props.currentModule, props.open],
  ([currentModule, open]) => {
    selectedModule.value = currentModule || "central";
    if (open) {
      errorMessage.value = "";
    }
  },
  { immediate: true },
);

const handleClose = () => {
  errorMessage.value = "";
  emit("close");
};

const handleLogout = () => {
  errorMessage.value = "";
  emit("logout");
};

const handleSwitch = () => {
  if (selectedModule.value === props.currentModule) {
    errorMessage.value = "请选择其他界面";
    return;
  }

  errorMessage.value = "";
  emit("switch-module", selectedModule.value);
};
</script>
