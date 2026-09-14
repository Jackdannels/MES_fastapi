import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, open, stat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { once } from 'node:events';

const frontend = resolve('frontend');
const scratch = await mkdtemp(join(frontend, '.startup-probe-'));
const results = { started: new Date().toISOString(), node: process.version, scratch, cases: [] };
const runs = Number(process.argv[2] || 12);
const retryMode = process.argv[3] === 'retry';
const report = resolve(`.tmp/frontend-rename-probe-results${retryMode ? '-retry' : ''}.json`);
console.log(JSON.stringify({ scratch, node: process.version }));
function safe(path) {
  if (!resolve(path).startsWith(scratch + sep)) throw new Error(`Unsafe test target: ${path}`);
  return path;
}
async function move(from, to) {
  const started = performance.now();
  try {
    await rename(safe(from), safe(to));
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (e) {
    return { ok: false, code: e.code, errno: e.errno, syscall: e.syscall, ms: Math.round(performance.now() - started) };
  }
}
function record(name, value) {
  const row = { name, ...value };
  results.cases.push(row);
  console.log(JSON.stringify(row));
}
async function fixture(name) {
  const dir = join(scratch, name);
  await mkdir(dir);
  await writeFile(join(dir, 'index.html'), '<html>isolated diagnostic fixture</html>');
  return dir;
}
async function childReady(command, args, options = {}) {
  const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  const done = once(child, 'exit');
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 15000);
  await new Promise((res, rej) => {
    child.stdout.once('data', res);
    child.once('error', rej);
    child.once('exit', code => rej(new Error(`holder exited ${code}: ${stderr}`)));
  });
  return { release: async () => { child.stdin.end('\n'); await done; clearTimeout(timer); } };
}
try {
  const before = await fetch('http://127.0.0.1:5173/');
  results.serviceBefore = { status: before.status, index: await before.text() };
  const actualDist = await readFile(join(frontend, 'dist/index.html'), 'utf8');
  for (let n = 1; n <= runs; n++) {
    const build = join(scratch, `.dist-build-${n}`);
    const dist = await fixture(`dist-${n}`);
    const backup = join(scratch, `backup-${n}`);
    const started = performance.now();
    const child = spawn(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', build, '--emptyOutDir'], { cwd: frontend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', x => { output += x; });
    child.stderr.on('data', x => { output += x; });
    const timer = setTimeout(() => child.kill(), 30000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    if (code !== 0) { record(`build-${n}`, { code, tail: output.slice(-2000) }); break; }
    const oldMove = await move(dist, backup);
    const newMove = oldMove.ok ? await move(build, dist) : null;
    const recovery = [];
    if (retryMode && newMove && !newMove.ok) {
      const sourceExists = await stat(build).then(() => true, () => false);
      const targetExists = await stat(dist).then(() => true, () => false);
      recovery.push({ sourceExists, targetExists });
      for (const delayMs of [50, 100, 200, 400, 800]) {
        await new Promise(res => setTimeout(res, delayMs));
        const retried = await move(build, dist);
        recovery.push({ delayMs, ...retried });
        if (retried.ok) break;
      }
    }
    record(`real-build-${n}`, { buildMs: Math.round(performance.now() - started), oldMove, newMove, recovery });
  }
  const nodeDir = await fixture('node-read-holder');
  const fd = await open(join(nodeDir, 'index.html'), 'r');
  try { record('node-file-open', await move(nodeDir, nodeDir + '-moved')); }
  finally { await fd.close(); }

  for (const type of ['new-build', 'old-dist']) {
    const dir = await fixture(`exclusive-${type}`);
    const ps = `$f=[IO.File]::Open('${join(dir, 'index.html').replaceAll("'", "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); [Console]::WriteLine('ready'); try { [Console]::ReadLine() | Out-Null } finally { $f.Dispose() }`;
    const holder = await childReady('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')]);
    let held;
    try { held = await move(dir, dir + '-moved'); }
    finally { await holder.release(); }
    record(`deny-delete-file-${type}`, { held, afterRelease: held.ok ? null : await move(dir, dir + '-moved') });
  }
  const cwdDir = await fixture('cwd-holder');
  const holder = await childReady(process.execPath, ['-e', "console.log('ready');process.stdin.once('data',()=>process.exit(0));"], { cwd: cwdDir });
  let held;
  try { held = await move(cwdDir, cwdDir + '-moved'); }
  finally { await holder.release(); }
  record('process-cwd-holder', { held, afterRelease: held.ok ? null : await move(cwdDir, cwdDir + '-moved') });

  const collisionSource = await fixture('collision-source');
  const collisionTarget = await fixture('collision-target');
  record('another-publisher-created-dist', await move(collisionSource, collisionTarget));
  const after = await fetch('http://127.0.0.1:5173/');
  results.serviceAfter = { status: after.status, sameResponse: (await after.text()) === results.serviceBefore.index };
  delete results.serviceBefore.index;
  results.productionIndexUnchanged = actualDist === await readFile(join(frontend, 'dist/index.html'), 'utf8');
} catch (e) {
  results.error = String(e.stack);
  console.error(e);
  process.exitCode = 1;
} finally {
  // Remove only the unique directory created by this diagnostic, never production dist.
  if (resolve(scratch).startsWith(frontend + sep + '.startup-probe-')) {
    try { await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); results.scratchRemoved = true; }
    catch (e) { results.cleanupError = String(e); }
  }
  results.finished = new Date().toISOString();
  await writeFile(report, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ report, serviceAfter: results.serviceAfter, productionIndexUnchanged: results.productionIndexUnchanged, scratchRemoved: results.scratchRemoved }));
}
