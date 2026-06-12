import { isReturnedTrayStatus } from "@/lib/taskArchive";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import {
  compareText,
  getSampleTrayList,
} from "./sampleFlow.trayScope";
import { resolveStatusClass } from "./sampleFlow.sampleTableHelpers";

function buildSamplesTrayOverviewView(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const query = normalizeText(input.query).toLowerCase();
  const taskMap = new Map(
    tasks.map((task) => [
      normalizeText(task?.code),
      {
        code: normalizeText(task?.code),
        name: normalizeText(task?.name),
        testType: normalizeText(task?.test_type),
      },
    ]),
  );
  const trayMap = new Map();
  const buildTrayRowKey = (taskCode, trayCode) => `${normalizeText(taskCode)}::${normalizeText(trayCode)}`;

  samples.forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const taskCode = normalizeText(sample?.task_code);
    const task = taskMap.get(taskCode) || { code: taskCode, name: "", testType: "" };
    const sampleStatus = normalizeLifecycleStatus(sample?.location, sample?.status);
    getSampleTrayList(sample).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCode) {
        return;
      }
      const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus);
      if (isReturnedTrayStatus(trayStatus)) {
        return;
      }
      const trayRowKey = buildTrayRowKey(taskCode, trayCode);
      if (!trayMap.has(trayRowKey)) {
        trayMap.set(trayRowKey, {
          trayCode,
          taskCode,
          taskName: task.name,
          testType: task.testType,
          status: trayStatus,
          sampleCodes: [],
        });
      }
      const row = trayMap.get(trayRowKey);
      if (!row.sampleCodes.includes(sampleCode)) {
        row.sampleCodes.push(sampleCode);
      }
      if (!row.status) {
        row.status = trayStatus;
      }
    });
  });

  const rows = Array.from(trayMap.values())
    .map((row) => ({
      ...row,
      sampleCodes: row.sampleCodes.slice().sort(compareText),
      sampleCount: row.sampleCodes.length,
      statusClass: resolveStatusClass(row.status),
      sampleSummary: row.sampleCodes.slice().sort(compareText).join("、"),
    }))
    .filter((row) => {
      if (!query) {
        return true;
      }
      return [row.trayCode, row.taskCode, row.taskName, row.testType, row.status, row.sampleSummary]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ")
        .includes(query);
    })
    .sort((left, right) => compareText(left.trayCode, right.trayCode) || compareText(left.taskCode, right.taskCode));

  return { rows };
}

export { buildSamplesTrayOverviewView };
