import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, readdir, realpath, mkdir, chmod, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { join, resolve, relative, isAbsolute } from 'node:path';
import asar from '@electron/asar';
import protectedSource from './electron-runtime-ab-protected-source.json' with { type: 'json' };
import {
  RUNTIME_AB_LIMITS,
  runtimeAbFail,
  runtimeAbPin,
  validateComparisonSource,
} from './electron-runtime-ab-contract.mjs';

const execFileAsync = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const INPUT_DIRS = ['src', 'desktop', 'scripts', 'public'];
const INPUT_FILES = [
  'package.json',
  'package-lock.json',
  'index.html',
  'babylon.html',
  'vite.config.ts',
  'tsconfig.json',
];
const TOOLCHAIN_PACKAGES = ['@electron/asar', '@playwright/test'];
const SOURCE_SCHEMA = 'electron-runtime-ab-source-seal-v1';

export async function assertNoSymlinkPath(path) {
  const absolute = resolve(path);
  if (!isAbsolute(path) || absolute !== path || (await realpath(path)) !== path)
    runtimeAbFail('path');
  let current = '/';
  for (const part of path.split('/').filter(Boolean)) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) runtimeAbFail('symlink');
  }
  return absolute;
}

/** Bounds describe bytes read/retained, not a process RSS or address-space cap. */
export async function hashRegularFile(path, limit = RUNTIME_AB_LIMITS.fileBytes) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > RUNTIME_AB_LIMITS.payloadBytes)
    runtimeAbFail('file-bound');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size < 0n || before.size > BigInt(limit))
      runtimeAbFail('file-bound');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      const result = await handle.read(buffer, 0, buffer.length, bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
      if (bytes > limit) runtimeAbFail('file-bound');
      hash.update(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (
      bytes !== Number(before.size) ||
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some((key) => before[key] !== after[key])
    )
      runtimeAbFail('file-mutated');
    return {
      bytes,
      sha256: hash.digest('hex'),
      dev: String(before.dev),
      ino: String(before.ino),
      mode: Number(before.mode & 0o777n),
    };
  } finally {
    await handle.close();
  }
}

export async function readBoundedRegularBytes(path, limit) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > RUNTIME_AB_LIMITS.fileBytes)
    runtimeAbFail('file-bound');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(limit))
      runtimeAbFail('file-bound');
    const chunks = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, total);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) runtimeAbFail('file-bound');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    if (
      total !== Number(before.size) ||
      ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some((key) => before[key] !== after[key])
    )
      runtimeAbFail('file-mutated');
    const bytes = Buffer.concat(chunks, total);
    return { bytes, sha256: sha(bytes), dev: String(before.dev), ino: String(before.ino) };
  } finally {
    await handle.close();
  }
}

export async function readRegularJson(path, limit) {
  const result = await readBoundedRegularBytes(path, limit);
  try {
    return {
      value: JSON.parse(result.bytes.toString('utf8')),
      bytes: result.bytes,
      sha256: result.sha256,
    };
  } catch {
    runtimeAbFail('json');
  }
}

export async function snapshotRegularTree(root, selections = null) {
  await assertNoSymlinkPath(root);
  const files = [];
  let total = 0;
  let entries = 0;
  async function visit(name, depth = 0) {
    if (++entries > RUNTIME_AB_LIMITS.sourceFiles || depth > 64) runtimeAbFail('tree-bound');
    if (
      !name ||
      name.includes('\\') ||
      name.split('/').some((part) => part === '.' || part === '..' || !part)
    )
      runtimeAbFail('tree-path');
    const path = join(root, name);
    const stat = await lstat(path);
    if (stat.isDirectory()) {
      const entries = await readdir(path);
      if (entries.length > RUNTIME_AB_LIMITS.sourceFiles) runtimeAbFail('tree-bound');
      for (const entry of entries.sort()) await visit(`${name}/${entry}`, depth + 1);
    } else {
      if (!stat.isFile() || stat.isSymbolicLink()) runtimeAbFail('tree-type');
      const identity = await hashRegularFile(path);
      total += identity.bytes;
      if (total > RUNTIME_AB_LIMITS.sourceBytes || files.length >= RUNTIME_AB_LIMITS.sourceFiles)
        runtimeAbFail('tree-bound');
      files.push({
        path: name,
        bytes: identity.bytes,
        sha256: identity.sha256,
        executable: identity.mode & 0o111,
      });
    }
  }
  for (const name of (selections ?? (await readdir(root))).slice().sort()) {
    await assertNoSymlinkPath(join(root, name));
    await visit(name);
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, bytes: total, sha256: sha(JSON.stringify(files)) };
}

