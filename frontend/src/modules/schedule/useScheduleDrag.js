import { computed, ref } from "vue";
import { resolveLabRef, scheduleMatchesLab } from "@/lib/labIdentity";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { buildScheduleDragPreview, canDragSchedule, getGanttDropSlots } from "./scheduleDragModel";

function useScheduleDrag({ getContext, refreshContext, persist, onClose }) {
  const draggingScheduleId = ref("");
  const dragHoverKey = ref("");
  const dragPreview = ref(null);
  const dragSubmitting = ref(false);
  const dragMessage = ref("");
  const dragConflictOpen = ref(false);
  const dragModalOpen = computed(() => Boolean(dragPreview.value) && !dragConflictOpen.value);
  const dragInteractionActive = computed(() => Boolean(draggingScheduleId.value || dragPreview.value || dragSubmitting.value));
  let suppressClick = false;
  const canDrag = (id, ids) => !dragSubmitting.value && canDragSchedule(getContext(), id, ids);
  const draggingSchedule = computed(() => getContext().schedules.find(row => String(row.id) === String(draggingScheduleId.value)));
  const draggingLabName = computed(() => resolveLabRef(draggingSchedule.value).name);
  const resolveTargetLab = (device) => (getContext().masterLabs || []).find(entry => resolveLabRef(entry).name === device) || { name: device };
  const canDropScheduleOnLab = device => Boolean(draggingSchedule.value && scheduleMatchesLab(draggingSchedule.value, resolveTargetLab(device)));
  const startScheduleDrag = (event, id, ids) => {
    if (dragInteractionActive.value || !canDrag(id, ids)) { event.preventDefault(); return; }
    draggingScheduleId.value = id;
    dragMessage.value = "";
    suppressClick = true;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  };
  const endScheduleDrag = () => {
    draggingScheduleId.value = "";
    dragHoverKey.value = "";
    window.setTimeout(() => {
      suppressClick = false;
      if (!dragPreview.value && !dragSubmitting.value) onClose();
    }, 0);
  };
  const suppressDragClick = event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); }
  };
  const resolveTarget = (device, slot) => {
    const lab = resolveTargetLab(device);
    return { scheduleId: draggingScheduleId.value, date: slot.date, slot: slot.segment === "am" ? "morning" : "afternoon", lab };
  };
  const dragOverScheduleSlot = (event, device, slot) => {
    if (!draggingScheduleId.value || dragSubmitting.value) return;
    if (!canDropScheduleOnLab(device)) {
      dragHoverKey.value = "";
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    dragHoverKey.value = slot.key;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };
  const dropSchedule = async (event, device, slot) => {
    if (!draggingScheduleId.value || dragSubmitting.value) return;
    if (!canDropScheduleOnLab(device)) return;
    event.preventDefault();
    const target = resolveTarget(device, slot);
    endScheduleDrag();
    dragSubmitting.value = true;
    dragMessage.value = "正在读取最新排程…";
    try {
      await refreshContext();
      const preview = buildScheduleDragPreview(getContext(), target);
      if (preview.error) dragMessage.value = preview.error;
      else if (preview.unchanged) dragMessage.value = "排程时间未发生变化。";
      else {
        dragPreview.value = preview;
        dragConflictOpen.value = Boolean(preview.taskConflict);
        dragMessage.value = "";
      }
    } catch (error) {
      dragMessage.value = `无法读取最新排程，移动未保存：${error.message || "请重试"}`;
    } finally {
      dragSubmitting.value = false;
    }
  };
  const closeDragPreview = () => {
    if (dragSubmitting.value) return;
    dragPreview.value = null;
    dragConflictOpen.value = false;
    dragMessage.value = "";
    onClose();
  };
  const confirmScheduleDrag = async ({ confirmTaskConflict = false } = {}) => {
    if (!dragPreview.value || dragSubmitting.value) return;
    dragSubmitting.value = true;
    dragMessage.value = "";
    try {
      await refreshContext();
      const previous = dragPreview.value;
      const preview = buildScheduleDragPreview(getContext(), previous.target);
      if (preview.error) { dragMessage.value = preview.error; return; }
      if (preview.unchanged) { dragMessage.value = "该排程已被调整到目标时间，请取消并刷新查看。"; return; }
      const conflictChanged = JSON.stringify(preview.taskConflict) !== JSON.stringify(previous.taskConflict);
      if (JSON.stringify(preview.source) !== JSON.stringify(previous.source) || preview.startAt !== previous.startAt || preview.endAt !== previous.endAt || conflictChanged) {
        dragPreview.value = preview;
        dragConflictOpen.value = Boolean(preview.taskConflict);
        dragMessage.value = "排程数据已变化，已更新预览及冲突提示，请核对后再次确认。";
        return;
      }
      if (preview.taskConflict && !confirmTaskConflict) {
        dragConflictOpen.value = true;
        return;
      }
      const result = preview.result;
      await persist({
        [STORAGE_KEYS.experiments]: result.experiments, [STORAGE_KEYS.schedules]: result.schedules,
        [STORAGE_KEYS.streams]: result.streams, [STORAGE_KEYS.tasks]: result.tasks,
      });
      dragPreview.value = null;
      dragConflictOpen.value = false;
      dragMessage.value = "排程已移动并保存。";
    } catch (error) {
      dragMessage.value = `移动未保存：${error.message || "请重试"}`;
    } finally {
      dragSubmitting.value = false;
      if (!dragPreview.value) onClose();
    }
  };
  return {
    canDragSchedule: canDrag,
    canDropScheduleOnLab,
    closeDragPreview,
    confirmScheduleDrag,
    confirmDragConflict: () => confirmScheduleDrag({ confirmTaskConflict: true }),
    dragConflictOpen,
    dragHoverKey,
    dragInteractionActive,
    dragMessage,
    dragModalOpen,
    dragOverScheduleSlot,
    dragPreview,
    dragSubmitting,
    draggingScheduleId,
    draggingLabName,
    dropSchedule,
    endScheduleDrag,
    getGanttDropSlots,
    startScheduleDrag,
    suppressDragClick,
  };
}

export { useScheduleDrag };
