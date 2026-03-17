import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { SAMPLES_UPDATED_EVENT } from "./useSampleIntake";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import {
  buildBalancedTrayDraft,
  buildSampleProcessTaskOptions,
  buildTrayPrintPayload,
  confirmSampleTaskStore,
  moveSampleBetweenTrays,
  removeTrayFromDraft,
  selectTaskProcessDraft,
} from "./samplesProcessModel";
import { SAMPLE_FLOW_STEPS } from "./samplesFlowModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

// 共享标签用于让托盘处理流程与样品流转页保持一致。
const DEFAULT_LABELS = {
  intakeLocation: "接驳区",
  preRetentionLocation: "恒温恒湿间（暂存间）",
  retentionLocation: "恒温恒湿间（暂存间）",
  sampleStored: "已入库",
};

const FLOW_STEPS = SAMPLE_FLOW_STEPS;
const FLOW_STEP_INDEX = new Map(FLOW_STEPS.map((step, index) => [step.key, index]));
const getCurrentFlowStepKey = (stage) => (stage === "stored" ? "arrived" : "in_transit");

// 托盘处理流程里所有任务号、样品号都统一规范化。
const normalizeText = (value) => String(value ?? "").trim();

// 打印预览区使用文本摘要快速展示当前托盘分布。
const buildTrayPreviewText = (trayDraft) =>
  (Array.isArray(trayDraft?.trays) ? trayDraft.trays : [])
    .map((tray) => {
      const sampleText = Array.isArray(tray.samples) && tray.samples.length ? tray.samples.join("、") : "未分配样品";
      return `${tray.trayCode} | ${tray.samples.length} / ${trayDraft.maxPerTray} | ${sampleText}`;
    })
    .join("\n");

const buildInitialPrintPayload = (taskCode, tasks, trayDraft) => {
  const task = (Array.isArray(tasks) ? tasks : []).find((item) => normalizeText(item?.code) === normalizeText(taskCode));
  const taskTrayCodes = Array.isArray(task?.tray_codes) ? task.tray_codes : [];
  return buildTrayPrintPayload({ taskCode, trayCodes: taskTrayCodes });
};

