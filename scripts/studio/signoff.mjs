#!/usr/bin/env node
/**
 * Studio sign-off (D33 qa-signoff; QA tooling, not part of the game or CI).
 *
 * Runs the integration gates in order and writes one JSON report:
 *   1. pinned paths unchanged since the programme base (PRODUCTION_PLAN rule 7),
 *   2. no real-trademark strings outside the P13 replacement map,
 *   3. lint, typecheck and build,
 *   4. the full vitest suite (only when --full; it takes 8-10 minutes),
 *   5. look-metrics on a capture directory (--capture <dir>), with the share of
 *      judged KPI checks that pass (target >= 80 %).
 *
 * Usage: node scripts/studio/signoff.mjs --out <report.json> [--base <commit>]
 *          [--full] [--capture <dir>] [--skip-build]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const out = value('--out', null);
if (!out) {
  console.error(
    'Usage: node scripts/studio/signoff.mjs --out <report.json> [--base <commit>] [--full] [--capture <dir>] [--skip-build]',
  );
  process.exit(2);
}
const base = value('--base', '3a6036d');
const PINNED = [
  'public/models',
  'src/rendering/*.glb.gz',
  'src/rendering/*.geometry.json',
  'scripts/author-*.py',
  'scripts/*.blend',
  'src/rendering/pit-building-layout.ts',
  'docs/MASTER_DIRECTIVE.md',
];
const report = { base, gates: [] };
function gate(name, run) {
  const started = Date.now();
  let result;
  try {
    result = run();
  } catch (error) {
    result = { pass: false, detail: String(error?.message ?? error).slice(0, 2000) };
  }
  report.gates.push({ name, seconds: Math.round((Date.now() - started) / 1000), ...result });
  console.log(
    `${result.pass ? 'PASS' : 'FAIL'}  ${name}${result.detail ? ` - ${String(result.detail).split('\n')[0]}` : ''}`,
  );
}
const sh = (cmd, cmdArgs, options = {}) =>
  spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 1 << 26, ...options });

gate('pinned paths unchanged', () => {
  const diff = execFileSync('git', ['diff', '--stat', base, '--', ...PINNED], { encoding: 'utf8' });
  return { pass: diff.trim() === '', detail: diff.trim() || 'no changes' };
});

gate('no real trademarks in source strings', () => {
  const pattern =
    '\\b(bybit|oracle|red bull|redbull|pirelli|rolex|aramco|heineken|petronas|ferrari|mercedes|mclaren|williams|sauber|aston martin|visa cash app|emirates|lenovo|tag heuer|infinitum|hard rock|honda)\\b';
  const r = sh('git', [
    'grep',
    '-n',
    '-i',
    '-E',
    pattern,
    '--',
    'src',
    ':!src/rendering/studio/brand-atlas.ts',
  ]);
  const lines = (r.stdout || '')
    .split('\n')
    .filter((l) => l && !/^\S+:\d+:\s*(\/\/|\*|\/\*)/.test(l));
  return { pass: lines.length === 0, detail: lines.slice(0, 20).join('\n') || 'none' };
});

for (const [name, cmd] of [
  ['lint', ['npm', ['run', '-s', 'lint']]],
  ['typecheck', ['npx', ['tsc', '--noEmit', '-p', '.']]],
  ...(flag('--skip-build') ? [] : [['build', ['npm', ['run', '-s', 'build']]]]),
  ...(flag('--full') ? [['full vitest suite', ['npx', ['vitest', 'run']]]] : []),
])
  gate(name, () => {
    const r = sh(cmd[0], cmd[1]);
    const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const summary =
      text.match(/Tests\s+[^\n]+/g)?.pop() ?? text.trim().split('\n').slice(-3).join(' | ');
    return { pass: r.status === 0, detail: summary };
  });

const capture = value('--capture', null);
if (capture)
  gate(`look-metrics ${capture}`, () => {
    const json = `${out}.look-metrics.json`;
    sh('python3', ['-I', 'scripts/studio/look-metrics.py', capture, '--json', json]);
    const data = JSON.parse(readFileSync(json, 'utf8'));
    const checks = (data.checks ?? data.results ?? []).filter((c) =>
      ['PASS', 'FAIL'].includes(c.result),
    );
    const passed = checks.filter((c) => c.result === 'PASS').length;
    const rate = checks.length ? passed / checks.length : 0;
    report.lookMetrics = { passed, judged: checks.length, rate };
    return {
      pass: rate >= 0.8,
      detail: `${passed}/${checks.length} judged KPI checks pass (${Math.round(rate * 100)} %)`,
    };
  });

report.pass = report.gates.every((g) => g.pass);
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(`${report.pass ? 'SIGN-OFF PASS' : 'SIGN-OFF FAIL'}: ${out}`);
process.exit(report.pass ? 0 : 1);
