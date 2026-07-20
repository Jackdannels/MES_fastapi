import { h, onMounted, onUnmounted, ref } from "vue";

const scheduleStateLabel = (state) => {
  const normalized = String(state || "").trim();
  if (normalized === "running") {
    return "进行中";
  }
  if (normalized === "conflict") {
    return "冲突";
  }
  if (normalized === "maintenance-conflict") {
    return "维修冲突";
  }
  if (normalized === "completed") {
    return "已完成";
  }
  if (normalized === "idle") {
    return "空闲";
  }
  if (normalized === "maintenance") {
    return "维修中";
  }
  if (normalized === "disabled") {
    return "停用";
  }
  return "已排程";
};

const compactTimeRange = (value) => {
  const matches = String(value || "").match(/\d{2}:\d{2}/g) || [];
  return matches.length >= 2 ? `${matches[0]}-${matches.at(-1)}` : String(value || "").trim();
};

const SCHEDULE_SLOT_ROTATION_INTERVAL_MS = 4200;

const scheduleSlotTaskColor = (slot, item = null) =>
  String(item?.color || slot?.taskColor || slot?.items?.find((candidate) => candidate?.color)?.color || "").trim();

const renderScheduleItem = (item, slot, compact) =>
  h("div", { class: "visual-schedule-task", style: item?.color || slot.taskColor ? { "--schedule-task-color": item?.color || slot.taskColor } : null }, [
    h("strong", item?.taskCode || slot.label || "-"),
    compact ? null : h("span", item?.experimentLabel || "-"),
    h("small", compactTimeRange(item?.timeRange || slot.title)),
  ]);

const renderScheduleSlot = (slot, compact, cycleTick = 0) => {
  const allItems = Array.isArray(slot?.allItems) && slot.allItems.length ? slot.allItems : [];
  const items = allItems.length ? allItems : Array.isArray(slot?.items) ? slot.items : [];
  const rotatesItems = !compact && items.length > 1;
  const activeItem = items.length ? items[rotatesItems ? cycleTick % items.length : 0] : null;
  const visibleItems = activeItem ? [activeItem] : [];
  const stateLabel = scheduleStateLabel(slot.state);
  const normalizedState = String(slot?.state || "").trim();
  const isPlainCell = stateLabel === "已排程" || stateLabel === "空闲";
  const hidesStateBadge = normalizedState === "running";
  const isStatusOnlyCell = visibleItems.length === 0 && ["maintenance", "disabled"].includes(normalizedState);
  const taskColor = scheduleSlotTaskColor(slot, activeItem);
  return h("div", { "aria-label": rotatesItems ? `同一时段共${items.length}项排程，正在轮播第${cycleTick % items.length + 1}项` : undefined, class: ["visual-schedule-slot", `state-${slot.state || "idle"}`, stateLabel === "已排程" ? "is-planned" : "", stateLabel === "空闲" ? "is-idle" : "", slot.displayMode === "conflict" ? "is-conflict" : "", rotatesItems ? "has-rotating-items" : ""], style: taskColor ? { "--schedule-task-color": taskColor } : null }, [
    isPlainCell || isStatusOnlyCell || hidesStateBadge ? null : h("div", { class: "visual-schedule-slot-state" }, stateLabel),
    ...(visibleItems.length
      ? visibleItems.map((item) => renderScheduleItem(item, slot, compact))
      : isStatusOnlyCell
        ? [h("div", { class: "visual-schedule-status-only" }, stateLabel)]
        : slot.state !== "idle"
        ? [h("div", { class: "visual-schedule-task", style: slot.taskColor ? { "--schedule-task-color": slot.taskColor } : null }, [h("strong", slot.label || "-"), h("small", compactTimeRange(slot.title))])]
        : [h("div", { class: "visual-schedule-idle" }, "空闲")]),
    rotatesItems
      ? h("div", { "aria-hidden": "true", class: "visual-schedule-cycle-lights" }, items.map((item, index) =>
        h("span", { class: ["visual-schedule-cycle-light", index === cycleTick % items.length ? "is-active" : ""], key: item?.scheduleId || item?.taskCode || index }),
      ))
      : slot.overflowCount > 0 ? h("div", { class: "visual-schedule-overflow" }, `+${slot.overflowCount}`) : null,
  ]);
};

