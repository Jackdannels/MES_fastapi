import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const buildTimeoutMs = Number(process.env.MES_FRONTEND_BUILD_TIMEOUT_MS || 30_000);
const maxAttempts = 2;
const retryDelaysMs = [100, 200, 400, 800, 1000];
const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);

const runBuildAttempt = ({ root, buildRoot, logger }) => new Promise((resolveAttempt) => {
  const child = spawn(
    process.execPath,
    [join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", buildRoot, "--emptyOutDir"],
    { cwd: root, env: process.env, stdio: "inherit", windowsHide: true },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    logger.error("MES 前端构建超过 " + Math.round(buildTimeoutMs / 1000) + " 秒，正在终止并重试。");
    child.kill("SIGKILL");
  }, buildTimeoutMs);
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolveAttempt({ code: code ?? 1, timedOut });
  });
  child.once("error", (error) => {
    clearTimeout(timer);
    logger.error("MES 前端构建进程启动失败：" + error.message);
    resolveAttempt({ code: 1, timedOut: false });
  });
});

// Dependencies/root are injectable so failure recovery can be tested without touching live dist.
export async function runProductionBuild({
  root = frontendRoot,
  fileSystem = fs,
  build = runBuildAttempt,
  wait = sleep,
  logger = console,
} = {}) {
  root = resolve(root);
  const distRoot = join(root, "dist");
  const suffix = randomUUID();
  const buildRoot = join(root, `.dist-build-${process.pid}-${suffix}`);
  const backupRoot = join(root, `.dist-backup-${process.pid}-${suffix}`);
  let published = false;
  let backupCreated = false;
  let recoveryFailed = false;

  const exists = async (path) => {
    try {
      await fileSystem.access(path);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };
  const retry = async (operation, description) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!retryableCodes.has(error.code) || attempt >= retryDelaysMs.length) throw error;
        const delay = retryDelaysMs[attempt];
        logger.warn("MES 前端" + description + "失败（" + error.code + "），" + delay + "ms 后重试 " + (attempt + 1) + "/" + retryDelaysMs.length + "。");
        await wait(delay);
      }
    }
  };
  const renameDirectory = (from, to) => retry(
    () => fileSystem.rename(from, to), "目录切换 " + from + " -> " + to,
  );
  const removeBuildDirectory = async (path) => {
    // Only this invocation's two generated directories may be removed.
    if (![buildRoot, backupRoot].includes(resolve(path))) {
      throw new Error("拒绝清理本次构建目录以外的路径：" + path);
    }
    await retry(() => fileSystem.rm(path, { force: true, recursive: true }), "清理 " + path);
  };
  const cleanup = async (path) => {
    try {
      await removeBuildDirectory(path);
    } catch (error) {
      logger.warn("MES 前端临时目录清理失败，已保留 " + path + "，不影响本次启动：" + (error.code || "") + " " + error.message);
    }
  };

  try {
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        await removeBuildDirectory(buildRoot);
        logger.log("MES 前端生产构建：第 " + attempt + "/" + maxAttempts + " 次");
        const result = await build({ root, buildRoot, attempt, logger });
        if (result.code !== 0 || !await exists(join(buildRoot, "index.html"))) continue;

        if (await exists(distRoot)) {
          await renameDirectory(distRoot, backupRoot);
          backupCreated = true;
        }
        // Retry publishing the completed build, not compilation. A Windows scanner
        // can briefly hold new output open after Vite has already exited.
        await renameDirectory(buildRoot, distRoot);
        published = true;
        logger.log("MES 前端生产构建已发布。");
        break;
      }
    } catch (error) {
      logger.error("MES 前端构建或发布失败：" + (error.code || "") + " " + error.message);
      if (backupCreated && !published) {
        try {
          if (await exists(distRoot)) {
            throw new Error("目标目录已存在，拒绝覆盖：" + distRoot);
          }
          await renameDirectory(backupRoot, distRoot);
          backupCreated = false;
        } catch (restoreError) {
          recoveryFailed = true;
          logger.error("MES 前端旧版本恢复失败：" + (restoreError.code || "") + " " + restoreError.message + "；备份保留在 " + backupRoot + "，新构建保留在 " + buildRoot + "，请勿删除。");
        }
      }
    }

    if (published) return { exitCode: 0, status: "published" };
    if (recoveryFailed) return { exitCode: 1, status: "recovery-failed", backupRoot, buildRoot };
    try {
      if (await exists(join(distRoot, "index.html"))) {
        logger.warn("MES 前端新版本构建或发布失败，继续使用上一次成功构建，保证服务可用；本次更新尚未生效。");
        return { exitCode: 0, status: "fallback" };
      }
    } catch (error) {
      logger.error("MES 前端历史构建检查失败：" + (error.code || "") + " " + error.message);
    }
    logger.error("MES 前端构建或发布失败，且没有可回退的历史构建。");
    return { exitCode: 1, status: "failed" };
  } finally {
    // Never delete the only recoverable old version after rollback fails.
    if (!recoveryFailed) await cleanup(buildRoot);
    if (published && backupCreated) await cleanup(backupRoot);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = (await runProductionBuild()).exitCode;
}
