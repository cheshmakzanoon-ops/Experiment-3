#!/usr/bin/env node
// Real-hardware benchmark: runs the production build through the existing journey tool at Low /
// Medium / High on THIS machine's GPU and writes a verdict against the release targets (gate G8).
//
//   npm run bench:gpu                                  # builds if dist/ is missing, 1920x1080, 3 presets
//   npm run bench:gpu -- --journeys formula-race,gp-race,motocross --qualities medium
//   npm run bench:gpu -- --url http://127.0.0.1:4173   # use a server you already started
//   npm run bench:gpu -- --headed                      # show the window (some Linux/macOS GPUs need it)
//
// Needs `npx playwright install chromium` once. Output (default bench-out/<timestamp>/):
//   bench-report.json   every number, per journey x preset, plus machine and GPU identity
//   bench-report.md     the table to paste back to the developer
// It REFUSES to certify a software renderer (SwiftShader / llvmpipe): those numbers describe the
// emulator, not the player's machine. `--allow-software` runs anyway (CI smoke) and marks the
// report NOT HARDWARE.
//
// Targets (override with flags): mid-range GPU (GTX 1660 / RX 580 class) holds 60 fps at the
// preset you pass to --target-quality (default: medium) -> avg >= 58 fps and the 5th-percentile
// second >= 45 fps; no main-thread stall over 250 ms while driving; boot to menu <= 30 s.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = (() => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
})();

const cfg = {
  journeys: String(args.journeys ?? 'formula-race,gp-race,motocross').split(',').filter(Boolean),
  qualities: String(args.qualities ?? 'low,medium,high').split(',').filter(Boolean),
  viewport: String(args.viewport ?? '1920x1080'),
  simSeconds: Number(args['sim-seconds'] ?? 30),
  url: args.url ?? null,
  port: Number(args.port ?? 4217),
  headed: !!args.headed,
  allowSoftware: !!args['allow-software'],
  targetQuality: String(args['target-quality'] ?? 'medium'),
  minAvg: Number(args['min-avg'] ?? 58),
  minP5: Number(args['min-p5'] ?? 45),
  maxStallMs: Number(args['max-stall-ms'] ?? 250),
  maxBootS: Number(args['max-boot-s'] ?? 30),
  out: args.out ?? join(root, 'bench-out', new Date().toISOString().replace(/[:.]/g, '-')),
};

/** Nearest-rank percentile of an ascending-sorted list. */
export const percentile = (sorted, fraction) =>
  sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
const round = (n, d = 1) => (n === null || !Number.isFinite(n) ? null : Number(n.toFixed(d)));

/** Reduce one journey result.json to the numbers the gate needs. Pure: unit-tested. */
export function summariseRun(result) {
  const summary = result.summary ?? {};
  const rows = (summary.drives ?? []).flatMap((d) => d.rows ?? []);
  // The first seconds of a drive include shader/asset warm-up; the in-game capture also discards 5 s.
  const sampled = rows.slice(3).map((r) => r.rafFps).filter((v) => Number.isFinite(v) && v > 0);
  const sorted = [...sampled].sort((a, b) => a - b);
  const avg = sampled.length ? sampled.reduce((a, b) => a + b, 0) / sampled.length : null;
  const page = result.pageCounters ?? {};
  return {
    outcome: summary.outcome ?? 'unknown',
    gpu: summary.boot?.gpu ?? null,
    bootToMenuS: summary.boot?.timeToMenuS ?? null,
    seconds: sampled.length,
    avgFps: round(avg),
    minFps: round(sorted[0] ?? null),
    p1Fps: round(percentile(sorted, 0.01)),
    p5Fps: round(percentile(sorted, 0.05)),
    medianFps: round(percentile(sorted, 0.5)),
    maxStallMs: page.maxGap ?? null,
    longTasks: page.longTasks ?? null,
    jsHeapGrowthSession2MB: summary.memory?.jsHeapGrowthSession2MB ?? null,
    findings: (result.findings ?? []).filter((f) => f.severity === 'blocker' || f.severity === 'major').length,
    consoleErrors: (result.console ?? []).filter((c) => c.type === 'error' || c.type === 'pageerror').length,
  };
}

