import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  copyFile,
  lstat,
  rm,
  symlink,
  link,
  chmod,
  cp,
  realpath,
  readdir,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import asar from '@electron/asar';
import protectedSource from '../scripts/electron-runtime-ab-protected-source.json';
import {
  hashRegularFile,
  snapshotRegularTree,
  comparisonFingerprint,
  sealComparisonSource,
  verifyComparisonSource,
  sealComparisonPayload,
  copySealedPayload,
  sealRuntimeEnvelope,
  verifyComparisonPayload,
  validateProtectedComparisonInputs,
  ownedRelative,
  comparisonToolchainDirectories,
  readBoundedRegularBytes,
  type ComparisonContext,
} from '../scripts/electron-runtime-ab-payload.mjs';
import {
  collectComparisonEvidence,
  assertFreshComparisonLeg,
  removeComparisonPrivateState,
  unchangedSmokeInvocation,
  exportComparisonEvidence,
  runRuntimeComparison,
  type ComparisonOutcome,
} from '../scripts/electron-runtime-ab-coordinator.mjs';
import {
  runtimeAbPin,
  isDeclaredRuntimeNativeEvidence,
} from '../scripts/electron-runtime-ab-contract.mjs';
import { clean, exited, smoke } from './fixtures/electron-runtime-ab-fixtures.ts';

