import { computed, ref } from "vue";
import { resolveLabRef } from "@/lib/labIdentity";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { buildScheduleDragPreview, canDragSchedule, getGanttDropSlots } from "./scheduleDragModel";

function useScheduleDrag({ getContext, refreshContext, persist, onClose }) {
  const draggingScheduleId = ref("");
  const dragHoverKey = ref("");
  const dragPreview = ref(null);
  const dragSubmitting = ref(false);
  const dragMessage = ref("");
  const dragModalOpen = computed(() => Boolean(dragPreview.value));
  const dragInteractionActive = computed(() => Boolean(draggingScheduleId.value || dragPreview.value || dragSubmitting.value));
  let suppressClick = false;
  const canDrag = (id, ids) => !dragSubmitting.value && canDragSchedule(getContext(), id, ids);
  const startScheduleDrag = (event, id, ids) => {
    if (!canDrag(id, ids)) { event.preventDefault(); return; }
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
    const context = getContext();
    const lab = context.masterLabs.find(entry => resolveLabRef(entry).name === device) || { name: device };
    return { scheduleId: draggingScheduleId.value, date: slot.date, slot: slot.segment === "am" ? "morning" : "afternoon", lab };
  };
  const dragOverScheduleSlot = (event, device, slot) => {
    if (!draggingScheduleId.value || dragSubmitting.value) return;
    event.preventDefault();
    dragHoverKey.value = slot.key;
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  };
  const dropSchedule = async (event, device, slot) => {
    if (!draggingScheduleId.value || dragSubmitting.value) return;
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
    dragMessage.value = "";
    onClose();
  };
  const confirmScheduleDrag = async () => {
    if (!dragPreview.value || dragSubmitting.value) return;
    dragSubmitting.value = true;
    dragMessage.value = "";
    try {
      await refreshContext();
      const previous = dragPreview.value;
      const preview = buildScheduleDragPreview(getContext(), previous.target);
      if (preview.error) { dragMessage.value = preview.error; return; }
      if (preview.unchanged) { dragMessage.value = "该排程已被调整到目标时间，请取消并刷新查看。"; return; }
      if (JSON.stringify(preview.source) !== JSON.stringify(previous.source) || preview.startAt !== previous.startAt || preview.endAt !== previous.endAt) {
        dragPreview.value = preview;
        dragMessage.value = "排程数据已变化，已更新预览，请核对后再次确认。";
        return;
      }
      const result = preview.result;
      await persist({
        [STORAGE_KEYS.experiments]: result.experiments, [STORAGE_KEYS.schedules]: result.schedules,
        [STORAGE_KEYS.streams]: result.streams, [STORAGE_KEYS.tasks]: result.tasks,
      });
      dragPreview.value = null;
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
    closeDragPreview,
    confirmScheduleDrag,
    dragHoverKey,
    dragInteractionActive,
    dragMessage,
    dragModalOpen,
    dragOverScheduleSlot,
    dragPreview,
    dragSubmitting,
    draggingScheduleId,
    dropSchedule,
    endScheduleDrag,
    getGanttDropSlots,
    startScheduleDrag,
    suppressDragClick,
  };
}

export { useScheduleDrag };
