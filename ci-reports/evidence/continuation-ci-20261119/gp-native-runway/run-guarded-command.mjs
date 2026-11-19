import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceArg, prefixArg, command, ...args] = process.argv.slice(2);
if (!sourceArg || !prefixArg || !command) throw new Error('Expected source, external output prefix, command and arguments');
const source = resolve(sourceArg), prefix = resolve(prefixArg);
if (prefix.startsWith(`${source}/`)) throw new Error('Evidence must be outside protected source');
mkdirSync(dirname(prefix), { recursive: true });
const { snapshotSource, changedSource } = await import(pathToFileURL(resolve(source, 'scripts/source-stability.ts')));
const hash = data => createHash('sha256').update(data).digest('hex');
const before = snapshotSource(source), manifest = JSON.stringify([...before], null, 2) + '\n';
writeFileSync(`${prefix}-manifest.json`, manifest);
const receipt = {
  source,
  command: [command, ...args],
  cwd: source,
  started: new Date().toISOString(),
  phase: 'running',
  protectedInputs: before.size,
  sourceManifestSha256: hash(manifest),
};
writeFileSync(`${prefix}.json`, JSON.stringify(receipt, null, 2) + '\n');
const start = performance.now(), fd = openSync(`${prefix}.log`, 'w');
const child = spawn(command, args, { cwd: source, stdio: ['ignore', fd, fd], shell: false });
let error;
child.on('error', value => { error = String(value); });
const { code, signal } = await new Promise(done => child.on('close', (code, signal) => done({ code, signal })));
closeSync(fd);
const changed = changedSource(before, snapshotSource(source)), log = readFileSync(`${prefix}.log`);
Object.assign(receipt, {
  phase: 'complete',
  finished: new Date().toISOString(),
  wallSeconds: (performance.now() - start) / 1000,
  childExit: code,
  signal,
  error,
  sourceStable: changed.length === 0,
  changed,
  logBytes: log.length,
  logSha256: hash(log),
  passed: code === 0 && changed.length === 0 && !error,
});
writeFileSync(`${prefix}.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
process.exitCode = receipt.passed ? 0 : 1;