describe.skipIf(process.platform !== 'linux')(
  'Linux-only offline payload and private state',
  () => {
    let temp: string, root: string, context: ComparisonContext;
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    beforeAll(async () => {
      temp = await mkdtemp(resolve('.runtime-ab-payload-test-'));
      root = join(temp, 'source');
      await mkdir(root);
      // This is an explicit tiny synthetic build, not a fresh production build or
      // native acceptance. The executing smoke/provenance sources are copied exact.
      for (const name of [
        ...Object.keys(protectedSource.files),
        'node_modules/@electron/asar/package.json',
        'index.html',
        'babylon.html',
        'vite.config.ts',
        'tsconfig.json',
      ]) {
        const destination = join(root, name);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(resolve(name), destination);
      }
      const installedRoot = dirname(await realpath(resolve('node_modules')));
      for (const directory of await comparisonToolchainDirectories(installedRoot))
        await cp(join(installedRoot, directory), join(root, directory), { recursive: true });
      for (const name of ['src/input.ts', 'public/fixture.txt']) {
        await mkdir(dirname(join(root, name)), { recursive: true });
        await writeFile(join(root, name), 'synthetic fixture\n');
      }
      await writeFile(join(root, '.gitignore'), 'desktop-stage/\ndesktop-dist/\n');
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Offline Fixture',
          '-c',
          'user.email=offline@example.invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-qm',
          'synthetic source fixture',
        ],
        { cwd: root },
      );
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      const sourceSeal = await sealComparisonSource(root, commit);
      await mkdir(join(root, 'desktop-stage/dist'), { recursive: true });
      await mkdir(join(root, 'desktop-stage/desktop-dist'));
      await writeFile(
        join(root, 'desktop-stage/package.json'),
        JSON.stringify({ name: 'synthetic-not-launched', main: 'desktop-dist/main.js' }),
      );
      await writeFile(join(root, 'desktop-stage/desktop-dist/main.js'), '// never executed\n');
      await mkdir(join(root, 'desktop-dist'));
      await copyFile(
        join(root, 'desktop-stage/desktop-dist/main.js'),
        join(root, 'desktop-dist/main.js'),
      );
      await writeFile(
        join(root, 'desktop-stage/DESKTOP_BUILD.json'),
        JSON.stringify(sourceSeal.source),
      );
      await writeFile(
        join(root, 'desktop-stage/dist/BUILD_IDENTITY.json'),
        JSON.stringify({ version: 1, commit, fingerprint: sourceSeal.source.fingerprint }),
      );
      context = await sealComparisonPayload({ root, sourceSeal, privateParent: temp });
      const envelopes = {} as NonNullable<ComparisonContext['envelopes']>;
      for (const leg of ['A', 'B'] as const) {
        const runtime = context.legs[leg].runtimeRoot;
        await mkdir(join(runtime, 'resources'), { recursive: true, mode: 0o700 });
        for (const name of ['motobound', 'chrome_crashpad_handler']) {
          await writeFile(join(runtime, name), 'never executed\n', { mode: 0o700 });
        }
        const pin = runtimeAbPin(leg);
        // Mocked verified-distribution receipt only; no official ZIP is downloaded.
        envelopes[leg] = await sealRuntimeEnvelope(context, leg, {
          schemaVersion: 1,
          ok: true,
          reason: 'verified',
          archiveBytes: pin.bytes,
          archiveSha256: pin.sha256,
        });
      }
      context = { ...context, envelopes };
    });
    afterAll(async () => {
      if (temp) await rm(temp, { recursive: true, force: true });
    });

    it('creates one ASAR and identical envelope copies without rewriting the declared shipped pin', async () => {
      expect(await verifyComparisonPayload(context)).toBe(true);
      const shared = await readFile(context.payload);
      for (const leg of ['A', 'B'] as const) {
        const path = join(context.legs[leg].runtimeRoot, 'resources/app.asar');
        expect(await readFile(path)).toEqual(shared);
        const declared = JSON.parse(asar.extractFile(path, 'DESKTOP_BUILD.json').toString());
        expect(declared.electron).toBe('45.2.1');
        expect(declared.commit).toBe(context.immutable.source.commit);
      }
      expect(context.immutable.payloadSha256).toBe(hash(shared));
      await expect(copySealedPayload(context, 'A')).rejects.toThrow(); // exclusive, no stale overwrite
    });
    it('detects changed application input, fingerprint and protected smoke independently', async () => {
      const file = join(root, 'src/input.ts');
      const before = await readFile(file);
      await writeFile(file, 'changed\n');
      expect(await comparisonFingerprint(root)).not.toBe(context.sourceSeal.source.fingerprint);
      await expect(verifyComparisonSource(root, context.sourceSeal)).rejects.toThrow();
      await writeFile(file, before);
      expect(() =>
        validateProtectedComparisonInputs({
          ...protectedSource.files,
          'scripts/desktop-smoke.mjs': '0'.repeat(64),
        }),
      ).toThrow();
      expect(() => validateProtectedComparisonInputs(protectedSource.files)).not.toThrow();
    });
    it('seals the actual Playwright wrapper dependency closure as well as reviewed core code', async () => {
      const directories = await comparisonToolchainDirectories(root);
      expect(directories).toContain('node_modules/@playwright/test');
      expect(directories).toContain('node_modules/playwright');
      expect(directories).toContain('node_modules/playwright-core');
      const path = join(root, 'node_modules/@playwright/test/index.mjs');
      const before = await readFile(path);
      await writeFile(path, '// altered wrapper\n');
      await expect(verifyComparisonSource(root, context.sourceSeal)).rejects.toThrow();
      await writeFile(path, before);
    });
    it('rejects a stale prepared source receipt instead of relabelling its payload', async () => {
      const file = join(root, 'desktop-stage/DESKTOP_BUILD.json');
      const before = await readFile(file);
      await writeFile(
        file,
        JSON.stringify({ ...context.immutable.source, commit: '0'.repeat(40) }),
      );
      await expect(
        sealComparisonPayload({ root, sourceSeal: context.sourceSeal, privateParent: temp }),
      ).rejects.toThrow();
      await writeFile(file, before);
    });
    it('detects altered payload and runtime envelope bytes before another leg', async () => {
      const file = join(context.legs.A.runtimeRoot, 'resources/app.asar');
      const before = await readFile(file);
      await chmod(file, 0o600);
      await writeFile(file, 'changed');
      await expect(verifyComparisonPayload(context)).rejects.toThrow();
      await writeFile(file, before);
      await chmod(file, 0o400);
      const executable = join(context.legs.A.runtimeRoot, 'motobound');
      const exe = await readFile(executable);
      await writeFile(executable, 'changed-runtime');
      await expect(verifyComparisonPayload(context)).rejects.toThrow();
      await writeFile(executable, exe);
      expect(await verifyComparisonPayload(context)).toBe(true);
    });
    it('seals the compiled root imports used by the unchanged smoke, not only their TS source', async () => {
      const file = join(root, 'desktop-dist/main.js');
      const before = await readFile(file);
      await writeFile(file, '// changed compiled dependency\n');
      await expect(verifyComparisonPayload(context)).rejects.toThrow('compiled-smoke-mutated');
      await expect(
        sealComparisonPayload({ root, sourceSeal: context.sourceSeal, privateParent: temp }),
      ).rejects.toThrow('compiled-smoke-source');
      await writeFile(file, before);
      expect(await verifyComparisonPayload(context)).toBe(true);
    });
    it('rejects the parent itself as well as parent-prefix and neighboring paths', () => {
      for (const path of [root, dirname(root), join(root, '../outside'), root + '-neighbor/file'])
        expect(() => ownedRelative(root, path)).toThrow();
      expect(ownedRelative(root, join(root, 'inside/file'))).toBe('inside/file');
    });
    it('rejects no-follow violations, hard links and input byte overflow', async () => {
      const file = join(temp, 'regular');
      await writeFile(file, '0123456789');
      await expect(hashRegularFile(file, 9)).rejects.toThrow();
      await expect(readBoundedRegularBytes(file, 9)).rejects.toThrow();
      expect((await readBoundedRegularBytes(file, 10)).bytes.toString()).toBe('0123456789');
      for (const bound of [NaN, Infinity, -1, 0.5])
        await expect(readBoundedRegularBytes(file, bound)).rejects.toThrow();
      const symbolic = join(temp, 'symbolic');
      await symlink(file, symbolic);
      await expect(hashRegularFile(symbolic)).rejects.toThrow();
      const hard = join(temp, 'hard');
      await link(file, hard);
      await expect(hashRegularFile(hard)).rejects.toThrow();
      await rm(hard);
      const tree = join(temp, 'tree');
      await mkdir(tree);
      await symlink(root, join(tree, 'linked'));
      await expect(snapshotRegularTree(tree, ['linked/src'])).rejects.toThrow();
    });
    it('uses the original absolute smoke script with no extra Chromium, trace or watchdog argument', () => {
      const invocation = unchangedSmokeInvocation(
        context,
        'B',
        { PATH: '/usr/bin', DISPLAY: ':99' },
        process.execPath,
      );
      expect(invocation.args).toEqual([join(root, 'scripts/desktop-smoke.mjs')]);
      expect(invocation.cwd).toBe(context.legs.B.privateRoot);
      expect(invocation).toMatchObject({
        shell: false,
        originalStageBudgets: true,
        automaticRetries: 0,
      });
      expect(invocation.env.MOTOBOUND_GPU_TRACE).toBe('0');
      expect(invocation.env.HOME).not.toBe(context.legs.A.privateRoot + '/home');
      expect(() => unchangedSmokeInvocation(context, 'B', {}, '/bin/sh')).toThrow();
    });
    it('rejects stale output and stale private profile state', async () => {
      await assertFreshComparisonLeg(context, 'A');
      const output = join(context.legs.A.privateRoot, 'desktop-evidence');
      await mkdir(output);
      await expect(assertFreshComparisonLeg(context, 'A')).rejects.toThrow();
      await rm(output, { recursive: true });
      const stale = join(context.legs.A.privateRoot, 'home/stale');
      await writeFile(stale, 'old');
      await expect(assertFreshComparisonLeg(context, 'A')).rejects.toThrow();
      await rm(stale);
    });
    it('exports only distinct comparison JSON and prefixed evidence, never a bare native report', async () => {
      for (const leg of ['A', 'B'] as const) {
        const output = join(context.legs[leg].privateRoot, 'desktop-evidence');
        await mkdir(output);
        const report = smoke(leg);
        report.source = { ...context.immutable.source };
        await writeFile(join(output, 'report.json'), JSON.stringify(report));
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lQAAAABJRU5ErkJggg==',
          'base64',
        );
        for (const name of [
          'packaged-babylon.png',
          'compatibility-formula.png',
          'compatibility-gp.png',
          'compatibility-mx.png',
          'compatibility-festival.png',
        ])
          await writeFile(join(output, name), png);
      }
      const outcome = await runRuntimeComparison({
        immutable: context.immutable,
        adapters: {
          verifyImmutable: async () => true,
          assertFresh: async () => {},
          verifyEmpty: async () => clean,
          execute: async () => exited,
          cleanup: async () => clean,
          removePrivateState: async () => {},
          collect: (leg, execution) => collectComparisonEvidence(context, leg, execution),
        },
      });
      const destination = join(temp, 'export');
      await exportComparisonEvidence(context, outcome, destination);
      const inventory = await snapshotRegularTree(destination);
      expect(inventory.files).toHaveLength(13);
      expect(
        inventory.files.every(
          (file) =>
            file.path === 'runtime-comparison.json' ||
            /^[AB]-(comparison-evidence\.json|compatibility-(formula|gp|mx|festival)\.png|packaged-babylon\.png)$/.test(
              file.path,
            ),
        ),
      ).toBe(true);
      const b = JSON.parse(await readFile(join(destination, 'B-comparison-evidence.json'), 'utf8'));
      expect(b).toMatchObject({
        schema: 'electron-runtime-comparison-leg-v1',
        requiredLaneQualification: false,
        declaredShippedElectron: '45.2.1',
        actualRuntime: { electron: '44.10.1' },
      });
      expect(isDeclaredRuntimeNativeEvidence(b)).toBe(false);
      expect(b.smoke.report.source.electron).toBe('45.2.1');
      await expect(exportComparisonEvidence(context, outcome, destination)).rejects.toThrow();
      const image = join(context.legs.A.privateRoot, 'desktop-evidence/packaged-babylon.png');
      const original = await readFile(image);
      await writeFile(image, 'changed after collection');
      const failedDestination = join(temp, 'must-not-commit');
      await expect(exportComparisonEvidence(context, outcome, failedDestination)).rejects.toThrow();
      await expect(lstat(failedDestination)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(temp)).some((name) => name.startsWith('.runtime-ab-export-'))).toBe(
        false,
      );
      await writeFile(image, original);
      for (const leg of ['A', 'B'] as const)
        await rm(join(context.legs[leg].privateRoot, 'desktop-evidence'), { recursive: true });
    });
    it('binds every retained envelope to source, leg, digest and final outcome before export', async () => {
      for (const leg of ['A', 'B'] as const) {
        const output = join(context.legs[leg].privateRoot, 'desktop-evidence');
        await mkdir(output);
        const report = {
          ...smoke(leg),
          source: context.immutable.source,
          success: false,
          failure: 'GPU exit 512',
        };
        await writeFile(join(output, 'report.json'), JSON.stringify(report));
      }
      const outcome = await runRuntimeComparison({
        immutable: context.immutable,
        adapters: {
          verifyImmutable: async () => true,
          assertFresh: async () => {},
          verifyEmpty: async () => clean,
          execute: async () => ({ ...exited, exitCode: 1 }),
          cleanup: async () => clean,
          removePrivateState: async () => {},
          collect: (leg, execution) => collectComparisonEvidence(context, leg, execution),
        },
      });
      const clone = (): ComparisonOutcome => ({
        summary: structuredClone(outcome.summary),
        retained: outcome.retained.map((item) => ({
          ...structuredClone(item),
          encoded: Buffer.from(item.encoded),
        })),
      });
      const resign = (changed: ComparisonOutcome) => {
        const item = changed.retained[0];
        item.encoded = Buffer.from(JSON.stringify(item.envelope) + '\n');
        item.sha256 = hash(item.encoded);
        changed.summary.legs[0].evidenceSha256 = item.sha256;
      };
      const variants: ComparisonOutcome[] = [];
      let changed = clone();
      changed.summary.legs[0].evidenceSha256 = '0'.repeat(64);
      variants.push(changed);
      changed = clone();
      changed.retained[0].envelope.nonpublishing = false;
      resign(changed);
      variants.push(changed);
      changed = clone();
      changed.retained[0].envelope = { leg: 'A', ...smoke('A') };
      resign(changed);
      variants.push(changed);
      changed = clone();
      changed.retained[0].envelope.extra = 'uncommitted object';
      variants.push(changed);
      changed = clone();
      changed.retained = [changed.retained[0], changed.retained[0]];
      variants.push(changed);
      changed = clone();
      changed.retained.pop();
      variants.push(changed);
      changed = clone();
      Object.assign(changed.summary.legs[0], {
        status: 'passed',
        reason: 'completed',
        exitCode: 0,
      });
      variants.push(changed);
      changed = clone();
      changed.retained[0].envelope.immutable = {
        ...context.immutable,
        payloadSha256: '0'.repeat(64),
      };
      resign(changed);
      variants.push(changed);
      changed = clone();
      changed.retained[0].images = [
        'packaged-babylon.png',
        'compatibility-formula.png',
        'compatibility-gp.png',
        'compatibility-mx.png',
        'compatibility-festival.png',
        'failure.png',
      ].map((name) => ({ name, bytes: 8 * 1024 * 1024, sha256: '0'.repeat(64) }));
      changed.retained[0].envelope.images = changed.retained[0].images;
      resign(changed);
      variants.push(changed);
      for (let index = 0; index < variants.length; index++) {
        const destination = join(temp, `rejected-export-${index}`);
        await expect(
          exportComparisonEvidence(context, variants[index], destination),
        ).rejects.toThrow();
        await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
      }
      const qualifiedOverride = clone();
      Object.assign(qualifiedOverride.summary.legs[1], {
        status: 'unqualified',
        reason: 'cleanup-uncertain',
        cleanupVerified: false,
      });
      await expect(
        exportComparisonEvidence(context, qualifiedOverride, join(temp, 'unqualified-evidence')),
      ).resolves.toBeDefined();
      for (const leg of ['A', 'B'] as const)
        await rm(join(context.legs[leg].privateRoot, 'desktop-evidence'), { recursive: true });
    });
    it('rejects owner-token leakage and oversized JSON before any export', async () => {
      const output = join(context.legs.A.privateRoot, 'desktop-evidence');
      await mkdir(output);
      const report = {
        ...smoke('A'),
        source: context.immutable.source,
        success: false,
        console: [context.legs.B.ownerToken],
      };
      await writeFile(join(output, 'report.json'), JSON.stringify(report));
      await expect(collectComparisonEvidence(context, 'A', exited)).rejects.toThrow(
        'evidence-sensitive',
      );
      const { truncate } = await import('node:fs/promises');
      await truncate(join(output, 'report.json'), 8 * 1024 * 1024 + 1);
      await expect(collectComparisonEvidence(context, 'A', exited)).rejects.toThrow('file-bound');
      await rm(output, { recursive: true });
    });
    it.each(['private.pftrace', 'gpu-trace-summary.json', 'run.log'])(
      'forbids unexpected retention %s even if empty',
      async (name) => {
        const output = join(context.legs.A.privateRoot, 'desktop-evidence');
        await mkdir(output);
        await writeFile(join(output, name), '');
        await expect(collectComparisonEvidence(context, 'A', exited)).rejects.toThrow();
        await rm(output, { recursive: true });
      },
    );
    it('never removes profiles without verified closure or after directory identity replacement', async () => {
      await expect(
        removeComparisonPrivateState(context, 'A', { ...clean, ok: false }),
      ).rejects.toThrow();
      const name = join(context.legs.A.privateRoot, 'tmp');
      const old = await lstat(name, { bigint: true });
      // Keep the old inode alive so the filesystem cannot immediately reuse it.
      const other = join(context.legs.A.privateRoot, 'old-tmp');
      const { rename } = await import('node:fs/promises');
      await rename(name, other);
      await mkdir(name, { mode: 0o700 });
      expect((await lstat(name, { bigint: true })).ino).not.toBe(old.ino);
      await expect(removeComparisonPrivateState(context, 'A', clean)).rejects.toThrow();
      await rm(name, { recursive: true });
      await rename(other, name);
      await removeComparisonPrivateState(context, 'A', clean);
      await expect(lstat(name)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(lstat(context.legs.B.privateRoot + '/tmp')).resolves.toBeDefined();
    });
  },
);
