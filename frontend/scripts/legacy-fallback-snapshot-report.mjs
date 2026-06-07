import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, "..");
const DEFAULT_SNAPSHOT_PATH = path.resolve(FRONTEND_ROOT, "..", ".codex-preview", "runtime_snapshot.json");

const parseArgs = (argv) => {
  const args = { help: false, json: false, snapshot: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--snapshot" || arg === "-s") {
      args.snapshot = argv[index + 1] || "";
      index += 1;
    } else if (!args.snapshot) {
      args.snapshot = arg;
    }
  }
  return args;
};

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const cloneHitList = (hits) => hits.map((hit) => ({
  count: hit.count,
  id: hit.id,
  lastDetail: hit.lastDetail ? { ...hit.lastDetail } : hit.lastDetail,
}));

const diffHits = (before, after) => {
  const beforeMap = new Map(before.map((hit) => [hit.id, hit.count]));
  return after
    .map((hit) => ({
      ...hit,
      count: hit.count - (beforeMap.get(hit.id) || 0),
    }))
    .filter((hit) => hit.count > 0);
};

const readSnapshot = async (snapshotPath) => {
  const resolvedPath = snapshotPath ? path.resolve(process.cwd(), snapshotPath) : DEFAULT_SNAPSHOT_PATH;
  const text = await readFile(resolvedPath, "utf-8");
  return {
    path: resolvedPath,
    snapshot: JSON.parse(text),
  };
};

const addCandidate = (map, name, code = "") => {
  const normalizedName = normalizeText(name);
  const normalizedCode = normalizeText(code);
  if (!normalizedName) {
    return;
  }
  const key = `${normalizedCode || "-"}::${normalizedName}`;
  if (!map.has(key)) {
    map.set(key, { code: normalizedCode, name: normalizedName });
  }
};

const summarizeSnapshot = (snapshot, keys) => Object.fromEntries(
  Object.entries(keys).map(([name, key]) => [name, asArray(snapshot[key]).length]),
);

const createPhaseBucket = (name) => ({
  hitCounts: new Map(),
  lastDetails: new Map(),
  name,
  scannedCount: 0,
  uniqueScopes: new Map(),
});

const addHitDelta = (bucket, hit, scopeKey, globalUniqueScopes) => {
  bucket.hitCounts.set(hit.id, (bucket.hitCounts.get(hit.id) || 0) + hit.count);
  bucket.lastDetails.set(hit.id, hit.lastDetail ? { ...hit.lastDetail } : hit.lastDetail);
  if (!bucket.uniqueScopes.has(hit.id)) {
    bucket.uniqueScopes.set(hit.id, new Set());
  }
  bucket.uniqueScopes.get(hit.id).add(scopeKey);
  if (!globalUniqueScopes.has(hit.id)) {
    globalUniqueScopes.set(hit.id, new Set());
  }
  globalUniqueScopes.get(hit.id).add(scopeKey);
};

