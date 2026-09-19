<template>
  <Teleport to="body">
    <AppModal
      :open="state.open"
      title="管理员认证"
      class="task-admin-auth-modal"
      content-class="task-admin-auth-content"
      data-testid="task-admin-auth-modal"
      :show-close="!state.submitting"
      @close="cancelTaskAdminAction"
      @keydown.esc.stop.prevent="cancelTaskAdminAction"
      @keydown.tab="trapFocus"
    >
      <p class="muted">即将执行：{{ state.action }}。请确认管理员凭据后继续。</p>
      <form @submit.prevent="confirmTaskAdminAction">
        <fieldset class="task-admin-auth-fields" :disabled="state.submitting">
          <div class="form-field">
            <label for="task-admin-username">管理员账号</label>
            <input id="task-admin-username" ref="usernameInput" v-model="state.adminUsername" data-testid="task-admin-username" type="text" autocomplete="username" />
          </div>
          <div class="form-field">
            <label for="task-admin-password">管理员密码</label>
            <input id="task-admin-password" v-model="state.adminPassword" data-testid="task-admin-password" type="password" autocomplete="current-password" />
          </div>
        </fieldset>
        <div aria-live="assertive">
          <AppFeedback :message="state.error" tone="error" :auto-dismiss-ms="0" data-testid="task-admin-error" @close="state.error = ''" />
        </div>
        <div class="form-actions">
          <button class="action-btn" data-testid="task-admin-confirm" type="submit" :disabled="state.submitting" :aria-busy="state.submitting">{{ state.submitting ? "认证并执行中…" : "认证并执行" }}</button>
          <button class="action-btn secondary" data-testid="task-admin-cancel" type="button" :disabled="state.submitting" @click="cancelTaskAdminAction">取消</button>
        </div>
      </form>
    </AppModal>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import AppModal from "./AppModal.vue";
import AppFeedback from "./AppFeedback.vue";
import { taskAdminAuthState as state, confirmTaskAdminAction, cancelTaskAdminAction } from "@/lib/taskAdminAuth";

const usernameInput = ref(null);
let triggerElement = null;
const trapFocus = (event) => {
  const controls = [...event.currentTarget.querySelectorAll("input:not(:disabled), button:not(:disabled)")];
  if (!controls.length) { event.preventDefault(); return; }
  const index = controls.indexOf(document.activeElement);
  if (event.shiftKey && index <= 0) {
    event.preventDefault();
    controls.at(-1).focus();
  } else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) {
    event.preventDefault();
    controls[0].focus();
  }
};
watch(() => state.open, async (open) => {
  if (open) {
    triggerElement = document.activeElement;
    await nextTick();
    usernameInput.value?.focus();
  } else {
    triggerElement?.focus?.();
  }
});
onBeforeUnmount(cancelTaskAdminAction);
</script>

<style>
.modal.task-admin-auth-modal { z-index: 1400; }
.modal-content.task-admin-auth-content { width: min(480px, calc(100vw - 32px)); }
.task-admin-auth-fields { display: grid; gap: 14px; border: 0; padding: 0; margin: 0; min-width: 0; }
.task-admin-auth-content .form-actions { flex-wrap: wrap; }
.task-admin-auth-content p { overflow-wrap: anywhere; }
</style>