/** Match Vite's existing source fingerprint without changing its producer. */
export async function comparisonFingerprint(root) {
  const paths = (await snapshotRegularTree(root, ['src'])).files.map((entry) => entry.path);
  paths.push('package-lock.json', 'index.html', 'babylon.html', 'vite.config.ts');
  const hash = createHash('sha256');
  for (const name of paths.sort()) {
    const file = join(root, name);
    const { bytes } = await readBoundedRegularBytes(file, RUNTIME_AB_LIMITS.fileBytes);
    hash
      .update(name + '\0')
      .update(bytes)
      .update('\0');
  }
  return hash.digest('hex');
}

async function git(root, args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10000,
    });
    return result.stdout.trim();
  } catch {
    runtimeAbFail('git-source');
  }
}

/** Call before the one existing desktop:prepare build, then verify afterwards.
 * No build or native process is invoked by this offline preparation module. */
export async function sealComparisonSource(root, expectedCommit) {
  await assertNoSymlinkPath(root);
  if (
    typeof expectedCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(expectedCommit) ||
    (await git(root, ['rev-parse', 'HEAD'])) !== expectedCommit ||
    (await git(root, ['status', '--porcelain', '--untracked-files=normal']))
  )
    runtimeAbFail('dirty-source');
  const pkg = (await readRegularJson(join(root, 'package.json'), 64 * 1024)).value;
  const lock = (await readRegularJson(join(root, 'package-lock.json'), 4 * 1024 * 1024)).value;
  if (
    pkg.devDependencies?.electron !== '45.2.1' ||
    lock.packages?.['node_modules/electron']?.version !== '45.2.1'
  )
    runtimeAbFail('shipped-pin');
  const source = validateComparisonSource({
    version: 1,
    commit: expectedCommit,
    fingerprint: await comparisonFingerprint(root),
    electron: '45.2.1',
    platform: 'linux',
    arch: 'x64',
    hostArch: 'x64',
  });
  const inputs = await snapshotRegularTree(root, [
    ...INPUT_DIRS,
    ...INPUT_FILES,
    ...(await comparisonToolchainDirectories(root)),
  ]);
  validateProtectedComparisonInputs(
    Object.fromEntries(inputs.files.map((entry) => [entry.path, entry.sha256])),
  );
  const smoke = inputs.files.find((entry) => entry.path === 'scripts/desktop-smoke.mjs');
  if (!smoke) runtimeAbFail('smoke-source');
  return Object.freeze({
    schema: SOURCE_SCHEMA,
    source,
    sourceTreeSha256: inputs.sha256,
    inputCount: inputs.files.length,
    smokeSha256: smoke.sha256,
  });
}

export function validateProtectedComparisonInputs(hashes) {
  for (const [path, expected] of Object.entries(protectedSource.files))
    if (hashes[path] !== expected) runtimeAbFail('protected-source-mutated');
}

export async function verifyComparisonSource(root, seal) {
  const current = await sealComparisonSource(root, seal.source.commit);
  if (JSON.stringify(current) !== JSON.stringify(seal)) runtimeAbFail('source-mutated');
  return current;
}

/** Pack the prepared application exactly once. No Electron installation, binary
 * execution, dependency change, installer target or security mutation occurs. */
