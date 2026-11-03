'use strict';
/**
 * Release smoke harness: launches the (packaged or dev) desktop app twice under
 * a virtual display and checks what a player would depend on.
 *
 *   node scripts/smoke.cjs --app release/linux-unpacked/motobound [--drive] [--out DIR]
 *   node scripts/smoke.cjs --electron           (run `electron .` from this folder)
 *
 * Run 1 ("write"): the menu appears, no console errors, a setting changed in the
 *   real settings screen reaches IndexedDB AND the atomic JSON mirror.
 * Between runs: Chromium's IndexedDB and Local Storage are deleted (simulated
 *   profile loss / fresh machine with Steam Cloud files present).
 * Run 2 ("restore"): the setting is back in IndexedDB, restored from the mirror.
 *
 * --drive additionally starts a practice session and counts frames.
 * Needs xvfb-run (or a real display: pass --no-xvfb).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

const desktopDir = path.resolve(__dirname, '..');
const out = path.resolve(
  value('out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'motobound-smoke-')),
);
fs.mkdirSync(out, { recursive: true });
const userData = path.join(out, 'userData');
fs.rmSync(userData, { recursive: true, force: true });

function command() {
  const app = value('app');
  if (app) return { cmd: path.resolve(app), args: [] };
  if (flag('electron'))
    return {
      cmd: path.join(desktopDir, 'node_modules', '.bin', 'electron'),
      args: [desktopDir, '--dev-web=../dist'],
    };
  console.error('usage: smoke.cjs (--app <binary> | --electron) [--drive] [--out DIR] [--no-xvfb]');
  process.exit(2);
}

function run(phase) {
  const { cmd, args } = command();
  const report = path.join(out, `report-${phase}.json`);
  const launch = [...args, '--no-sandbox', '--windowed', `--user-data=${userData}`];
  const env = {
    ...process.env,
    MOTOBOUND_SMOKE_OUT: report,
    MOTOBOUND_SMOKE_PHASE: phase,
    MOTOBOUND_SMOKE_DRIVE: phase === 'restore' && flag('drive') ? '1' : '0',
    MOTOBOUND_SOFTWARE_GL: '1',
    MOTOBOUND_LOG_STDERR: '0',
    MOTOBOUND_LOG_CONSOLE: '1',
    // Electron's own dev-only security probe evals a string and logs an EvalError under our strict
    // CSP; it never runs in a packaged app. Silence it so the console-error check is meaningful.
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  };
  const full = flag('no-xvfb')
    ? [cmd, launch]
    : ['xvfb-run', ['-a', '-s', '-screen 0 1280x720x24', cmd, ...launch]];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(full[0], full[1], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.stdout.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), 25 * 60 * 1000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const result = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : null;
      resolve({
        phase,
        code,
        signal,
        seconds: (Date.now() - started) / 1000,
        report: result,
        stderr: stderr.slice(-2000),
      });
    });
  });
}

(async () => {
  const first = await run('write');
  for (const dir of ['IndexedDB', 'Local Storage', 'Session Storage'])
    fs.rmSync(path.join(userData, dir), { recursive: true, force: true });
  const second = await run('restore');
  const files = fs.existsSync(path.join(userData, 'saves'))
    ? fs.readdirSync(path.join(userData, 'saves')).sort()
    : [];
  const summary = {
    out,
    savesFolder: files,
    write: { ok: first.report?.ok ?? false, seconds: first.seconds, exit: first.code },
    restore: { ok: second.report?.ok ?? false, seconds: second.seconds, exit: second.code },
  };
  fs.writeFileSync(
    path.join(out, 'summary.json'),
    JSON.stringify({ summary, first, second }, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.write.ok && summary.restore.ok ? 0 : 1);
})();
