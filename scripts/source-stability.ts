import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Compare against this invocation's input, not a sealed historical source hash.
// Asset authoring and formatting remain explicit commands outside this guard.
const INPUT_DIRECTORIES = ['src', 'public', 'scripts', 'tests', 'e2e', 'docs', '.github'];
const GENERATED_ASSET = 'public/models/supplied-player-lods.bin.gz';
export type SourceSnapshot = Map<string, string>;

export function snapshotSource(root: string): SourceSnapshot {
  const result: SourceSnapshot = new Map();
  function visit(relative: string) {
    if (relative === GENERATED_ASSET) return;
    const path = join(root, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      result.set(relative, `symlink:${readlinkSync(path)}`);
    } else if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort()) visit(`${relative}/${entry}`);
    } else if (stat.isFile()) {
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
      result.set(relative, `${stat.mode & 0o111}:${digest}`);
    }
  }
  for (const entry of readdirSync(root).sort()) {
    // Protect all root files (including npm/config/directives); exclude output directories.
    if (INPUT_DIRECTORIES.includes(entry) || !lstatSync(join(root, entry)).isDirectory())
      visit(entry);
  }
  return result;
}

export function changedSource(before: SourceSnapshot, after: SourceSnapshot): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

export function runWithStableSource(root: string, command: string, args: string[]): number {
  const before = snapshotSource(root);
  // npm.cmd cannot be spawned without a shell on Windows. Prefer npm's JS entry
  // when npm itself launched the guard; never concatenate user arguments into a shell.
  const npm = command === 'npm' ? process.env.npm_execpath : undefined;
  const executable = npm ? process.execPath : command;
  const result = spawnSync(executable, npm ? [npm, ...args] : args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  const changes = changedSource(before, snapshotSource(root));
  if (changes.length) {
    console.error(`Command rewrote application inputs:\n${changes.join('\n')}`);
    return 1;
  }
  if (result.error) console.error(result.error.message);
  if (result.signal) console.error(`Command terminated by ${result.signal}`);
  return result.status ?? 1;
}

const invoked = process.argv[1];
if (invoked && fileURLToPath(import.meta.url) === resolve(invoked)) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const command = args.shift();
  if (!command || (!isAbsolute(command) && command.startsWith('-'))) {
    console.error('Usage: node scripts/source-stability.ts -- <command> [arguments...]');
    process.exitCode = 2;
  } else {
    process.exitCode = runWithStableSource(process.cwd(), command, args);
  }
}