export async function sealComparisonPayload({ root, sourceSeal, privateParent }) {
  await verifyComparisonSource(root, sourceSeal);
  await assertNoSymlinkPath(privateParent);
  const stage = join(root, 'desktop-stage');
  const stageBefore = await snapshotRegularTree(stage);
  const compiled = await snapshotRegularTree(join(root, 'desktop-dist'));
  if (compiled.sha256 !== (await snapshotRegularTree(join(stage, 'desktop-dist'))).sha256)
    runtimeAbFail('compiled-smoke-source');
  const sourceReceipt = await readRegularJson(join(stage, 'DESKTOP_BUILD.json'), 4096);
  validateComparisonSource(sourceReceipt.value);
  if (JSON.stringify(sourceReceipt.value) !== JSON.stringify(sourceSeal.source))
    runtimeAbFail('stage-source');
  const identity = (await readRegularJson(join(stage, 'dist/BUILD_IDENTITY.json'), 4096)).value;
  if (
    identity.version !== 1 ||
    identity.commit !== sourceSeal.source.commit ||
    identity.fingerprint !== sourceSeal.source.fingerprint
  )
    runtimeAbFail('stage-source');
  const asarPackage = (
    await readRegularJson(join(root, 'node_modules/@electron/asar/package.json'), 65536)
  ).value;
  if (asarPackage.version !== '3.4.1') runtimeAbFail('asar-version');
  const runRoot = join(privateParent, `runtime-ab-${randomBytes(16).toString('hex')}`);
  await mkdir(runRoot, { mode: 0o700 });
  const payload = join(runRoot, 'app.asar');
  await asar.createPackage(stage, payload);
  await chmod(payload, 0o400);
  const payloadIdentity = await hashRegularFile(payload, RUNTIME_AB_LIMITS.payloadBytes);
  if ((await snapshotRegularTree(stage)).sha256 !== stageBefore.sha256)
    runtimeAbFail('stage-mutated');
  await verifyComparisonSource(root, sourceSeal);
  const legs = {};
  for (const leg of ['A', 'B']) {
    const privateRoot = join(runRoot, leg);
    await mkdir(privateRoot, { mode: 0o700 });
    const stateDirectories = {};
    for (const directory of [
      'desktop-out',
      'desktop-stage',
      'tmp',
      'home',
      'cache',
      'config',
      'data',
    ]) {
      await mkdir(join(privateRoot, directory), { mode: 0o700 });
      if (!directory.startsWith('desktop-')) {
        const stat = await lstat(join(privateRoot, directory), { bigint: true });
        stateDirectories[directory] = Object.freeze({
          dev: String(stat.dev),
          ino: String(stat.ino),
        });
      }
    }
    await copyFile(
      join(stage, 'DESKTOP_BUILD.json'),
      join(privateRoot, 'desktop-stage/DESKTOP_BUILD.json'),
      constants.COPYFILE_EXCL,
    );
    await chmod(join(privateRoot, 'desktop-stage/DESKTOP_BUILD.json'), 0o400);
    legs[leg] = Object.freeze({
      leg,
      privateRoot,
      runtimeRoot: join(privateRoot, 'desktop-out/linux-unpacked'),
      ownerToken: randomBytes(32).toString('hex'),
      stateDirectories: Object.freeze(stateDirectories),
    });
  }
  return Object.freeze({
    root,
    sourceSeal,
    runRoot,
    payload,
    legs,
    immutable: Object.freeze({
      source: sourceSeal.source,
      sourceTreeSha256: sourceSeal.sourceTreeSha256,
      payloadSha256: payloadIdentity.sha256,
      payloadBytes: payloadIdentity.bytes,
      smokeSha256: sourceSeal.smokeSha256,
      compiledSmokeSha256: compiled.sha256,
    }),
  });
}

export async function copySealedPayload(context, leg) {
  const destination = join(context.legs[leg].runtimeRoot, 'resources/app.asar');
  await assertNoSymlinkPath(join(context.legs[leg].runtimeRoot, 'resources'));
  const identity = await hashRegularFile(context.payload, RUNTIME_AB_LIMITS.payloadBytes);
  if (
    identity.sha256 !== context.immutable.payloadSha256 ||
    identity.bytes !== context.immutable.payloadBytes
  )
    runtimeAbFail('payload-mutated');
  await copyFile(context.payload, destination, constants.COPYFILE_EXCL);
  await chmod(destination, 0o400);
  const copied = await hashRegularFile(destination, RUNTIME_AB_LIMITS.payloadBytes);
  if (copied.sha256 !== identity.sha256 || copied.bytes !== identity.bytes)
    runtimeAbFail('payload-copy');
  return { sha256: copied.sha256, bytes: copied.bytes };
}

