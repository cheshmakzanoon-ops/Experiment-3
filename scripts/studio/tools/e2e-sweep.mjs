#!/usr/bin/env node
// Resumable, one-at-a-time Playwright sweep (docs/studio/reports/e2e-sweep.md).
//
//   node scripts/studio/tools/e2e-sweep.mjs --queue <queue.json> --log <progress.jsonl> --logs <dir> \
//        [--port 4251] [--only <substring>] [--force] [--stop-after-ms <wall budget>]
//
// The queue is a JSON array of { spec, mode: "dom"|"real", timeoutMs, hardMs?, env?, grep?, tag? }.
// "dom" runs without a preview server (specs that build their own bundle and call setContent);
// "real" starts `vite preview` of <worktree>/dist on --port. Each entry runs in its own
// Playwright process with workers=1, so at most one browser exists at a time. A finished entry
// (pass, fail, timeout) is appended to the progress log as one JSON line and skipped on the
// next invocation unless --force or its tag is passed again; an entry that was killed with the
// shell has no line and runs again. Per-spec stdout goes to <logs>/<tag>.log and the Playwright
// JSON report to <logs>/<tag>.json. Nothing here changes what a spec asserts; the only knob that
// touches a deadline is the per-test timeout (APEX_TIMEOUT_MS, a lengthening for software GL).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { loadavg } from 'node:os';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);
const queuePath = resolve(opt('queue'));
const logPath = resolve(opt('log'));
const logsDir = resolve(opt('logs'));
const port = Number(opt('port', '4251'));
const only = opt('only');
const stopAfterMs = Number(opt('stop-after-ms', '0'));
const wt = process.cwd();
const config = join(wt, 'scripts/studio/tools/pw-sweep.config.ts');
const cli = join(wt, 'node_modules/@playwright/test/cli.js');
mkdirSync(logsDir, { recursive: true });

const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
const done = new Map();
if (existsSync(logPath))
  for (const line of readFileSync(logPath, 'utf8').split('\n'))
    if (line.trim()) {
      const row = JSON.parse(line);
      done.set(row.tag, row);
    }

const started = Date.now();
const stamp = () => new Date().toISOString().slice(11, 19);
function runOne(entry) {
  return new Promise((resolveRun) => {
    const tag = entry.tag ?? basename(entry.spec, '.spec.ts');
    const jsonOut = join(logsDir, `${tag}.json`);
    const textOut = join(logsDir, `${tag}.log`);
    writeFileSync(textOut, '');
    const env = {
      ...process.env,
      CHROMIUM_PATH: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
      APEX_WT: wt,
      APEX_OUT: join(logsDir, 'artifacts', tag),
      APEX_TIMEOUT_MS: String(entry.timeoutMs ?? 1_200_000),
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut,
      ...(entry.mode === 'real' ? { APEX_PORT: String(port) } : {}),
      ...(entry.env ?? {}),
    };
    if (entry.mode !== 'real') delete env.APEX_PORT;
    const pwArgs = [cli, 'test', '-c', config, entry.spec, '--reporter=list,json', '--workers=1'];
    if (entry.grep) pwArgs.push('--grep', entry.grep);
    const t0 = Date.now();
    const load0 = loadavg()[0].toFixed(2);
    const child = spawn(process.execPath, pwArgs, { cwd: wt, env, detached: true });
    let timedOut = false;
    const killer = setTimeout(
      () => {
        timedOut = true;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      },
      entry.hardMs ?? 3_600_000,
    );
    const sink = (chunk) => appendFileSync(textOut, chunk);
    child.stdout.on('data', sink);
    child.stderr.on('data', sink);
    child.on('close', (code) => {
      clearTimeout(killer);
      // Kill anything the run left behind (a preview server, a browser).
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* nothing left */
      }
      const durationMs = Date.now() - t0;
      let tests = [];
      let stats = null;
      try {
        const report = JSON.parse(readFileSync(jsonOut, 'utf8'));
        stats = report.stats;
        const walk = (suite) => {
          for (const spec of suite.specs ?? [])
            for (const t of spec.tests ?? []) {
              const last = t.results?.[t.results.length - 1];
              tests.push({
                title: spec.title.slice(0, 160),
                status: t.status,
                ms: last?.duration ?? null,
                error: last?.error?.message?.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 900) ?? null,
              });
            }
          for (const child of suite.suites ?? []) walk(child);
        };
        for (const s of report.suites ?? []) walk(s);
      } catch {
        /* no JSON report (killed or config error) */
      }
      resolveRun({
        tag,
        spec: entry.spec,
        mode: entry.mode,
        status: timedOut
          ? 'killed'
          : code === 0
            ? tests.length && tests.every((t) => t.status === 'skipped')
              ? 'skipped'
              : 'passed'
            : 'failed',
        exit: code,
        durationMs,
        load1AtStart: load0,
        timeoutMs: entry.timeoutMs ?? 1_200_000,
        startedAt: new Date(t0).toISOString(),
        stats,
        tests,
      });
    });
  });
}

let ran = 0;
for (const entry of queue) {
  const tag = entry.tag ?? basename(entry.spec, '.spec.ts');
  if (only && !tag.includes(only) && !entry.spec.includes(only)) continue;
  if (!flag('force') && done.has(tag)) continue;
  if (stopAfterMs && Date.now() - started > stopAfterMs) {
    console.log(`[${stamp()}] wall budget reached, not launching ${tag} or later entries`);
    break;
  }
  console.log(`[${stamp()}] START ${tag} (${entry.mode}, timeout ${entry.timeoutMs ?? 1_200_000} ms)`);
  const row = await runOne(entry);
  appendFileSync(logPath, `${JSON.stringify(row)}\n`);
  ran++;
  const counts = row.tests.reduce((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {});
  console.log(
    `[${stamp()}] ${row.status.toUpperCase()} ${tag} ${(row.durationMs / 1000).toFixed(1)} s ${JSON.stringify(counts)}`,
  );
}
console.log(`[${stamp()}] sweep pass finished, ${ran} entries run`);