export const LabScheduleScreen = {
  name: "LabScheduleScreen",
  props: {
    compact: { type: Boolean, default: false },
    interactive: { type: Boolean, default: false },
    scheduleView: { type: Object, required: true },
    screen: { type: Object, required: false, default: null },
  },
  emits: ["schedule-today", "schedule-window"],
  setup(props, { emit }) {
    const scheduleCycleTick = ref(0);
    let scheduleCycleTimer = null;

    onMounted(() => {
      if (!props.compact && typeof window !== "undefined") {
        scheduleCycleTimer = window.setInterval(() => {
          scheduleCycleTick.value += 1;
        }, SCHEDULE_SLOT_ROTATION_INTERVAL_MS);
      }
    });

    onUnmounted(() => {
      if (scheduleCycleTimer) {
        window.clearInterval(scheduleCycleTimer);
        scheduleCycleTimer = null;
      }
    });

    return () => {
      const view = props.scheduleView || { dayCounts: [], days: [], rows: [], summary: {} };
      const rows = Array.isArray(view.rows) ? view.rows.slice(0, props.compact ? 5 : 10) : [];
      return h("div", { class: ["visual-board", "visual-schedule-board", props.compact ? "is-compact" : ""] }, [
        h("div", { class: "visual-board-top" }, [
          h("div", { class: "visual-board-title-group" }, [
            h("div", { class: "visual-board-kicker" }, "SCHEDULE MATRIX"),
            h("div", { class: "visual-board-title" }, props.screen?.name || "三日实验室排期屏"),
          ]),
          h("div", { class: "visual-schedule-head-actions" }, [
            props.interactive && !props.compact
              ? h("div", { class: "visual-schedule-nav", "aria-label": "切换排期日期窗口" }, [
                h(
                  "button",
                  {
                    "aria-label": "回到今日排期",
                    "data-testid": "visual-schedule-today",
                    type: "button",
                    onClick: () => emit("schedule-today"),
                  },
                  "今",
                ),
                h(
                  "button",
                  {
                    "aria-label": "查看前三日排期",
                    "data-testid": "visual-schedule-prev",
                    type: "button",
                    onClick: () => emit("schedule-window", "previous"),
                  },
                  "‹",
                ),
                h(
                  "button",
                  {
                    "aria-label": "查看后三日排期",
                    "data-testid": "visual-schedule-next",
                    type: "button",
                    onClick: () => emit("schedule-window", "next"),
                  },
                  "›",
                ),
              ])
              : null,
            h("div", { class: ["visual-board-live", "tone-sync"] }, "三日窗口"),
          ]),
        ]),
        h("div", { class: "visual-schedule-main" }, [
          h("div", { class: "visual-board-metrics visual-schedule-metrics" }, [
            h("div", [h("span", "三日排程"), h("strong", view.summary?.total ?? 0)]),
            h("div", [h("span", "进行中"), h("strong", view.summary?.running ?? 0)]),
            h("div", [h("span", "冲突"), h("strong", view.summary?.conflicts ?? 0)]),
            props.compact ? null : h("div", [h("span", "空闲实验室"), h("strong", view.summary?.idleLabs ?? 0)]),
          ]),
          h("div", { class: "visual-schedule-days" }, (view.dayCounts || []).map((day) =>
            h("div", { class: "visual-schedule-day", key: day.key }, [
              h("strong", day.dateLabel || day.label),
              h("small", `${day.count} 项`),
            ]),
          )),
          h("div", { class: "visual-schedule-grid", style: { "--visual-schedule-row-count": String(Math.max(rows.length, 1)) } }, [
            h("div", { class: "visual-schedule-grid-head visual-schedule-lab-head" }, "实验室"),
            ...(view.days || []).flatMap((day) => [
              h("div", { class: "visual-schedule-grid-head", key: `${day.key}-am` }, `${day.dateLabel || day.label} 上午`),
              h("div", { class: "visual-schedule-grid-head", key: `${day.key}-pm` }, `${day.dateLabel || day.label} 下午`),
            ]),
            ...(rows.length
              ? rows.flatMap((row) => [
                h("div", { class: "visual-schedule-lab-name", key: `${row.device}-name` }, row.device),
                ...row.slots.map((slot) => h("div", { class: "visual-schedule-cell", key: slot.key }, renderScheduleSlot(slot, props.compact, scheduleCycleTick.value))),
              ])
              : [h("div", { class: "visual-schedule-empty" }, "暂无排期")]),
          ]),
        ]),
      ]);
    };
  },
};

