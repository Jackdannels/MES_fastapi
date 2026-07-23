import { nextTick } from "vue";

import { buildQrCodeSvg } from "@/lib/qrCode";
import { buildTrayQrPayload } from "@/lib/trayQrCode";
import {
  buildExperimentTagPrintCss,
  buildPrintExperimentTags,
  encodeHtml,
  formatSampleCodePreview,
} from "./model";

function useTransferBarcodePrinting({
  allocationSaved,
  applyWorkspace,
  assignedTrays,
  barcodeModalVisible,
  barcodePreviewItems,
  barcodePrintConfirmed,
  canPrint,
  currentTask,
  fetchJson,
  flushPendingRealtimeRefresh,
  isStoredTask,
  modeConfig,
  persistAllocation,
  printingAllBarcodes,
  sampleCodesModalTask,
  sampleCodesModalVisible,
  selectedTaskId,
  showWorkbenchFeedback,
}) {
  const buildBarcodeSvg = (value) => buildQrCodeSvg(value);

  const resolveBarcodeValue = (barcode, tray) => String(
    barcode?.barcodeContent
    || tray?.barcode?.barcodeContent
    || buildTrayQrPayload(barcode?.barcodeNo || tray?.barcode?.barcodeNo || tray?.trayNo)
    || "--",
  ).trim() || "--";

  const resolveBarcodeDisplayNo = (barcode, tray) => String(
    barcode?.barcodeNo
    || tray?.barcode?.barcodeNo
    || tray?.trayNo
    || resolveBarcodeValue(barcode, tray),
  ).trim() || "--";

  const closeBarcodeModal = () => {
    barcodeModalVisible.value = false;
    flushPendingRealtimeRefresh();
  };

  const buildBarcodeSummaryText = (taskNo, sampleCount) => `任务编号：${taskNo || "--"} | 样品数量：${sampleCount ?? 0}`;

  const buildPrintDocument = () => {
    const cards = barcodePreviewItems.value.map((item) => `
      <article class="print-card">
        <header>
          <strong>${encodeHtml(item.barcodeDisplayNo)}</strong>
        </header>
        <div class="print-card-body">
          <div class="print-qr-panel">
            <div class="print-barcode">${item.barcodeSvg || ""}</div>
          </div>
          <div class="print-info-panel">
            <div class="print-field">
              <span>托盘</span>
              <strong>${encodeHtml(item.trayNo)}</strong>
            </div>
            <div class="print-field">
              <span>内容</span>
              <strong>${encodeHtml(item.summaryText || "-")}</strong>
            </div>
            <div class="print-field print-field--samples">
              <span>样品编号</span>
              <strong>${encodeHtml(item.sampleText || "-")}</strong>
            </div>
            ${buildPrintExperimentTags(item)}
          </div>
        </div>
      </article>
    `).join("");

    return `
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="UTF-8" />
          <title>${encodeHtml(modeConfig.value.printTitle)}</title>
          <style>
            @page { margin: 0; }
            body { margin: 0; font-family: "IBM Plex Sans", "Microsoft YaHei", sans-serif; color: #10233f; }
            .print-grid { display: grid; gap: 0; }
            .print-card { box-sizing: border-box; width: 100%; border: 1px solid #cbd5e1; border-radius: 16px; padding: 16px; break-inside: avoid; }
            .print-card header { margin-bottom: 14px; }
            .print-card header strong { font-size: 16px; }
            .print-card-body { display: grid; grid-template-columns: 252px minmax(0, 1fr); gap: 18px; align-items: start; }
            .print-qr-panel { display: flex; align-items: flex-start; justify-content: center; }
            .print-barcode { display: flex; align-items: center; justify-content: center; width: 244px; min-height: 244px; margin: 0; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; }
            .print-barcode svg { width: 220px; height: 220px; flex: 0 0 auto; }
            .print-info-panel { display: grid; gap: 10px; min-width: 0; }
            .print-field { padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
            .print-field span { display: block; margin-bottom: 5px; color: #64748b; font-size: 12px; font-weight: 700; }
            .print-field strong { display: block; color: #0f172a; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
            .print-field--samples strong { font-weight: 600; }
            .print-experiment-tags { justify-content: flex-start; }
            .transfer-tray-experiment-tags { display: flex; flex-wrap: wrap; gap: 8px; }
            .transfer-tray-experiment-tag {
              display: inline-flex;
              align-items: center;
              min-height: 28px;
              padding: 4px 10px;
              border-radius: 999px;
              font-size: 12px;
              font-weight: 700;
              line-height: 1;
              background: var(--tray-experiment-bg, rgba(14, 165, 233, 0.14));
              border: 1px solid var(--tray-experiment-border, rgba(14, 165, 233, 0.45));
              color: var(--tray-experiment-color, #7dd3fc);
            }
            @media screen and (max-width: 680px) {
              .print-card-body { grid-template-columns: 1fr; }
              .print-qr-panel { justify-content: flex-start; }
            }
${buildExperimentTagPrintCss()}
          </style>
        </head>
        <body>
          <section class="print-grid">${cards}</section>
        </body>
      </html>
    `;
  };

  const printBarcodePreview = async () => {
    const printFrame = document.createElement("iframe");
    printFrame.setAttribute("aria-hidden", "true");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    document.body.appendChild(printFrame);

    const frameDocument = printFrame.contentDocument || printFrame.contentWindow?.document;
    const frameWindow = printFrame.contentWindow;
    if (!frameDocument || !frameWindow) {
      document.body.removeChild(printFrame);
      throw new Error("打印载体初始化失败");
    }

    if (typeof frameDocument.open === "function") {
      frameDocument.open();
    }
    frameDocument.write(buildPrintDocument());
    frameDocument.close();
    await Promise.resolve();
    await nextTick();

    if (typeof frameWindow.focus === "function") {
      try {
        frameWindow.focus();
      } catch {
        // Some embedded print frames cannot receive focus; printing can continue.
      }
    }
    if (typeof frameWindow.print === "function") {
      try {
        frameWindow.print();
      } catch {
        // Browser print dialogs may be blocked in tests or restricted contexts.
      }
    }

    window.setTimeout(() => {
      if (printFrame.parentNode) {
        printFrame.parentNode.removeChild(printFrame);
      }
    }, 0);
  };

  const confirmBarcodePrint = async () => {
    if (!barcodePreviewItems.value.length) {
      showWorkbenchFeedback("当前没有可打印的二维码。", "warning");
      return;
    }
    try {
      await printBarcodePreview();
    } catch (error) {
      showWorkbenchFeedback(error instanceof Error ? error.message : "打印失败，请重试。", "error");
      return;
    }
    barcodePrintConfirmed.value = true;
    barcodeModalVisible.value = false;
    flushPendingRealtimeRefresh();
    showWorkbenchFeedback("已发起二维码打印。", "success");
  };

  const printAllTrayBarcodes = async () => {
    if (!canPrint.value) return;
    printingAllBarcodes.value = true;
    try {
      if (!isStoredTask.value && !allocationSaved.value) {
        const saved = await persistAllocation(false);
        if (!saved) return;
      }
      const payload = await fetchJson(`/api/transfer-area/tasks/${selectedTaskId.value}/print-barcodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcodeType: "QRCODE" }),
      });
      applyWorkspace(payload.workspace);
      barcodePreviewItems.value = await Promise.all((payload.barcodes || []).map(async (barcode) => {
        const tray = assignedTrays.value.find((item) => item.trayId === barcode.objectId);
        const barcodeValue = resolveBarcodeValue(barcode, tray);
        return {
          ...barcode,
          barcodeDisplayNo: resolveBarcodeDisplayNo(barcode, tray),
          barcodeValue,
          trayNo: tray?.trayNo || "--",
          samples: tray?.samples?.map((sample) => sample.sampleNo) || [],
          summaryText: buildBarcodeSummaryText(currentTask.value?.taskNo, tray?.samples?.length || 0),
          sampleText: formatSampleCodePreview(tray?.samples?.map((sample) => sample.sampleNo)),
          experimentLabels: Array.isArray(tray?.experimentLabels) ? [...tray.experimentLabels] : [],
          experimentCodes: Array.isArray(tray?.experimentCodes) ? [...tray.experimentCodes] : [],
          barcodeSvg: await buildBarcodeSvg(barcodeValue),
        };
      }));
      barcodePrintConfirmed.value = false;
      barcodeModalVisible.value = true;
      sampleCodesModalVisible.value = false;
      sampleCodesModalTask.value = null;
      showWorkbenchFeedback(payload.message, "success");
    } finally {
      printingAllBarcodes.value = false;
      flushPendingRealtimeRefresh();
    }
  };

  return {
    closeBarcodeModal,
    confirmBarcodePrint,
    printAllTrayBarcodes,
  };
}

export { useTransferBarcodePrinting };
