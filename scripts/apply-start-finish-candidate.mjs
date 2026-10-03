import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
const bytes = Buffer.concat(Array.from({ length: 5 }, (_, i) => readFileSync(`docs/start-finish-transfer.${i}`)));
const hash = (b) => createHash('sha256').update(b).digest('hex');
if (bytes.length !== 26992 || hash(bytes) !== '931338add3d972e9b620b04d64d89238711a819f8ebf820e85f34068ce7c8215') throw new Error('Candidate transfer differs');
const patch = gunzipSync(bytes, { maxOutputLength: 120000 });
if (patch.length !== 93939 || hash(patch) !== '0edc2dc48356bbd91493bf1b1800983c613e4f7a86704323ac55837ead3c9316') throw new Error('Candidate source differs');
const temporary = mkdtempSync(join(tmpdir(), 'venue-candidate-'));
try {
  const path = join(temporary, 'candidate.patch');
  writeFileSync(path, patch);
  const mode = process.argv[2] ?? 'candidate';
  if (!['candidate', 'baseline'].includes(mode)) throw new Error('Unknown candidate mode');
  const includes = mode === 'baseline' ? ['--include=e2e/55-start-finish.spec.ts', '--include=e2e/fixtures/start-finish.ts'] : [];
  execFileSync('git', ['apply', '--check', '--index', ...includes, path], { stdio: 'inherit' });
  execFileSync('git', ['apply', '--index', ...includes, path], { stdio: 'inherit' });
  console.log(`Applied verified ${mode} source. Baseline installs only the shared inspection fixture, never candidate runtime code.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
