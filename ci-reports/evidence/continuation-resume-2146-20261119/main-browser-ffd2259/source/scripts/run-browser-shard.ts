import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  planBrowserShards,
  casePattern,
  verifySelection,
  type BrowserCase,
} from './browser-shard-plan.ts';

const match = /^(\d+)\/(\d+)$/.exec(process.argv[2] ?? '');
if (!match) throw new Error('Expected shard index/total, for example 1/8');
const index = Number(match[1]),
  total = Number(match[2]);
if (index < 1 || index > total) throw new Error('Invalid shard index');
const temp = mkdtempSync(join(tmpdir(), 'apex-browser-inventory-'));
const path = join(temp, 'inventory.json');
const cli = resolve('node_modules/@playwright/test/cli.js');
const list = (extra: string[] = []) => {
  rmSync(path, { force: true });
  const run = spawnSync(
    process.execPath,
    [cli, 'test', '--list', '--reporter=./scripts/browser-inventory-reporter.mjs', ...extra],
    { stdio: 'inherit', env: { ...process.env, APEX_BROWSER_INVENTORY: path } },
  );
  if (run.status !== 0 || run.error || !existsSync(path))
    throw new Error('Cannot enumerate the complete browser suite');
  return JSON.parse(readFileSync(path, 'utf8')) as BrowserCase[];
};
try {
  const inventory = list();
  const plan = planBrowserShards(inventory, total);
  const selected = plan[index - 1].tests;
  const grep = casePattern(selected);
  verifySelection(selected, list(['--grep', grep]));
  writeFileSync(
    'browser-shard-plan.json',
    JSON.stringify(
      {
        index,
        total,
        discovered: inventory.length,
        inventorySHA256: createHash('sha256').update(JSON.stringify(inventory)).digest('hex'),
        schedulingWeightsAreEstimates: true,
        allCasesAssignedExactlyOnce: true,
        shards: plan.map((shard) => ({
          estimatedWeight: shard.weight,
          ids: shard.tests.map((test) => test.id),
        })),
        selected,
      },
      null,
      2,
    ),
  );
  console.log(
    `Verified ${selected.length} of ${inventory.length} cases for shard ${index}/${total}; no omissions or duplicate assignments.`,
  );
  if (!process.argv.includes('--plan-only')) {
    const run = spawnSync(process.execPath, [cli, 'test', '--grep', grep], {
      stdio: 'inherit',
      env: process.env,
    });
    if (run.error) throw run.error;
    process.exitCode = run.status ?? 1;
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
