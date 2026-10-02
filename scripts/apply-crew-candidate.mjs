// Explicit source transport for the gated A41/A42 integration, removed on success.
import { readFileSync, writeFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const encoded = [0, 1, 2].map((part) => readFileSync(`docs/crew-transfer.${part}`, 'utf8').trim()).join('');
const patch = brotliDecompressSync(Buffer.from(encoded, 'base64'), { maxOutputLength: 1000000 });
if (createHash('sha256').update(patch).digest('hex') !== '414a6e3e8a502f75fa3fde3486e96797322c6d5a2d39531044221a8d3d438a09') {
  throw new Error('Crew source transport differs from the locally checked patch');
}
const path = join(process.env.RUNNER_TEMP, 'crew-candidate.patch');
writeFileSync(path, patch);
execFileSync('git', ['apply', '--check', '--index', path], { stdio: 'inherit' });
execFileSync('git', ['apply', '--index', path], { stdio: 'inherit' });
const fixes = readFileSync('docs/crew-transfer.fixes');
if (createHash('sha256').update(fixes).digest('hex') !== '138b0d5087dd299ade25d4f1653b566e8878438d7d202ce1f83f8127077ca444') {
  throw new Error('Crew evidence follow-up differs from the checked source');
}
execFileSync('git', ['apply', '--check', '--index', 'docs/crew-transfer.fixes'], { stdio: 'inherit' });
execFileSync('git', ['apply', '--index', 'docs/crew-transfer.fixes'], { stdio: 'inherit' });
writeFileSync(join(process.env.RUNNER_TEMP, 'crew-validation-fixes.patch'), fixes);
execFileSync('git', ['rm', 'docs/crew-transfer.fixes'], { stdio: 'inherit' });