export async function verifyComparisonPayload(context) {
  await verifyComparisonSource(context.root, context.sourceSeal);
  if (
    (await snapshotRegularTree(join(context.root, 'desktop-dist'))).sha256 !==
    context.immutable.compiledSmokeSha256
  )
    runtimeAbFail('compiled-smoke-mutated');
  for (const path of [
    context.payload,
    ...['A', 'B'].map((leg) => join(context.legs[leg].runtimeRoot, 'resources/app.asar')),
  ]) {
    const identity = await hashRegularFile(path, RUNTIME_AB_LIMITS.payloadBytes);
    if (
      identity.sha256 !== context.immutable.payloadSha256 ||
      identity.bytes !== context.immutable.payloadBytes
    )
      runtimeAbFail('payload-mutated');
  }
  for (const leg of ['A', 'B']) {
    const value = (
      await readRegularJson(
        join(context.legs[leg].privateRoot, 'desktop-stage/DESKTOP_BUILD.json'),
        4096,
      )
    ).value;
    if (JSON.stringify(value) !== JSON.stringify(context.immutable.source))
      runtimeAbFail('source-mutated');
    if (
      !context.envelopes?.[leg] ||
      (await snapshotRegularTree(context.legs[leg].runtimeRoot)).sha256 !==
        context.envelopes[leg].runtimeTreeSha256
    )
      runtimeAbFail('runtime-mutated');
  }
  return true;
}

/** Call only after the fixed-pin offline archive tool succeeds. Actual process
 * versions remain separately mandatory; a text version file is not execution. */
export async function sealRuntimeEnvelope(context, leg, archiveReceipt) {
  const pin = runtimeAbPin(leg);
  if (
    archiveReceipt?.schemaVersion !== 1 ||
    archiveReceipt.ok !== true ||
    archiveReceipt.reason !== 'verified' ||
    archiveReceipt.archiveBytes !== pin.bytes ||
    archiveReceipt.archiveSha256 !== pin.sha256
  )
    runtimeAbFail('archive-receipt');
  const root = context.legs[leg].runtimeRoot;
  await assertNoSymlinkPath(root);
  await copySealedPayload(context, leg);
  const executables = {};
  for (const name of ['motobound', 'chrome_crashpad_handler']) {
    const value = await hashRegularFile(join(root, name));
    if (!(value.mode & 0o100)) runtimeAbFail('executable');
    executables[name] = Object.freeze({ dev: value.dev, ino: value.ino });
  }
  const runtime = await snapshotRegularTree(root);
  return Object.freeze({
    leg,
    archiveSha256: pin.sha256,
    archiveBytes: pin.bytes,
    runtimeTreeSha256: runtime.sha256,
    executables: Object.freeze(executables),
  });
}

/** Seal the actual installed required dependency closure. The fixed Linux
 * Playwright/asar sources do not import their optional other-platform package.
 * Resolution, containment and every selected package directory fail closed. */
export async function comparisonToolchainDirectories(root) {
  const pending = TOOLCHAIN_PACKAGES.map((name) => ({ from: join(root, 'package.json'), name }));
  const directories = new Set();
  while (pending.length) {
    if (directories.size > 128 || pending.length > 512) runtimeAbFail('toolchain-bound');
    const { from, name } = pending.pop();
    let packagePath;
    try {
      packagePath = createRequire(from).resolve(`${name}/package.json`);
    } catch {
      runtimeAbFail('toolchain-resolution');
    }
    const directory = resolve(packagePath, '..');
    const relativePath = ownedRelative(root, directory);
    if (!relativePath.startsWith('node_modules/')) runtimeAbFail('toolchain-path');
    await assertNoSymlinkPath(directory);
    if (directories.has(relativePath)) continue;
    directories.add(relativePath);
    const value = (await readRegularJson(packagePath, 65536)).value;
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.name !== 'string' ||
      typeof value.version !== 'string'
    )
      runtimeAbFail('toolchain-package');
    for (const dependency of Object.keys(value.dependencies ?? {}))
      pending.push({ from: packagePath, name: dependency });
  }
  const sorted = [...directories].sort();
  return sorted.filter(
    (path) => !sorted.some((other) => other !== path && path.startsWith(other + '/')),
  );
}

export function ownedRelative(root, path) {
  const name = relative(root, path);
  if (!name || name === '..' || name.startsWith('../') || isAbsolute(name) || name.includes('\\'))
    runtimeAbFail('owned-path');
  return name;
}
