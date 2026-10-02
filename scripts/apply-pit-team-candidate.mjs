import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const transport = [0, 1].map((i) => readFileSync(`docs/pit-team-transfer.${i}`, 'utf8').trim()).join('');
const patch = brotliDecompressSync(Buffer.from(transport, 'base64'));
if (patch.length !== 63646 || createHash('sha256').update(patch).digest('hex') !== '8dd6669b00dd774654614ff9b997c7b63c258a84106daac69cc59d9cf8074a48') {
  throw new Error('Candidate integrity mismatch');
}
for (const args of [['apply', '--check', '--index', '-'], ['apply', '--index', '-']]) {
  const result = spawnSync('git', args, { input: patch, stdio: ['pipe', 'inherit', 'inherit'], timeout: 30000 });
  if (result.status !== 0) throw new Error('Candidate does not apply cleanly');
}
