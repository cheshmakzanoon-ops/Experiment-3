import { writeFileSync } from 'node:fs';
import * as oracles from './phase27c-oracles.ts';

// Independent Node assertions exercise real production components. This is not
// a replacement test framework or a substitute for npm check / browser gates.
const checks: { name: string; passed: boolean; details?: unknown; error?: string }[] = [];
for (const [name, run] of Object.entries(oracles)) {
  try { checks.push({ name, passed: true, details: run() }); }
  catch (error) { checks.push({ name, passed: false, error: error instanceof Error ? error.stack : String(error) }); }
}
const report = { passed: checks.every((check) => check.passed), checks };
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