const serializePhaseBucket = (bucket) => ({
  hits: Array.from(bucket.hitCounts.entries())
    .map(([id, count]) => ({
      count,
      id,
      lastDetail: bucket.lastDetails.get(id) || {},
      uniqueScopeCount: bucket.uniqueScopes.get(id)?.size || 0,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
  name: bucket.name,
  scannedCount: bucket.scannedCount,
});

const taskCodeOf = (item) => normalizeText(item?.task_code || item?.taskCode || item?.task_no || item?.taskNo);
const experimentCodeOf = (item) => normalizeText(
  item?.experiment_code
  || item?.experimentCode
  || item?.experiment_no
  || item?.experimentNo,
);
const sampleCodeOf = (item) => normalizeText(item?.code || item?.sample_code || item?.sampleCode || item?.sample_no || item?.sampleNo || item?.id);
const trayCodeOf = (item) => normalizeText(item?.tray_code || item?.trayCode || item?.tray_no || item?.trayNo);
const labCodeOf = (item) => normalizeText(item?.lab_code || item?.labCode || item?.device_code || item?.deviceCode);
const labNameOf = (item) => normalizeText(item?.lab_name || item?.labName || item?.device || item?.device_name || item?.deviceName);
const runStatusOf = (item) => normalizeText(item?.status || item?.run_status || item?.runStatus);
const runNoOf = (item) => normalizeText(item?.run_no || item?.runNo || item?.id);
const runTimeOf = (item) => normalizeText(item?.completed_at || item?.completedAt || item?.ended_at || item?.endedAt || item?.updated_at || item?.updatedAt);
const isRunningRunStatus = (status) => ["实验进行中", "实验中"].includes(normalizeText(status));
const isCompletedRunStatus = (status) => ["实验已完成", "实验完成", "实验已经完成"].includes(normalizeText(status));

const backendFallbackId = {
  completionSampleScope: "backend.laboratory_completion.sample_scope_legacy_tray_fallback",
  mqRecentCompletedRun: "backend.mq.experiment_result.recent_completed_run_fallback",
  mqSampleScope: "backend.mq.scope_sample.legacy_tray_target_fallback",
  startSampleScope: "backend.laboratory_start.sample_scope_legacy_tray_fallback",
};

const createBackendBucket = (name) => ({
  hits: [],
  name,
  riskCounts: new Map(),
  scannedCount: 0,
});

const addBackendRisk = (bucket, id, detail = {}, example = {}) => {
  if (!bucket.riskCounts.has(id)) {
    bucket.riskCounts.set(id, { count: 0, examples: [], lastDetail: {} });
  }
  const risk = bucket.riskCounts.get(id);
  risk.count += 1;
  risk.lastDetail = { ...detail };
  if (Object.keys(example).length && risk.examples.length < 5) {
    risk.examples.push({ ...example });
  }
};

const serializeBackendBucket = (bucket) => ({
  hits: bucket.hits,
  name: bucket.name,
  risks: Array.from(bucket.riskCounts.entries())
    .map(([id, risk]) => ({
      count: risk.count,
      examples: risk.examples,
      id,
      lastDetail: risk.lastDetail,
    }))
    .sort((left, right) => left.id.localeCompare(right.id)),
  scannedCount: bucket.scannedCount,
});

const buildExperimentSampleKeySet = (experimentSamples) => new Set(
  experimentSamples
    .map((item) => {
      const taskCode = taskCodeOf(item);
      const experimentCode = experimentCodeOf(item);
      const sampleCode = sampleCodeOf(item);
      return taskCode && experimentCode && sampleCode ? `${taskCode}::${experimentCode}::${sampleCode}` : "";
    })
    .filter(Boolean),
);

const buildTaskSampleRelationSet = (experimentSamples) => new Set(
  experimentSamples
    .map((item) => {
      const taskCode = taskCodeOf(item);
      const sampleCode = sampleCodeOf(item);
      return taskCode && sampleCode ? `${taskCode}::${sampleCode}` : "";
    })
    .filter(Boolean),
);

const trayTargetExperimentCodeOf = (tray) => experimentCodeOf(tray) || normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);

const sampleTrayCodes = (sample) => new Set(asArray(sample?.trays).map(trayCodeOf).filter(Boolean));

const buildBackendFallbackAudit = ({ experimentRuns, experimentSamples, experimentTrays, samples }) => {
  const sampleRelationKeys = buildExperimentSampleKeySet(experimentSamples);
  const taskSampleRelations = buildTaskSampleRelationSet(experimentSamples);
  const sampleScopeBucket = createBackendBucket("backend.sample_scope_relations");
  const recentRunBucket = createBackendBucket("backend.mq_recent_completed_run");

  const experimentsByTray = new Map();
  experimentTrays.forEach((relation) => {
    const taskCode = taskCodeOf(relation);
    const trayCode = trayCodeOf(relation);
    const experimentCode = experimentCodeOf(relation);
    if (!taskCode || !trayCode || !experimentCode) {
      return;
    }
    const key = `${taskCode}::${trayCode}`;
    if (!experimentsByTray.has(key)) {
      experimentsByTray.set(key, new Set());
    }
    experimentsByTray.get(key).add(experimentCode);
  });

  experimentTrays.forEach((relation) => {
    const taskCode = taskCodeOf(relation);
    const experimentCode = experimentCodeOf(relation);
    const trayCode = trayCodeOf(relation);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    sampleScopeBucket.scannedCount += 1;
    const scopedSampleCodes = samples
      .filter((sample) => taskCodeOf(sample) === taskCode)
      .filter((sample) => sampleTrayCodes(sample).has(trayCode))
      .map(sampleCodeOf)
      .filter(Boolean);
    if (scopedSampleCodes.some((sampleCode) => sampleRelationKeys.has(`${taskCode}::${experimentCode}::${sampleCode}`))) {
      return;
    }

    const ambiguousTray = (experimentsByTray.get(`${taskCode}::${trayCode}`)?.size || 0) > 1;
    const hasExplicitTrayTarget = samples
      .filter((sample) => taskCodeOf(sample) === taskCode)
      .flatMap((sample) => asArray(sample?.trays))
      .some((tray) => trayCodeOf(tray) === trayCode && trayTargetExperimentCodeOf(tray) === experimentCode);
    const hasFallbackEligibleSample = !ambiguousTray && samples
      .filter((sample) => taskCodeOf(sample) === taskCode)
      .flatMap((sample) => asArray(sample?.trays))
      .some((tray) => trayCodeOf(tray) === trayCode && !trayTargetExperimentCodeOf(tray));

    if (hasFallbackEligibleSample && !hasExplicitTrayTarget) {
      addBackendRisk(sampleScopeBucket, backendFallbackId.startSampleScope, { reason: "missing_experiment_sample_relation" });
      addBackendRisk(sampleScopeBucket, backendFallbackId.completionSampleScope, { reason: "missing_experiment_sample_relation" });
      if (!scopedSampleCodes.some((sampleCode) => taskSampleRelations.has(`${taskCode}::${sampleCode}`))) {
        addBackendRisk(sampleScopeBucket, backendFallbackId.mqSampleScope, { reason: "missing_experiment_sample_relation" });
      }
    }
  });

  const runningLabs = new Set(
    experimentRuns
      .filter((run) => isRunningRunStatus(runStatusOf(run)))
      .map((run) => labCodeOf(run) || labNameOf(run))
      .filter(Boolean),
  );
  experimentRuns.forEach((run) => {
    const labIdentity = labCodeOf(run) || labNameOf(run);
    if (!labIdentity) {
      return;
    }
    recentRunBucket.scannedCount += 1;
    if (isCompletedRunStatus(runStatusOf(run)) && !runningLabs.has(labIdentity)) {
      addBackendRisk(
        recentRunBucket,
        backendFallbackId.mqRecentCompletedRun,
        { reason: "missing_active_run" },
        {
          completedAt: runTimeOf(run),
          experimentCode: experimentCodeOf(run),
          lab: labIdentity,
          runNo: runNoOf(run),
          taskCode: taskCodeOf(run),
        },
      );
    }
  });

  const phases = [sampleScopeBucket, recentRunBucket].map(serializeBackendBucket);
  const riskCount = phases.reduce(
    (total, phase) => total + phase.risks.reduce((phaseTotal, risk) => phaseTotal + risk.count, 0),
    0,
  );
  return {
    hitCount: 0,
    hits: [],
    phases,
    riskCount,
    scanned: {
      experimentRuns: experimentRuns.length,
      experimentTrays: experimentTrays.length,
    },
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: npm run legacy:fallback-report -- [--snapshot <snapshot.json>] [--json]\nDefault snapshot: ${DEFAULT_SNAPSHOT_PATH}`);
    return;
  }
  const { path: snapshotPath, snapshot } = await readSnapshot(args.snapshot);
  const server = await createServer({
    appType: "custom",
    logLevel: "error",
    root: FRONTEND_ROOT,
    server: { hmr: false, middlewareMode: true },
  });

  try {
    const [
      { STORAGE_KEYS },
      labsModule,
      legacyFallback,
      samplesFlow,
      laboratoryModel,
      stagingModel,
    ] = await Promise.all([
      server.ssrLoadModule("/src/lib/storageKeys.js"),
      server.ssrLoadModule("/src/lib/labs.js"),
      server.ssrLoadModule("/src/lib/legacyFallback.js"),
      server.ssrLoadModule("/src/modules/samples/samplesFlowModel.js"),
      server.ssrLoadModule("/src/modules/laboratory/model.js"),
      server.ssrLoadModule("/src/modules/staging-management/model.js"),
    ]);

    const tasks = asArray(snapshot[STORAGE_KEYS.tasks]);
    const schedules = asArray(snapshot[STORAGE_KEYS.schedules]);
    const experiments = asArray(snapshot[STORAGE_KEYS.experiments]);
    const experimentRuns = asArray(snapshot[STORAGE_KEYS.experiment_runs]);
    const experimentRunTrays = asArray(snapshot[STORAGE_KEYS.experiment_run_trays]);
    const experimentTrays = asArray(snapshot[STORAGE_KEYS.experiment_trays]);
    const experimentSamples = asArray(snapshot[STORAGE_KEYS.experiment_samples]);
    const samples = asArray(snapshot[STORAGE_KEYS.samples]);
    const devices = asArray(snapshot[STORAGE_KEYS.devices]);
    const now = new Date();
    const phaseBuckets = new Map();
    const globalUniqueScopes = new Map();

    legacyFallback.resetLegacyFallbackHits();

    const scanScope = (phaseName, scopeKey, callback) => {
      const before = cloneHitList(legacyFallback.getLegacyFallbackHits());
      callback();
      const after = cloneHitList(legacyFallback.getLegacyFallbackHits());
      const delta = diffHits(before, after);
      if (!phaseBuckets.has(phaseName)) {
        phaseBuckets.set(phaseName, createPhaseBucket(phaseName));
      }
      const bucket = phaseBuckets.get(phaseName);
      bucket.scannedCount += 1;
      delta.forEach((hit) => addHitDelta(bucket, hit, `${phaseName}:${scopeKey}`, globalUniqueScopes));
    };

    const trayContexts = new Map();
    samples.forEach((sample) => {
      const taskCode = normalizeText(sample?.task_code || sample?.taskCode || sample?.task_no || sample?.taskNo);
      asArray(sample?.trays).forEach((tray) => {
        const trayCode = normalizeText(tray?.tray_code || tray?.trayCode || tray?.tray_no || tray?.trayNo);
        if (!trayCode) {
          return;
        }
        if (!trayContexts.has(trayCode)) {
          trayContexts.set(trayCode, {
            currentExperimentCode: normalizeText(
              tray?.target_experiment_code
              || tray?.targetExperimentCode
              || tray?.experiment_code
              || tray?.experimentCode,
            ),
            location: normalizeText(sample?.location),
            status: normalizeText(tray?.status) || normalizeText(sample?.flow_status) || normalizeText(sample?.status),
            taskCode,
            trayCode,
          });
        }
      });
    });

    Array.from(trayContexts.values()).forEach((context) => {
      scanScope("samples.tray_flow", context.trayCode, () => {
        samplesFlow.buildTrayFlowView({
          ...context,
          experimentRuns,
          experimentRunTrays,
          experiments,
          experimentTrays,
          samples,
          schedules,
          tasks,
        });
      });
    });
    scanScope("samples.tray_overview", "all", () => {
      samplesFlow.buildSamplesTrayOverviewView({ samples, tasks });
    });

    const labCandidates = new Map();
    asArray(labsModule.TEST_LABS).forEach((name) => addCandidate(labCandidates, name));
    devices.forEach((device) => addCandidate(labCandidates, device?.name || device?.device_name, device?.code));
    schedules.forEach((schedule) => addCandidate(labCandidates, schedule?.device || schedule?.device_name, schedule?.lab_name));
    experimentRuns.forEach((run) => addCandidate(labCandidates, run?.device || run?.device_name || run?.lab_name));

    Array.from(labCandidates.values()).forEach((lab) => {
      scanScope("laboratory.workbench", lab.code || lab.name, () => {
        laboratoryModel.buildLaboratoryWorkbenchView({
          experimentRuns,
          experimentRunTrays,
          experiments,
          experimentTrays,
          labCode: lab.code,
          labName: lab.name,
          now,
          samples,
          schedules,
          tasks,
        });
      });
    });

    let stagingRowsScanned = 0;
    ["staging", "appearance"].forEach((room) => {
      const rows = stagingModel.buildZancunRowsFromSnapshot(snapshot, { now: now.toISOString(), room });
      stagingRowsScanned += rows.length;
      rows.forEach((row) => {
        scanScope("storage.stock_out_detail", `${room}:${row.trayCode}`, () => {
          stagingModel.buildZancunScanDetail(rows, row.trayCode, "stockOut", { room });
        });
      });
    });

    const hits = cloneHitList(legacyFallback.getLegacyFallbackHits());
    const phases = Array.from(phaseBuckets.values()).map(serializePhaseBucket);
    const frontendReport = {
      hitCount: hits.reduce((total, hit) => total + hit.count, 0),
      hits: hits.map((hit) => ({
        ...hit,
        uniqueScopeCount: globalUniqueScopes.get(hit.id)?.size || 0,
      })),
      phases,
      scanned: {
        labs: labCandidates.size,
        storageRows: stagingRowsScanned,
        trays: trayContexts.size,
      },
    };
    const backendReport = buildBackendFallbackAudit({
      experimentRuns,
      experimentSamples,
      experimentTrays,
      samples,
    });
    const report = {
      backend: backendReport,
      frontend: frontendReport,
      hitCount: frontendReport.hitCount + backendReport.hitCount,
      snapshot: {
        path: snapshotPath,
        sizes: summarizeSnapshot(snapshot, STORAGE_KEYS),
      },
    };

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`Snapshot: ${report.snapshot.path}`);
    console.log(`Frontend scanned trays=${frontendReport.scanned.trays}, labs=${frontendReport.scanned.labs}, storageRows=${frontendReport.scanned.storageRows}`);
    console.log(`Frontend legacy fallback hits: ${frontendReport.hitCount}`);
    if (hits.length === 0) {
      console.log("No frontend legacy fallback hits.");
    } else {
      hits.forEach((hit) => {
        const uniqueScopeCount = globalUniqueScopes.get(hit.id)?.size || 0;
        console.log(`- ${hit.id}: hits=${hit.count}, scopes=${uniqueScopeCount} ${JSON.stringify(hit.lastDetail || {})}`);
      });
    }
    console.log("Frontend phase details:");
    frontendReport.phases.forEach((phase) => {
      const ids = phase.hits.map((hit) => `${hit.id}:hits=${hit.count},scopes=${hit.uniqueScopeCount}`).join(", ") || "none";
      console.log(`- ${phase.name} scanned=${phase.scannedCount} hits=${ids}`);
    });
    console.log(`Backend scanned experimentTrays=${backendReport.scanned.experimentTrays}, experimentRuns=${backendReport.scanned.experimentRuns}`);
    console.log(`Backend legacy fallback hits: ${backendReport.hitCount}`);
    console.log(`Backend legacy fallback risk scopes: ${backendReport.riskCount}`);
    if (backendReport.riskCount === 0) {
      console.log("No backend legacy fallback risk scopes.");
    }
    console.log("Backend phase details:");
    backendReport.phases.forEach((phase) => {
      const risks = phase.risks.map((risk) => `${risk.id}:risks=${risk.count}`).join(", ") || "none";
      console.log(`- ${phase.name} scanned=${phase.scannedCount} risks=${risks}`);
    });
    const backendRiskExamples = backendReport.phases.flatMap((phase) =>
      phase.risks.flatMap((risk) =>
        risk.examples.map((example) => ({
          id: risk.id,
          ...example,
        })),
      ),
    );
    console.log("Backend risk examples:");
    if (backendRiskExamples.length === 0) {
      console.log("- none");
    } else {
      backendRiskExamples.forEach((example) => {
        console.log(`- ${example.id} run=${example.runNo || "-"} task=${example.taskCode || "-"} experiment=${example.experimentCode || "-"} lab=${example.lab || "-"} completedAt=${example.completedAt || "-"}`);
      });
    }
    console.log(`Legacy fallback hits: ${report.hitCount}`);
  } finally {
    await server.close();
  }
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
