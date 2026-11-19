// Invoke an unchanged repository script while keeping generated evidence in an
// external working directory. The repository's own source guard owns the input
// inventory and comparison; this wrapper adds receipts and live log capture.
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const [sourceArg, outputArg, label, executable, ...args] = process.argv.slice(2);
if (!sourceArg || !outputArg || !label || !executable) {
  throw new Error('Usage: run-frozen-acceptance.mjs <source> <external-output> <label> <command> [...args]');
}
const source = resolve(sourceArg), output = resolve(outputArg);
if (output === source || output.startsWith(`${source}/`)) {
  throw new Error('Acceptance output must remain outside the protected source checkout');
}
const { snapshotSource, changedSource } = await import(
  pathToFileURL(resolve(source, 'scripts/source-stability.ts')).href
);
mkdirSync(resolve(output, 'docs'), { recursive: true });
const logPath = resolve(output, `${label}.log`), receiptPath = resolve(output, `${label}-status.json`);
const descriptor = openSync(logPath, 'w');
const started = new Date().toISOString(), t0 = performance.now();
const before = snapshotSource(source);
const digest = (snapshot) => createHash('sha256').update(JSON.stringify([...snapshot])).digest('hex');
const inputDigest = digest(before);
const base = { label, source, output, executable, args, started,
  inputFiles: before.size, inputDigest, logPath };
writeFileSync(receiptPath, JSON.stringify({ ...base, status: 'running' }, null, 2) + '\n');
console.log(JSON.stringify({ label, status: 'started', inputFiles: before.size, inputDigest, logPath }));
const child = spawn(executable, args, { cwd: output, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
child.stdout.on('data', (data) => { writeSync(descriptor, data); process.stdout.write(data); });
child.stderr.on('data', (data) => { writeSync(descriptor, data); process.stderr.write(data); });
let error;
child.on('error', (value) => { error = String(value); });
const { code, signal } = await new Promise((done) => child.on('close', (code, signal) => done({ code, signal })));
closeSync(descriptor);
const after = snapshotSource(source), changed = changedSource(before, after);
const result = { ...base, status: 'completed', finished: new Date().toISOString(),
  wallSeconds: (performance.now() - t0) / 1000, childExit: code, signal, error,
  sourceStable: changed.length === 0, changed, outputDigest: digest(after),
  passed: code === 0 && changed.length === 0 && !error };
writeFileSync(receiptPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
process.exitCode = result.passed ? 0 : 1;
