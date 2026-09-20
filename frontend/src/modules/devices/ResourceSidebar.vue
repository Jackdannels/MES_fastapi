<template>
  <aside class="card devices-resource-sidebar" aria-label="资源余量">
    <header class="devices-resource-heading"><h3>资源余量</h3><button class="action-link" type="button" :disabled="loading" @click="refresh">{{ loading ? '同步中…' : '刷新余量' }}</button></header>
    <p v-if="error" class="form-alert" role="alert">{{ error }}；以下可能是上次同步值。</p>
    <article v-for="resource in cards" :key="resource.key" class="devices-resource-card" :class="{ 'is-low': resource.remaining != null && resource.remaining <= resource.capacity * 0.1 }" :data-testid="`resource-${resource.key}`">
      <div class="devices-resource-heading"><span>{{ resource.name }}剩余</span><span class="devices-resource-state">{{ resource.remaining == null ? '待同步' : resource.remaining === 0 ? '已耗尽' : resource.remaining <= resource.capacity * 0.1 ? '余量偏低' : '余量充足' }}</span></div>
      <div class="devices-resource-number"><strong>{{ resource.remaining ?? '—' }}</strong><small>{{ resource.key === 'tray' ? '/ 10 个' : '基准 100' }}</small></div>
      <div class="devices-resource-meter" aria-hidden="true"><i v-for="tick in 10" :key="tick" :class="{ active: resource.remaining != null && tick <= Math.ceil(resource.remaining / resource.capacity * 10) }"></i></div>
      <div class="devices-resource-heading"><small class="muted">{{ resource.key === 'tray' ? '占用' : '累计消耗' }} {{ resource.used ?? '—' }}<template v-if="resource.replenished"> · 已补 {{ resource.replenished }}</template></small><button v-if="resource.key !== 'tray'" class="action-btn secondary" type="button" :disabled="resource.remaining == null || !!error" @click="openReplenishment(resource)">补充{{ resource.name }}</button></div>
      <p v-if="resource.deficit" class="form-alert">待补缺口 {{ resource.deficit }}</p>
    </article>
    <button class="action-btn secondary" type="button" @click="recordsOpen = true">补充记录</button>
    <p v-if="feedback" class="devices-resource-feedback" role="status">{{ feedback }}</p>
    <AppModal :open="!!selected" :title="`补充${selected?.name || ''}`" @close="closeReplenishment" @keydown.tab="trapFocus">
      <form id="resource-replenishment-form" @submit.prevent="submit">
        <div class="devices-resource-projection"><div>当前剩余<strong>{{ current?.remaining ?? '—' }}</strong></div><span>→</span><div>补充后预计<strong>{{ projected }}</strong></div></div>
        <div class="form-field"><label for="resource-quantity">本次补充数量（正整数）</label><input id="resource-quantity" v-model="quantity" type="number" min="1" max="10000" step="1" required :disabled="submitting || !!attempt" aria-describedby="resource-quantity-help resource-form-error" @blur="validate"><small id="resource-quantity-help" class="muted">单次补充 1–10,000 份。</small></div>
        <div class="form-field"><label for="resource-note">备注（选填）</label><textarea id="resource-note" v-model="note" maxlength="120" :disabled="submitting || !!attempt" placeholder="耗材批次、补充说明"></textarea></div>
        <p v-if="formError" id="resource-form-error" class="form-alert" role="alert">{{ formError }}</p>
      </form>
      <template #footer><button class="action-btn secondary" type="button" :disabled="submitting" @click="closeReplenishment">关闭</button><button class="action-btn" type="submit" form="resource-replenishment-form" :disabled="submitting">{{ submitting ? '正在补充…' : attempt ? '重试本次补充' : '确认补充' }}</button></template>
    </AppModal>
    <AppModal :open="recordsOpen" title="补充记录（最近 50 条）" @close="recordsOpen = false">
      <p v-if="!inventory?.records?.length" class="muted">暂无补充记录</p>
      <div v-for="record in inventory?.records || []" :key="record.id" class="devices-resource-record"><div class="devices-resource-heading"><strong>{{ record.resource === 'salt' ? '盐雾' : '霉菌' }} +{{ record.quantity }}</strong><span>{{ record.before }} → {{ record.after }}</span></div><small class="muted">{{ record.time }} · {{ record.operator }}</small><p>{{ record.note || '未填写备注' }}</p></div>
    </AppModal>
  </aside>
</template>

<script setup>
import { computed, nextTick, ref } from "vue";
import AppModal from "@/components/shared/AppModal.vue";
import { useResourceInventory } from "@/composables/useResourceInventory";
import { createReplenishmentRequestId, replenishResourceInventory } from "@/lib/resourceInventoryApi";

const props = defineProps({ trayResource: { type: Object, default: null } });
const { inventory, error, loading, refresh, acceptInventory } = useResourceInventory();
const selected = ref(null), quantity = ref(""), note = ref(""), submitting = ref(false), formError = ref(""), feedback = ref("");
const recordsOpen = ref(false), attempt = ref(null);
let triggerElement;
const cards = computed(() => [
  props.trayResource || { key: "tray", name: "托盘", capacity: 10, remaining: null, used: null },
  ...["salt", "mold"].map((key) => inventory.value?.resources?.find((item) => item.key === key) || { key, name: key === "salt" ? "盐雾" : "霉菌", capacity: 100, remaining: null }),
]);
const current = computed(() => cards.value.find((item) => item.key === selected.value?.key));
const isValid = computed(() => Number.isSafeInteger(Number(quantity.value)) && Number(quantity.value) > 0 && Number(quantity.value) <= 10000);
const projected = computed(() => isValid.value && current.value?.remaining != null ? Math.max(0, current.value.remaining - (current.value.deficit || 0) + Number(quantity.value)) : "—");
function validate() { formError.value = isValid.value ? "" : "请输入 1–10,000 之间的正整数"; return isValid.value; }
async function openReplenishment(resource) {
  triggerElement = document.activeElement;
  // An uncertain request survives closing/reopening the dialog, with its payload
  // frozen until retry succeeds. Do not accidentally record a second refill.
  if (attempt.value) { selected.value = cards.value.find((item) => item.key === attempt.value.resource); }
  else { selected.value = resource; quantity.value = ""; note.value = ""; formError.value = ""; }
  await nextTick();
  if (!attempt.value) document.getElementById("resource-quantity")?.focus();
}
function closeReplenishment() { if (!submitting.value) { selected.value = null; triggerElement?.focus(); } }
function trapFocus(event) {
  const elements = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
  const first = elements[0], last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
async function submit() {
  if (submitting.value || !validate()) return;
  submitting.value = true;
  try {
    attempt.value ||= { resource: selected.value.key, quantity: Number(quantity.value), note: note.value.trim(), request_id: createReplenishmentRequestId() };
    const result = await replenishResourceInventory(attempt.value);
    acceptInventory(result);
    feedback.value = `${selected.value.name}已补充 ${attempt.value.quantity}`;
    attempt.value = null; selected.value = null;
    triggerElement?.focus();
  } catch (reason) {
    formError.value = `${reason.message || '补充失败'}。请重试本次请求，不会重复入账。`;
  } finally { submitting.value = false; }
}
</script>
