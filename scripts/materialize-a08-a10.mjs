import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const script = new URL('./materialize-a08-a10.py', import.meta.url);
if (!existsSync(script)) throw new Error('Missing A08-A10 materializer');
const candidates = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []], ['python3', []]]
  : [['python3', []], ['python', []]];
let last = null;
for (const [command, prefix] of candidates) {
  const result = spawnSync(command, [...prefix, script.pathname], { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') { last = result.error; continue; }
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.exit(0);
}
throw new Error(`Python 3 is required to materialize A08-A10: ${last?.message ?? 'not found'}`);
