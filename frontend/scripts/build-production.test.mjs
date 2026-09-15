// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runProductionBuild } from "./build-production.mjs";

const delays = [100, 200, 400, 800, 1000];
const failure = (code) => Object.assign(new Error(`injected ${code}`), { code });
const isBuild = (path) => basename(path).startsWith(".dist-build-");
const isBackup = (path) => basename(path).startsWith(".dist-backup-");
let root;
let fileSystem;
let build;
let wait;
let logger;
const writeVersion = async (dir, version) => {
  await fs.mkdir(join(dir, "assets"), { recursive: true });
  await fs.writeFile(join(dir, "index.html"), version);
  await fs.writeFile(join(dir, "assets", "app.js"), version);
};
const version = (dir) => fs.readFile(join(dir, "index.html"), "utf8");
const run = () => runProductionBuild({ root, fileSystem, build, wait, logger });

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "mes-build-test-"));
  await writeVersion(join(root, "dist"), "old");
  fileSystem = { ...fs, rename: vi.fn(fs.rename), rm: vi.fn(fs.rm) };
  build = vi.fn(async ({ buildRoot }) => {
    await writeVersion(buildRoot, "new");
    return { code: 0 };
  });
  wait = vi.fn(async () => {});
  logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
});

afterEach(async () => {
  // Only delete the unique fixture created by this test, never the real frontend.
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep + "mes-build-test-")) {
    throw new Error("Unsafe test cleanup target");
  }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("production build publication recovery", () => {
  it("publishes normally and removes only its own temporary directories", async () => {
    await writeVersion(join(root, ".dist-backup-previous-run"), "preserved");
    expect(await run()).toEqual({ status: "published", exitCode: 0 });
    expect(await version(join(root, "dist"))).toBe("new");
    expect(await fs.readdir(root)).toEqual([".dist-backup-previous-run", "dist"]);
    expect(wait).not.toHaveBeenCalled();
  });

  it.each(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"])("retries transient %s publication without rebuilding", async (code) => {
    let attempts = 0;
    fileSystem.rename.mockImplementation(async (from, to) => {
      if (isBuild(from) && attempts++ < 2) throw failure(code);
      return fs.rename(from, to);
    });
    expect(await run()).toEqual({ status: "published", exitCode: 0 });
    expect(build).toHaveBeenCalledTimes(1);
    expect(wait.mock.calls.flat()).toEqual([100, 200]);
    expect(await version(join(root, "dist"))).toBe("new");
  });

  it("retries a transient lock on the old dist", async () => {
    fileSystem.rename.mockRejectedValueOnce(failure("EPERM"));
    expect((await run()).status).toBe("published");
    expect(wait).toHaveBeenCalledExactlyOnceWith(100);
  });

  it.skipIf(process.platform !== "win32")("recovers from an actual Windows file handle blocking the new directory rename", async () => {
    let handle;
    let locked = false;
    const errors = [];
    fileSystem.rename.mockImplementation(async (from, to) => {
      if (isBuild(from) && !locked) {
        locked = true;
        handle = await fs.open(join(from, "index.html"), "r");
      }
      try {
        return await fs.rename(from, to);
      } catch (error) {
        errors.push(error.code);
        throw error;
      }
    });
    wait.mockImplementation(async () => {
      if (handle) {
        await handle.close();
        handle = null;
      }
    });
    try {
      expect(await run()).toEqual({ status: "published", exitCode: 0 });
      expect(errors).toContain("EPERM");
      expect(build).toHaveBeenCalledTimes(1);
      expect(await version(join(root, "dist"))).toBe("new");
    } finally {
      if (handle) await handle.close();
    }
  });

  it("uses the restored old build with exit 0 when publishing stays locked", async () => {
    fileSystem.rename.mockImplementation((from, to) => {
      if (isBuild(from)) throw failure("EPERM");
      return fs.rename(from, to);
    });
    expect(await run()).toEqual({ status: "fallback", exitCode: 0 });
    expect(wait.mock.calls.flat()).toEqual(delays);
    expect(build).toHaveBeenCalledTimes(1);
    expect(await version(join(root, "dist"))).toBe("old");
    expect(await fs.readFile(join(root, "dist", "assets", "app.js"), "utf8")).toBe("old");
    expect(await fs.readdir(root)).toEqual(["dist"]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("本次更新尚未生效"));
  });

  it("retries rollback independently before falling back", async () => {
    let restores = 0;
    fileSystem.rename.mockImplementation((from, to) => {
      if (isBuild(from) || (isBackup(from) && restores++ === 0)) throw failure("EPERM");
      return fs.rename(from, to);
    });
    expect((await run()).status).toBe("fallback");
    expect(wait.mock.calls.flat()).toEqual([...delays, 100]);
    expect(await version(join(root, "dist"))).toBe("old");
  });

  it("keeps old dist usable when it cannot be moved to backup", async () => {
    fileSystem.rename.mockRejectedValue(failure("EPERM"));
    expect(await run()).toEqual({ status: "fallback", exitCode: 0 });
    expect(await version(join(root, "dist"))).toBe("old");
    expect(wait.mock.calls.flat()).toEqual(delays);
  });

  it("preserves BOTH versions and fails explicitly if rollback is also blocked", async () => {
    fileSystem.rename.mockImplementation((from, to) => {
      if (isBuild(from) || isBackup(from)) throw failure("EPERM");
      return fs.rename(from, to);
    });
    const result = await run();
    expect(result).toMatchObject({ status: "recovery-failed", exitCode: 1 });
    expect(await version(result.backupRoot)).toBe("old");
    expect(await version(result.buildRoot)).toBe("new");
    expect(fileSystem.rm.mock.calls.some(([path]) => path === result.backupRoot)).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(result.backupRoot));
    // A later run must never erase a retained backup from this failed recovery.
    fileSystem.rename.mockImplementation(fs.rename);
    expect((await run()).status).toBe("published");
    expect(await version(result.backupRoot)).toBe("old");
    expect(await version(result.buildRoot)).toBe("new");
  });

  it("does not overwrite an unexpected dist that appears before rollback", async () => {
    fileSystem.rename.mockImplementation(async (from, to) => {
      if (isBuild(from)) {
        await writeVersion(to, "other-publisher");
        throw failure("EIO");
      }
      return fs.rename(from, to);
    });
    const result = await run();
    expect(result.status).toBe("recovery-failed");
    expect(await version(result.backupRoot)).toBe("old");
    expect(await version(join(root, "dist"))).toBe("other-publisher");
  });

  it.each(["backup", "build"])("cleanup failure on %s cannot turn successful publication into startup failure", async (kind) => {
    let compiled = false;
    build.mockImplementation(async ({ buildRoot }) => {
      await writeVersion(buildRoot, "new");
      compiled = true;
      return { code: 0 };
    });
    fileSystem.rm.mockImplementation((path, options) => {
      if (compiled && (kind === "backup" ? isBackup(path) : isBuild(path))) throw failure("EPERM");
      return fs.rm(path, options);
    });
    expect(await run()).toEqual({ status: "published", exitCode: 0 });
    expect(await version(join(root, "dist"))).toBe("new");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("清理失败"));
  });

  it("does not retry non-transient errors but still restores the old version", async () => {
    fileSystem.rename.mockImplementation((from, to) => {
      if (isBuild(from)) throw failure("EIO");
      return fs.rename(from, to);
    });
    expect((await run()).status).toBe("fallback");
    expect(wait).not.toHaveBeenCalled();
  });

  it("fails on first-install publication failure without claiming a fallback", async () => {
    await fs.rm(join(root, "dist"), { recursive: true });
    fileSystem.rename.mockRejectedValue(failure("EPERM"));
    expect(await run()).toEqual({ status: "failed", exitCode: 1 });
    expect(wait.mock.calls.flat()).toEqual(delays);
  });

  it("keeps the existing two-attempt build retry", async () => {
    build.mockResolvedValueOnce({ code: 1, timedOut: true });
    expect((await run()).status).toBe("published");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("falls back after both build attempts fail", async () => {
    build.mockResolvedValue({ code: 1 });
    expect((await run()).status).toBe("fallback");
    expect(build).toHaveBeenCalledTimes(2);
    expect(fileSystem.rename).not.toHaveBeenCalled();
  });

  it("rejects a successful build process that did not create an entry page", async () => {
    build.mockResolvedValue({ code: 0 });
    expect((await run()).status).toBe("fallback");
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("does not treat an inaccessible old dist as absent", async () => {
    fileSystem.access = vi.fn((path) => {
      if (path === join(root, "dist")) throw failure("EACCES");
      return fs.access(path);
    });
    expect((await run()).status).toBe("fallback");
    expect(fileSystem.rename).not.toHaveBeenCalled();
  });

  it("fails instead of using an unreadable historical entry", async () => {
    build.mockResolvedValue({ code: 1 });
    fileSystem.access = vi.fn(() => { throw failure("EACCES"); });
    expect(await run()).toEqual({ status: "failed", exitCode: 1 });
  });
});

const runChild = (script, cwd) => new Promise((res, reject) => {
  const child = spawn(process.execPath, [script], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill(), 10000);
  child.once("error", (error) => { clearTimeout(timer); reject(error); });
  child.once("close", (code) => { clearTimeout(timer); res({ code, output }); });
});

describe("production CLI exit status used by build && serve", () => {
  it.each([true, false])("returns the right exit code on build failure (old version exists: %s)", async (hasOld) => {
    if (!hasOld) await fs.rm(join(root, "dist"), { recursive: true });
    await fs.mkdir(join(root, "scripts"));
    await fs.mkdir(join(root, "node_modules", "vite", "bin"), { recursive: true });
    await fs.copyFile(fileURLToPath(new URL("./build-production.mjs", import.meta.url)), join(root, "scripts", "build-production.mjs"));
    await fs.writeFile(join(root, "node_modules", "vite", "bin", "vite.js"), "process.exitCode = 1;");
    const result = await runChild(join(root, "scripts", "build-production.mjs"), root);
    expect(result.code, result.output).toBe(hasOld ? 0 : 1);
    expect(result.output).toContain(hasOld ? "继续使用上一次成功构建" : "没有可回退的历史构建");
  });
});
