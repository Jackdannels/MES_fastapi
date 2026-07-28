import { h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { formatLocalDateTime } from "@/lib/dateTime";
import { serverNowMs } from "@/lib/serverClock";

const normalizeVisualText = (value) => String(value || "").trim();
const formatLoginTimeLabel = (value) => {
  const text = normalizeVisualText(value);
  if (!text) {
    return "";
  }
  const formatted = formatLocalDateTime(text) || text;
  if (formatted.length >= 16) {
    return `${formatted.slice(11, 16)}登录`;
  }
  return `${formatted}登录`;
};
const formatCountdownDuration = (totalSeconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(safeSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};
const buildLiveCountdown = (countdown, nowMs) => {
  if (!countdown?.active) {
    return countdown || { active: false, progressPercent: 0, remainingLabel: "" };
  }
  const startTime = Number(countdown.startTime);
  const endTime = Number(countdown.endTime);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return countdown;
  }
  const remainingSeconds = Math.floor((endTime - nowMs) / 1000);
  const duration = endTime - startTime;
  const elapsed = Math.min(duration, Math.max(0, nowMs - startTime));
  return {
    ...countdown,
    progressPercent: Math.min(100, Math.max(0, (elapsed / duration) * 100)),
    remainingLabel: remainingSeconds >= 0
      ? formatCountdownDuration(remainingSeconds)
      : `已超时 ${formatCountdownDuration(Math.abs(remainingSeconds))}`,
    remainingSeconds,
  };
};

export const CurrentLabTasksScreen = {
  name: "CurrentLabTasksScreen",
  props: {
    screen: { type: Object, required: false, default: null },
    currentLabTaskView: { type: Object, required: false, default: null },
    attendanceSessions: { type: Array, required: false, default: () => [] },
    compact: { type: Boolean, default: false },
  },
  setup(props) {
    const matrixRoot = ref(null);
    const scrollingLabs = ref(new Set());
    const liveNowMs = ref(serverNowMs());
    let clockTimer = null;
    let resizeObserver = null;
    let refreshQueued = false;

    const refreshTrayLoops = () => {
      const root = matrixRoot.value;
      if (!root) {
        return;
      }
      const nextScrollingLabs = new Set();
      root.querySelectorAll(".tray-panel[data-lab-name]").forEach((panel) => {
        const labName = panel.dataset.labName || "";
        const realCount = Number(panel.dataset.trayCount || 0);
        const viewport = panel.querySelector(".tray-viewport");
        const list = panel.querySelector(".tray-list");
        if (!labName || !viewport || !list || realCount <= 0) {
          return;
        }
        const isCurrentlyLooping = panel.classList.contains("is-scrollable");
        const singleCycleHeight = list.scrollHeight / (isCurrentlyLooping ? 2 : 1);
        if (singleCycleHeight > viewport.clientHeight + 1) {
          nextScrollingLabs.add(labName);
        }
      });
      const previous = scrollingLabs.value;
      const unchanged = previous.size === nextScrollingLabs.size && Array.from(previous).every((labName) => nextScrollingLabs.has(labName));
      if (!unchanged) {
        scrollingLabs.value = nextScrollingLabs;
      }
    };

    const queueRefreshTrayLoops = () => {
      if (typeof window === "undefined" || refreshQueued) {
        return;
      }
      refreshQueued = true;
      nextTick(() => {
        window.requestAnimationFrame(() => {
          refreshQueued = false;
          refreshTrayLoops();
        });
      });
    };

    onMounted(() => {
      queueRefreshTrayLoops();
      clockTimer = window.setInterval(() => {
        liveNowMs.value = serverNowMs();
      }, 1000);
      if (typeof ResizeObserver !== "undefined" && matrixRoot.value) {
        resizeObserver = new ResizeObserver(queueRefreshTrayLoops);
        resizeObserver.observe(matrixRoot.value);
      } else if (typeof window !== "undefined") {
        window.addEventListener("resize", queueRefreshTrayLoops);
      }
    });

    onUnmounted(() => {
      if (clockTimer) {
        window.clearInterval(clockTimer);
        clockTimer = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      } else if (typeof window !== "undefined") {
        window.removeEventListener("resize", queueRefreshTrayLoops);
      }
    });

    watch(() => props.currentLabTaskView, queueRefreshTrayLoops, { deep: true, flush: "post" });

    const renderLabCard = (lab) => {
      const attendanceSession = (Array.isArray(props.attendanceSessions) ? props.attendanceSessions : [])
        .find((session) => normalizeVisualText(session?.labName || session?.lab_name) === normalizeVisualText(lab.labName));
      const attendanceName = normalizeVisualText(attendanceSession?.employeeName || attendanceSession?.employee_name || attendanceSession?.username);
      const attendanceLoginTime = formatLoginTimeLabel(attendanceSession?.loggedInAt || attendanceSession?.logged_in_at);
      const previewToneClass = lab.statusTone === "running"
        ? "running"
        : lab.statusTone === "urgent"
          ? "near"
          : lab.statusTone === "completed"
            ? "completed"
          : ["repair", "maintenance", "upkeep"].includes(lab.statusTone)
            ? lab.statusTone
            : lab.statusTone === "task" || lab.statusTone === "scheduled"
              ? "planned"
              : "";
      const trayCodes = Array.isArray(lab.trayCodes) ? lab.trayCodes.filter(Boolean) : [];
      const trayItems = Array.isArray(lab.trayItems) && lab.trayItems.length
        ? lab.trayItems
        : trayCodes.map((trayCode) => ({
          sampleLabel: lab.sampleCount > 0 && trayCodes.length === 1 ? `${lab.sampleCount}件` : "-",
          trayCode,
        }));
      const shouldLoopTrays = scrollingLabs.value.has(lab.labName);
      const visibleTrayItems = shouldLoopTrays ? [...trayItems, ...trayItems] : trayItems;
      const countdown = buildLiveCountdown(lab.countdown || {}, liveNowMs.value);
      const shouldBlink = lab.shouldBlink || (countdown.active && countdown.remainingSeconds >= 0 && countdown.remainingSeconds <= 5 * 60);
      return h(
        "article",
        {
          class: ["card", previewToneClass, shouldBlink ? "is-blinking" : ""],
          "data-lab-name": lab.labName,
          "data-testid": "lab-matrix-card",
          key: lab.labName,
          style: countdown.active ? { "--current-task-progress": `${countdown.progressPercent || 0}%` } : {},
        },
        [
          h("div", { class: "card-head" }, [
            h("h2", lab.labName),
            h(
              "span",
              { class: ["attendance-chip", attendanceName ? "is-active" : "is-empty"] },
              attendanceName ? `${attendanceName}${attendanceLoginTime ? ` · ${attendanceLoginTime}` : ""}` : "未登录",
            ),
            h("span", { class: "badge" }, lab.statusLabel || "-"),
          ]),
          h("div", { class: "card-body" }, [
            h("div", { class: "left" }, [
              h("div", { class: "info" }, [h("label", "当前选择任务"), h("strong", lab.taskCode || "-")]),
              h("div", { class: "info" }, [h("label", "试验项目"), h("strong", lab.experimentName || "-")]),
              h("div", { class: "info" }, [h("label", "阶段"), h("strong", lab.stageLabel || "-")]),
              h("div", { class: "info time" }, [h("label", "计划时间"), h("strong", lab.planTimeLabel || "-")]),
            ]),
            h("div", { class: ["tray-panel", shouldLoopTrays ? "is-scrollable" : ""], "data-lab-name": lab.labName, "data-tray-count": String(trayItems.length) }, [
              h("div", { class: "tray-title-wrap" }, [
                h("span", { class: "tray-title" }, "托盘/样品"),
                shouldLoopTrays ? h("span", { class: "scroll-hint" }, "循环播放") : null,
              ]),
              trayItems.length
                ? h("div", { class: ["tray-viewport", shouldLoopTrays ? "is-looping is-scrollable" : ""] }, [
                  h(
                    "div",
                    {
                      class: ["tray-list", shouldLoopTrays ? "is-looping" : ""],
                      style: shouldLoopTrays ? { "--current-tray-loop-duration": `${Math.max(14, trayItems.length * 2.4)}s` } : {},
                    },
                    visibleTrayItems.map((tray, index) =>
                      h("div", { class: "tray-row", key: `${tray.trayCode}-${index}` }, [
                        h("span", { class: "tray-code" }, tray.trayCode),
                        h("span", { class: "tray-qty" }, tray.sampleLabel || `${tray.sampleCount || 0}件`),
                      ]),
                    ),
                  ),
                ])
                : h("strong", "-"),
              h("div", { class: "total" }, [
                h("span", "合计"),
                h("span", lab.traySummaryLabel || `托盘 ${trayItems.length}，样品 ${lab.sampleCount || 0}`),
              ]),
            ]),
          ]),
          countdown.active
            ? h("div", { class: "countdown", "data-testid": "lab-matrix-countdown" }, [
              h("div", { class: "countdown-head" }, [
                h("span", "实验倒计时"),
                h("strong", countdown.remainingLabel || "-"),
              ]),
              h("div", { class: "progress" }, [h("i")]),
            ])
            : null,
        ],
      );
    };

    return () => {
      const labs = Array.isArray(props.currentLabTaskView?.labs) ? props.currentLabTaskView.labs : [];
      const counts = props.currentLabTaskView?.counts || {};
      return h("div", { ref: matrixRoot, class: ["visual-lab-matrix-screen", "screen", props.compact ? "is-compact" : ""] }, [
        h("header", { class: "header" }, [
          h("div", [
            h("div", { class: "kicker" }, "LAB TASK MATRIX"),
            h("h1", props.screen?.name || "试验间当前任务状态屏"),
          ]),
        ]),
        h("div", { class: "stats" }, [
          h("div", { class: "metric-unplanned stat gray" }, [h("span", "未排程"), h("strong", counts.unplanned || 0)]),
          h("div", { class: "metric-scheduled stat blue" }, [h("span", "已排程"), h("strong", counts.scheduled || 0)]),
          h("div", { class: "metric-running stat green" }, [h("span", "实验进行中"), h("strong", counts.running || 0)]),
          h("div", { class: "metric-completed stat orange" }, [h("span", "实验已完成"), h("strong", counts.completed || 0)]),
          h("div", { class: "metric-repair stat red" }, [h("span", "维修"), h("strong", counts.repair || 0)]),
          h("div", { class: "metric-upkeep stat purple" }, [h("span", "保养"), h("strong", counts.upkeep || 0)]),
        ]),
        labs.length
          ? h("div", { class: "grid" }, labs.map(renderLabCard))
          : h("div", { class: "empty" }, "暂无试验间状态数据"),
      ]);
    };
  },
};