// 负责将任务样品整理成可打印托盘批次的完整处理流程。
function useSamplesProcess() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([STORAGE_KEYS.tasks, STORAGE_KEYS.samples]);

  const rawTasks = ref([]);
  const rawSamples = ref([]);
  const selectedTaskCode = ref("");
  const trayDraft = ref({ taskCode: "", sampleCount: 0, sampleCodes: [], maxPerTray: 5, trays: [] });
  const activeTrayIndex = ref(-1);
  const draggingSampleCode = ref("");
  const warning = ref("");
  const printPayload = ref({ taskCode: "", trayCodes: [] });
  const storeLocked = ref(false);
  const flowStage = ref("idle");

  const taskOptions = computed(() =>
    buildSampleProcessTaskOptions({
      tasks: rawTasks.value,
      samples: rawSamples.value,
    }),
  );

  const sampleCodesText = computed(() => (trayDraft.value.sampleCodes || []).join("\n"));
  const trayPreviewText = computed(() => buildTrayPreviewText(trayDraft.value));
  const canPrint = computed(() => printPayload.value.trayCodes.length > 0);
  const currentFlowKey = computed(() => getCurrentFlowStepKey(flowStage.value));
  const flowSteps = computed(() =>
    FLOW_STEPS.map((step, index) => {
      // 步骤条按当前流程阶段派生出“已达成/当前”两个视觉状态。
      const currentIndex = FLOW_STEP_INDEX.get(currentFlowKey.value) ?? 0;
      return {
        ...step,
        active: step.key === currentFlowKey.value,
        reached: index < currentIndex,
      };
    }),
  );
  const currentFlowStatus = computed(() => {
    const currentStep = FLOW_STEPS.find((step) => step.key === currentFlowKey.value);
    return `当前状态：${currentStep?.label || "运输中"}`;
  });

  const rebuildDraft = (taskCode) => {
    const nextTaskCode = normalizeText(taskCode);
    selectedTaskCode.value = nextTaskCode;
    trayDraft.value = selectTaskProcessDraft({
      taskCode: nextTaskCode,
      tasks: rawTasks.value,
      samples: rawSamples.value,
    });
    activeTrayIndex.value = trayDraft.value.trays.length ? 0 : -1;
    printPayload.value = buildInitialPrintPayload(nextTaskCode, rawTasks.value, trayDraft.value);
    // 已经存在托盘号的任务视为已入库锁定态。
    storeLocked.value = printPayload.value.trayCodes.length > 0;
    flowStage.value = storeLocked.value ? "stored" : nextTaskCode ? "draft" : "idle";
  };

  const load = async () => {
    const snapshot = await loadSnapshot();
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rebuildDraft(selectedTaskCode.value);
  };

  const handleSamplesUpdated = () => {
    void load();
  };

  const selectTask = (taskCode) => {
    warning.value = "";
    rebuildDraft(taskCode);
  };

  const addTray = () => {
    if (!trayDraft.value.taskCode || storeLocked.value) {
      return;
    }
    // 新增托盘后会按最新托盘数重新均衡分配样品。
    trayDraft.value.trays = buildBalancedTrayDraft({
      taskCode: trayDraft.value.taskCode,
      sampleCodes: trayDraft.value.sampleCodes,
      maxPerTray: trayDraft.value.maxPerTray,
      trayCount: trayDraft.value.trays.length + 1,
    });
    activeTrayIndex.value = trayDraft.value.trays.length - 1;
  };

  const removeTray = (index) => {
    if (trayDraft.value.trays.length <= 1 || storeLocked.value) {
      return;
    }
    trayDraft.value.trays = removeTrayFromDraft({
      taskCode: trayDraft.value.taskCode,
      sampleCodes: trayDraft.value.sampleCodes,
      maxPerTray: trayDraft.value.maxPerTray,
      trays: trayDraft.value.trays,
      removeIndex: index,
    });
    if (activeTrayIndex.value >= trayDraft.value.trays.length) {
      activeTrayIndex.value = trayDraft.value.trays.length - 1;
    }
  };

  const setActiveTray = (index) => {
    activeTrayIndex.value = activeTrayIndex.value === index ? -1 : index;
  };

  const setTrayLimit = (value) => {
    if (storeLocked.value) {
      return;
    }
    const parsed = Number.parseInt(String(value ?? "").trim(), 10);
    const nextLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
    trayDraft.value.maxPerTray = nextLimit;
    // 修改单盘上限后，整份草稿会重新按新约束分布。
    trayDraft.value.trays = buildBalancedTrayDraft({
      taskCode: trayDraft.value.taskCode,
      sampleCodes: trayDraft.value.sampleCodes,
      maxPerTray: nextLimit,
      trayCount: trayDraft.value.trays.length,
    });
    if (activeTrayIndex.value >= trayDraft.value.trays.length) {
      activeTrayIndex.value = trayDraft.value.trays.length - 1;
    }
  };

  const startDragging = (sampleCode) => {
    if (storeLocked.value) {
      return;
    }
    draggingSampleCode.value = normalizeText(sampleCode);
  };

  const moveSampleToTray = (sampleCode, targetIndex) => {
    if (storeLocked.value) {
      return;
    }
    const result = moveSampleBetweenTrays({
      trayDraft: trayDraft.value,
      sampleCode,
      targetIndex,
    });
    if (!result.moved) {
      return;
    }
    trayDraft.value.trays = result.trays;
    activeTrayIndex.value = targetIndex;
  };

  const moveToActiveTray = (sampleCode) => {
    if (activeTrayIndex.value < 0 || storeLocked.value) {
      return;
    }
    moveSampleToTray(sampleCode, activeTrayIndex.value);
  };

  const handleTrayDrop = (targetIndex) => {
    if (!draggingSampleCode.value || storeLocked.value) {
      return;
    }
    moveSampleToTray(draggingSampleCode.value, targetIndex);
    draggingSampleCode.value = "";
  };

  const confirmStore = async () => {
    if (storeLocked.value) {
      warning.value = "当前任务已确认入库，如需调整请先重新入库。";
      return;
    }
    const result = confirmSampleTaskStore({
      taskCode: selectedTaskCode.value,
      tasks: rawTasks.value,
      samples: rawSamples.value,
      trayDraft: trayDraft.value,
      labels: DEFAULT_LABELS,
      now: new Date().toISOString(),
    });
    if (result.error) {
      warning.value = result.error;
      return;
    }

    // 入库确认会同时刷新任务、样品、打印载荷和流程阶段。
    rawTasks.value = result.tasks;
    rawSamples.value = result.samples;
    await persistSnapshot({
      [STORAGE_KEYS.tasks]: result.tasks,
      [STORAGE_KEYS.samples]: result.samples,
    });
    warning.value = result.warning || "";
    printPayload.value = buildTrayPrintPayload({
      taskCode: selectedTaskCode.value,
      trayCodes: result.trayCodes,
    });
    storeLocked.value = true;
    flowStage.value = "stored";
    trayDraft.value = selectTaskProcessDraft({
      taskCode: selectedTaskCode.value,
      tasks: result.tasks,
      samples: result.samples,
    });
  };

  const restoreStore = () => {
    if (!selectedTaskCode.value) {
      return;
    }
    // 恢复后仅取消前端锁定，不回滚已落盘的任务/样品数据。
    storeLocked.value = false;
    flowStage.value = "repartition";
    printPayload.value = { taskCode: selectedTaskCode.value, trayCodes: [] };
    warning.value = "已取消当前入库锁定，可重新进行托盘分装。";
  };

  const printTrays = () => {
    const payload = buildTrayPrintPayload(printPayload.value);
    if (!payload.taskCode || payload.trayCodes.length === 0) {
      warning.value = "当前没有可打印的托盘编号，请先确认入库。";
      return;
    }

    warning.value = "";
    const popup = window.open("", "_blank", "width=980,height=760");
    if (!popup) {
      warning.value = "浏览器拦截了打印窗口，请允许弹窗后重试。";
      return;
    }

    // 这里直接生成独立打印页，避免依赖运行环境额外的打印组件。
    const cards = payload.trayCodes
      .map(
        (code, index) => `
          <section class="label">
            <div class="seq">序号 ${index + 1}</div>
            <div class="task">任务：${payload.taskCode || "-"}</div>
            <div class="tray">托盘编号：${code}</div>
            <svg class="barcode-svg" data-code="${code}"></svg>
            <div class="hint">${code}</div>
          </section>
        `,
      )
      .join("");

    popup.document.open?.();
    popup.document.write(`<!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          <title>托盘编码打印</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 16px; font-family: "Microsoft YaHei", "Segoe UI", sans-serif; color: #0f172a; }
            .sheet { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
            .label { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; page-break-inside: avoid; }
            .seq { font-size: 12px; color: #475569; margin-bottom: 6px; }
            .task, .tray { font-size: 14px; margin-bottom: 4px; }
            .barcode-svg { display: block; width: 100%; height: 90px; margin: 10px 0 6px; background: #fff; }
            .hint { font-size: 12px; letter-spacing: 0.08em; color: #334155; }
            .warn { margin-top: 10px; color: #b91c1c; font-size: 12px; }
            @media print { body { margin: 8mm; } }
          </style>
        </head>
        <body>
          <main class="sheet">${cards}</main>
          <div id="barcode-print-warn" class="warn" style="display:none;">
            部分托盘编号包含不可编码字符，已自动替换为 "-" 后打印。
          </div>
          <script>
            (function () {
              const CODE128_PATTERNS = [
                "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312",
                "231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212",
                "223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121",
                "111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331",
                "132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123",
                "311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124",
                "121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114",
                "413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112",
                "421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311",
                "113141","114131","311141","411131","211412","211214","211232","2331112"
              ];
              const encodeCode128B = (value) => {
                const text = String(value || "").replace(/[^\\x20-\\x7E]/g, "-");
                const codes = [104];
                for (let i = 0; i < text.length; i += 1) codes.push(text.charCodeAt(i) - 32);
                let checksum = 104;
                for (let i = 1; i < codes.length; i += 1) checksum += codes[i] * i;
                checksum %= 103;
                codes.push(checksum, 106);
                return { text, codes };
              };
              const drawCode128 = (svg, value) => {
                const encoded = encodeCode128B(value);
                const moduleWidth = 2;
                const quiet = 10;
                const height = 90;
                let totalModules = quiet * 2;
                encoded.codes.forEach((itemCode) => {
                  const pattern = CODE128_PATTERNS[itemCode] || "";
                  for (let i = 0; i < pattern.length; i += 1) totalModules += Number.parseInt(pattern[i], 10) || 0;
                });
                const width = totalModules * moduleWidth;
                svg.setAttribute("viewBox", "0 0 " + width + " " + height);
                svg.setAttribute("width", width);
                svg.setAttribute("height", height);
                svg.innerHTML = "";
                const ns = "http://www.w3.org/2000/svg";
                let cursor = quiet * moduleWidth;
                encoded.codes.forEach((itemCode) => {
                  const pattern = CODE128_PATTERNS[itemCode] || "";
                  for (let i = 0; i < pattern.length; i += 1) {
                    const unit = Number.parseInt(pattern[i], 10) || 0;
                    const w = unit * moduleWidth;
                    if (i % 2 === 0 && w > 0) {
                      const rect = document.createElementNS(ns, "rect");
                      rect.setAttribute("x", String(cursor));
                      rect.setAttribute("y", "0");
                      rect.setAttribute("width", String(w));
                      rect.setAttribute("height", String(height));
                      rect.setAttribute("fill", "#000");
                      svg.appendChild(rect);
                    }
                    cursor += w;
                  }
                });
                return encoded.text;
              };
              const renderBarcodes = () => {
                const list = Array.from(document.querySelectorAll(".barcode-svg"));
                let replaced = false;
                list.forEach((svg) => {
                  const code = svg.getAttribute("data-code") || "";
                  try {
                    const normalized = drawCode128(svg, code);
                    if (normalized !== code) replaced = true;
                  } catch (error) {
                    replaced = true;
                  }
                });
                if (replaced) {
                  const warn = document.getElementById("barcode-print-warn");
                  if (warn) warn.style.display = "block";
                }
                return list.length > 0;
              };
              const run = () => {
                if (!renderBarcodes()) return;
                setTimeout(function () {
                  window.focus();
                  window.print();
                }, 120);
              };
              if (document.readyState === "complete") run();
              else window.addEventListener("load", run, { once: true });
            })();
          <\/script>
        </body>
      </html>
    `);
    popup.document.close();
  };

  onMounted(() => {
    void load();
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  onBeforeUnmount(() => {
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  return {
    activeTrayIndex,
    canPrint,
    confirmStore,
    currentFlowStatus,
    flowSteps,
    handleTrayDrop,
    moveToActiveTray,
    printTrays,
    restoreStore,
    sampleCodesText,
    selectTask,
    selectedTaskCode,
    setActiveTray,
    setTrayLimit,
    startDragging,
    storeLocked,
    taskOptions,
    trayDraft,
    trayPreviewText,
    warning,
    addTray,
    removeTray,
  };
}

export { useSamplesProcess };