/** Verdict for one measured cell against the targets. Pure: unit-tested. */
export function judge(run, targets, isTargetQuality) {
  const problems = [];
  if (run.outcome !== 'ok') problems.push(`journey ${run.outcome}`);
  if (run.gpu?.software) problems.push('software renderer');
  if (run.seconds < 10) problems.push(`only ${run.seconds} s measured`);
  if (isTargetQuality) {
    if (run.avgFps !== null && run.avgFps < targets.minAvg) problems.push(`avg ${run.avgFps} < ${targets.minAvg} fps`);
    if (run.p5Fps !== null && run.p5Fps < targets.minP5) problems.push(`p5 ${run.p5Fps} < ${targets.minP5} fps`);
    if (run.maxStallMs !== null && run.maxStallMs > targets.maxStallMs) problems.push(`stall ${run.maxStallMs} ms > ${targets.maxStallMs}`);
    if (run.bootToMenuS !== null && run.bootToMenuS > targets.maxBootS) problems.push(`boot ${run.bootToMenuS} s > ${targets.maxBootS}`);
  }
  if (run.consoleErrors > 0) problems.push(`${run.consoleErrors} console error(s)`);
  return { pass: problems.length === 0, problems };
}

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} did not come up`);
}

const runChild = (command, commandArgs, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: root, stdio: 'inherit', ...options });
    child.on('exit', (code) => resolve(code ?? 1));
  });

async function main() {
  mkdirSync(cfg.out, { recursive: true });
  let server = null;
  let url = cfg.url;
  if (!url) {
    if (!existsSync(join(root, 'dist', 'index.html'))) {
      console.log('dist/ missing: building (npm run build)');
      if ((await runChild('npm', ['run', 'build'])) !== 0) throw new Error('build failed');
    }
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(cfg.port), '--strictPort'], {
      cwd: root,
      stdio: 'ignore',
    });
    url = `http://127.0.0.1:${cfg.port}`;
    await waitForServer(url, 60000);
  }

  const machine = {
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    ramGB: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    commit: (() => {
      try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim(); } catch { return 'unknown'; }
    })(),
    viewport: cfg.viewport,
  };

  const cells = [];
  try {
    for (const journey of cfg.journeys) {
      for (const quality of cfg.qualities) {
        const out = join(cfg.out, `${journey}-${quality}`);
        console.log(`\n=== ${journey} @ ${quality} ===`);
        const childArgs = [
          '--no-warnings', '--experimental-transform-types', 'scripts/studio/tools/journey.mjs',
          '--journey', journey, '--quality', quality, '--viewport', cfg.viewport,
          '--sim-seconds', String(cfg.simSeconds), '--out', out, '--url', url, '--gpu', '--no-shots',
        ];
        if (cfg.headed) childArgs.push('--headed');
        const code = await runChild('node', childArgs);
        const file = join(out, 'result.json');
        const run = existsSync(file) ? summariseRun(JSON.parse(readFileSync(file, 'utf8'))) : summariseRun({ summary: { outcome: `no result (exit ${code})` } });
        const verdict = judge(run, cfg, quality === cfg.targetQuality);
        cells.push({ journey, quality, ...run, ...verdict });
        // A software renderer can never certify anything: stop after the first cell.
        if (run.gpu?.software && !cfg.allowSoftware) {
          console.error(`\nRefusing to benchmark a software renderer (${run.gpu.renderer}). Run on a machine with a GPU, or pass --allow-software for a smoke run.`);
          throw Object.assign(new Error('software renderer'), { exitCode: 3, cells });
        }
      }
    }
  } finally {
    server?.kill();
  }
  return { machine, cells };
}

const markdown = (report, cfgView) => {
  const gpu = report.cells.find((c) => c.gpu)?.gpu;
  const lines = [
    '# MOTOBOUND hardware benchmark',
    '',
    `- machine: ${report.machine.os} · ${report.machine.cpu} (${report.machine.cores} threads) · ${report.machine.ramGB} GB RAM`,
    `- GPU: ${gpu ? `${gpu.renderer}${gpu.software ? ' **(SOFTWARE: NOT HARDWARE)**' : ''}` : 'unknown'}`,
    `- build: commit \`${report.machine.commit}\` · viewport ${report.machine.viewport} · ${cfgView.simSeconds} s of driving per cell`,
    `- targets at \`${cfgView.targetQuality}\`: avg ≥ ${cfgView.minAvg} fps, p5 ≥ ${cfgView.minP5} fps, stall ≤ ${cfgView.maxStallMs} ms, boot ≤ ${cfgView.maxBootS} s`,
    `- overall: **${report.pass ? 'PASS' : 'FAIL'}**`,
    '',
    '| journey | preset | avg fps | median | p5 | p1 | min | max stall ms | boot s | heap +MB (2nd session) | verdict |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const c of report.cells)
    lines.push(`| ${c.journey} | ${c.quality} | ${c.avgFps ?? '-'} | ${c.medianFps ?? '-'} | ${c.p5Fps ?? '-'} | ${c.p1Fps ?? '-'} | ${c.minFps ?? '-'} | ${c.maxStallMs ?? '-'} | ${c.bootToMenuS ?? '-'} | ${c.jsHeapGrowthSession2MB ?? '-'} | ${c.pass ? 'ok' : c.problems.join('; ')} |`);
  lines.push('', 'fps is the per-second rate of presented animation frames while driving (first 3 s dropped).', 'Numbers are measurements of this machine only; they are not a promise about any other.');
  return lines.join('\n') + '\n';
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let report;
  let exitCode = 0;
  try {
    const { machine, cells } = await main();
    report = { machine, cells, pass: cells.length > 0 && cells.every((c) => c.pass) };
    exitCode = report.pass ? 0 : 1;
  } catch (error) {
    if (!error.cells) {
      console.error(error);
      process.exit(2);
    }
    report = { machine: { os: platform(), commit: 'unknown', cpu: cpus()[0]?.model ?? '', cores: cpus().length, ramGB: 0, viewport: cfg.viewport }, cells: error.cells, pass: false };
    exitCode = error.exitCode ?? 1;
  }
  writeFileSync(join(cfg.out, 'bench-report.json'), JSON.stringify({ cfg, ...report }, null, 1));
  writeFileSync(join(cfg.out, 'bench-report.md'), markdown(report, cfg));
  console.log(`\n${markdown(report, cfg)}\nWrote ${cfg.out}/bench-report.{json,md}`);
  process.exit(exitCode);
}
