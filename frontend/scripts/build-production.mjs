import { spawn } from "node:child_process";
import { access, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = join(frontendRoot, "dist");
const buildRoot = join(frontendRoot, `.dist-build-${process.pid}`);
const backupRoot = join(frontendRoot, `.dist-backup-${process.pid}`);
const viteBin = join(frontendRoot, "node_modules", "vite", "bin", "vite.js");
const buildTimeoutMs = Number(process.env.MES_FRONTEND_BUILD_TIMEOUT_MS || 30_000);
const maxAttempts = 2;

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const removeBuildDirectory = async (path) => {
  const resolvedPath = resolve(path);
  if (!resolvedPath.startsWith(`${frontendRoot}\\`) && !resolvedPath.startsWith(`${frontendRoot}/`)) {
    throw new Error(`拒绝清理前端目录以外的路径：${resolvedPath}`);
  }
  await rm(resolvedPath, { force: true, recursive: true });
};

const runBuildAttempt = async (attempt) => {
  await removeBuildDirectory(buildRoot);
  console.log(`MES 前端生产构建：第 ${attempt}/${maxAttempts} 次`);
  return new Promise((resolveAttempt) => {
    const child = spawn(
      process.execPath,
      [viteBin, "build", "--outDir", buildRoot, "--emptyOutDir"],
      { cwd: frontendRoot, env: process.env, stdio: "inherit" },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`MES 前端构建超过 ${Math.round(buildTimeoutMs / 1000)} 秒，正在终止并重试。`);
      child.kill("SIGKILL");
    }, buildTimeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveAttempt({ code: code ?? 1, timedOut });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      console.error(`MES 前端构建进程启动失败：${error.message}`);
      resolveAttempt({ code: 1, timedOut: false });
    });
  });
};

const publishBuild = async () => {
  await access(join(buildRoot, "index.html"));
  await removeBuildDirectory(backupRoot);
  const hasCurrentDist = await exists(distRoot);
  if (hasCurrentDist) await rename(distRoot, backupRoot);
  try {
    await rename(buildRoot, distRoot);
    await removeBuildDirectory(backupRoot);
  } catch (error) {
    if (hasCurrentDist && await exists(backupRoot) && !await exists(distRoot)) {
      await rename(backupRoot, distRoot);
    }
    throw error;
  }
};

let built = false;
try {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runBuildAttempt(attempt);
    if (result.code === 0 && await exists(join(buildRoot, "index.html"))) {
      await publishBuild();
      built = true;
      console.log("MES 前端生产构建已发布。");
      break;
    }
  }

  if (!built) {
    if (await exists(join(distRoot, "index.html"))) {
      console.warn("MES 前端新版本构建失败，继续使用上一次成功构建，保证服务可用。");
      process.exitCode = 0;
    } else {
      console.error("MES 前端构建失败，且没有可回退的历史构建。");
      process.exitCode = 1;
    }
  }
} finally {
  await removeBuildDirectory(buildRoot);
  await removeBuildDirectory(backupRoot);
}
