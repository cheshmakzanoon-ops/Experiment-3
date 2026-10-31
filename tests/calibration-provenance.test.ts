import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginCalibrationProvenance,
  CALIBRATION_SOURCE_SCOPE,
  calibrationFingerprint,
  calibrationGitIdentity,
  calibrationSourceRoot,
  finishCalibrationProvenance,
} from '../scripts/calibration-provenance.ts';

// Only the identity-boundary tests replace these two filesystem operations;
// Git init/commit/HEAD/status remain real, and all other tests use actual fs.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, realpathSync: vi.fn(fs.realpathSync), statSync: vi.fn(fs.statSync) };
});
const temporary: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});
const invocation = { simulationVersion: 19, strict: true, requestedVehicleIds: ['xf2'] };
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'calibration-provenance-'));
  temporary.push(path);
  return path;
}
function fixture(root = directory()) {
  for (const dir of ['src/core', 'src/simulation', 'src/rendering', 'scripts', 'docs/production'])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'src/core/math.ts'), 'export const g = 9.81;\n');
  writeFileSync(join(root, 'src/simulation/vehicle.ts'), 'export const solver = 1;\n');
  writeFileSync(
    join(root, 'src/simulation/vehicles.ts'),
    'export const definitionHash = "unchanged";\n',
  );
  writeFileSync(join(root, 'src/rendering/view.ts'), 'export const view = 1;\n');
  for (const path of CALIBRATION_SOURCE_SCOPE.filter((path) => !path.endsWith('/**')))
    writeFileSync(join(root, path), path.endsWith('.json') ? '{}\n' : '// fixture\n');
  return root;
}
function git(root: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function repository(root: string) {
  git(root, 'init', '-q', '--initial-branch=main');
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Calibration Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-qm',
    'fixture',
  );
}

describe('calibration source provenance', () => {
  it('fingerprints deterministic root-relative content, not directory names or creation order', () => {
    const a = fixture(),
      b = fixture();
    for (const root of [a, b]) {
      for (const name of root === a ? ['z.ts', 'a.ts'] : ['a.ts', 'z.ts'])
        writeFileSync(join(root, 'src', name), `// ${name}\n`);
    }
    const fingerprint = calibrationFingerprint(a);
    expect(fingerprint).toEqual(calibrationFingerprint(b));
    expect(fingerprint).toMatchObject({
      algorithm: 'sha256',
      serialization: 'json-array-of-relative-path-and-sha256-v1',
      scope: [...CALIBRATION_SOURCE_SCOPE],
      fileCount: 14,
    });
    expect(fingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([
    'src/simulation/vehicle.ts',
    'src/core/math.ts',
    'src/rendering/view.ts',
    ...CALIBRATION_SOURCE_SCOPE.filter((path) => !path.endsWith('/**')),
  ])('invalidates a changed %s while preserving the old report', (path) => {
    const root = fixture(),
      report = join(root, 'docs/vehicle-calibration.json');
    writeFileSync(report, '{"historical":true}\n');
    const before = beginCalibrationProvenance(root, invocation);
    const definitions = readFileSync(join(root, 'src/simulation/vehicles.ts'), 'utf8');
    writeFileSync(join(root, path), 'changed input\n');
    expect(() =>
      writeFileSync(report, JSON.stringify(finishCalibrationProvenance(before, ['xf2']))),
    ).toThrow(/Calibration source changed during measurement; no report written/);
    expect(readFileSync(report, 'utf8')).toBe('{"historical":true}\n');
    expect(readFileSync(join(root, 'src/simulation/vehicles.ts'), 'utf8')).toBe(definitions);
  });
  it.each(['addition', 'deletion'])('invalidates source file %s', (operation) => {
    const root = fixture(),
      before = beginCalibrationProvenance(root, invocation);
    if (operation === 'addition') writeFileSync(join(root, 'src/added.ts'), '// added\n');
    else rmSync(join(root, 'src/core/math.ts'));
    expect(() => finishCalibrationProvenance(before, ['xf2'])).toThrow(/source changed/);
  });
  it('excludes generated reports, disclosure, build output and unrelated evidence from its own hash', () => {
    const root = fixture(),
      before = beginCalibrationProvenance(root, invocation);
    mkdirSync(join(root, 'dist'));
    for (const path of [
      'docs/vehicle-calibration.json',
      'docs/production/CONTENT_PIPELINE.md',
      'dist/report.json',
    ])
      writeFileSync(join(root, path), 'new generated output\n');
    const result = finishCalibrationProvenance(before, ['xf2']);
    expect(result.source.fingerprintBefore).toEqual(result.source.fingerprintAfter);
    expect(result.source.stable).toBe(true);
  });
  it('records exact runtime and independent physics/invocation metadata without environment dumps', () => {
    const root = fixture(),
      requested = ['xf2'];
    const before = beginCalibrationProvenance(root, {
      ...invocation,
      requestedVehicleIds: requested,
    });
    requested.push('xt1');
    const result = finishCalibrationProvenance(before, ['xf2']);
    expect(result).toMatchObject({
      schemaVersion: 1,
      simulationVersion: 19,
      strict: true,
      selection: { requestedVehicleIds: ['xf2'], measuredVehicleIds: ['xf2'] },
    });
    expect(result.runtime).toEqual({
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    });
    expect(Object.keys(result).sort()).toEqual([
      'runtime',
      'schemaVersion',
      'selection',
      'simulationVersion',
      'source',
      'strict',
    ]);
    const full = finishCalibrationProvenance(
      beginCalibrationProvenance(root, {
        simulationVersion: 19,
        strict: false,
        requestedVehicleIds: null,
      }),
      ['xf2', 'xt1'],
    );
    expect(full.selection).toEqual({
      requestedVehicleIds: null,
      measuredVehicleIds: ['xf2', 'xt1'],
    });
    expect(full.strict).toBe(false);
  });
  it('resolves the source harness independently of a temporary output cwd', () => {
    const root = fixture(),
      output = directory();
    const harness = pathToFileURL(join(root, 'scripts/vehicle-calibration.ts')).href;
    const helper = new URL('../scripts/calibration-provenance.ts', import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--input-type=module',
        '-e',
        `
      import { calibrationSourceRoot, beginCalibrationProvenance, finishCalibrationProvenance } from ${JSON.stringify(helper)};
      const root = calibrationSourceRoot(${JSON.stringify(harness)});
      console.log(JSON.stringify(finishCalibrationProvenance(beginCalibrationProvenance(root, ${JSON.stringify(invocation)}), ['xf2'])));
    `,
      ],
      { cwd: output, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.source.root).toBe(realpathSync(root));
    expect(report.source.root).not.toBe(realpathSync(output));
    expect(report.source.fingerprintBefore).toEqual(calibrationFingerprint(root));
    expect(calibrationSourceRoot(harness)).toBe(realpathSync(root));
  });
  it('labels a source archive without Git metadata as unknown, not clean', () => {
    const root = fixture();
    expect(calibrationGitIdentity(root)).toBeNull();
    const result = finishCalibrationProvenance(beginCalibrationProvenance(root, invocation), [
      'xf2',
    ]);
    expect(result.source.gitBefore).toBeNull();
    expect(result.source.gitAfter).toBeNull();
    expect(result.source.fingerprintBefore.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('reports unknown Git metadata when Git is unavailable', () => {
    const root = fixture();
    repository(root);
    const helper = new URL('../scripts/calibration-provenance.ts', import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--input-type=module',
        '-e',
        `import { calibrationGitIdentity } from ${JSON.stringify(helper)};
         console.log(JSON.stringify(calibrationGitIdentity(${JSON.stringify(root)})));`,
      ],
      { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: '' } },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toBeNull();
  });
  it('does not borrow a parent repository commit for a nested source archive', () => {
    const parent = directory();
    writeFileSync(join(parent, 'parent.txt'), 'parent repository\n');
    repository(parent);
    const root = fixture(join(parent, 'archive'));
    expect(git(root, 'rev-parse', 'HEAD')).toBe(git(parent, 'rev-parse', 'HEAD'));
    expect(calibrationGitIdentity(root)).toBeNull();
  });
  it('does not let inherited Git directory/worktree overrides identify an archive as its parent', () => {
    const parent = directory();
    writeFileSync(join(parent, 'parent.txt'), 'parent repository\n');
    repository(parent);
    const root = fixture(join(parent, 'archive'));
    const helper = new URL('../scripts/calibration-provenance.ts', import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--input-type=module',
        '-e',
        `import { calibrationGitIdentity } from ${JSON.stringify(helper)};
         console.log(JSON.stringify(calibrationGitIdentity(${JSON.stringify(root)})));`,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GIT_DIR: join(parent, '.git'), GIT_WORK_TREE: root },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toBeNull();
  });
  it('records a verified clean checkout and separately captures later dirty Git state', () => {
    const root = fixture();
    repository(root);
    const before = beginCalibrationProvenance(root, invocation);
    const directoryIdentity = (path: string) => {
      const resolved = realpathSync(path);
      const stat = statSync(resolved, { bigint: true });
      return {
        resolved,
        device: String(stat.dev),
        inode: String(stat.ino),
        directory: stat.isDirectory(),
      };
    };
    // On a native runner, retain actionable path/ID diagnostics if verification
    // fails; the helper deliberately treats unavailable Git metadata as unknown.
    const diagnostic = JSON.stringify({
      source: directoryIdentity(root),
      git: directoryIdentity(git(root, 'rev-parse', '--show-toplevel')),
    });
    expect(before.git, diagnostic).toEqual({
      rootVerified: true,
      root: realpathSync(root),
      commit: git(root, 'rev-parse', 'HEAD'),
      dirty: false,
    });
    writeFileSync(join(root, 'docs/untracked-evidence.json'), '{}\n');
    const result = finishCalibrationProvenance(before, ['xf2']);
    expect(result.source.gitBefore?.dirty).toBe(false);
    expect(result.source.gitAfter?.dirty).toBe(true);
    expect(result.source.stable).toBe(true);
  });
  it.each([
    [
      String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\checkout`,
      String.raw`C:\Users\runneradmin\AppData\Local\Temp\checkout`,
    ],
    [String.raw`C:\Users\RunnerAdmin\Checkout`, String.raw`c:\users\runneradmin\checkout`],
    [String.raw`C:\Users\runneradmin\checkout`, 'C:/Users/runneradmin/checkout'],
  ])('verifies directory identity across path spellings %s and %s', (sourcePath, gitPath) => {
    const root = fixture();
    repository(root);
    const actual = statSync(root, { bigint: true });
    // Model native Windows path spellings on every host, with distinct objects
    // holding the same exact filesystem IDs. No Git results are mocked.
    vi.mocked(realpathSync).mockReturnValueOnce(sourcePath).mockReturnValueOnce(gitPath);
    vi.mocked(statSync)
      .mockReturnValueOnce(actual)
      .mockReturnValueOnce(Object.assign(Object.create(Object.getPrototypeOf(actual)), actual));
    expect(calibrationGitIdentity(root)).toEqual({
      rootVerified: true,
      root: sourcePath,
      commit: git(root, 'rev-parse', 'HEAD'),
      dirty: false,
    });
    expect(statSync).toHaveBeenCalledWith(sourcePath, { bigint: true });
    expect(statSync).toHaveBeenCalledWith(gitPath, { bigint: true });
  });
  it.each([
    'different device',
    'different inode',
    'large adjacent inode',
    'zero device',
    'zero inode',
    'not a directory',
  ])('rejects unverifiable filesystem identity: %s', (kind) => {
    const root = fixture();
    repository(root);
    const actual = statSync(root, { bigint: true });
    const source = Object.assign(Object.create(Object.getPrototypeOf(actual)), actual);
    const discovered = Object.assign(Object.create(Object.getPrototypeOf(actual)), actual);
    if (kind === 'different device') discovered.dev += 1n;
    if (kind === 'different inode') discovered.ino += 1n;
    if (kind === 'large adjacent inode') {
      source.ino = 2n ** 60n;
      discovered.ino = source.ino + 1n;
      expect(Number(source.ino)).toBe(Number(discovered.ino));
    }
    if (kind === 'zero device') source.dev = discovered.dev = 0n;
    if (kind === 'zero inode') source.ino = discovered.ino = 0n;
    if (kind === 'not a directory') discovered.isDirectory = () => false;
    vi.mocked(statSync).mockReturnValueOnce(source).mockReturnValueOnce(discovered);
    expect(calibrationGitIdentity(root)).toBeNull();
  });
  it('fails closed when directory identity cannot be read', () => {
    const root = fixture();
    repository(root);
    vi.mocked(statSync).mockImplementationOnce(() => {
      throw new Error('directory identity unavailable');
    });
    expect(calibrationGitIdentity(root)).toBeNull();
  });
  it('verifies a real directory alias without borrowing a nested archive identity', () => {
    const root = fixture();
    repository(root);
    const alias = join(directory(), 'checkout-alias');
    symlinkSync(root, alias, 'junction');
    expect(calibrationGitIdentity(alias)).toEqual({
      rootVerified: true,
      root: realpathSync(alias),
      commit: git(root, 'rev-parse', 'HEAD'),
      dirty: false,
    });
    fixture(join(root, 'archive'));
    expect(calibrationGitIdentity(join(alias, 'archive'))).toBeNull();
  });
  it('does not invent a commit for an unborn repository', () => {
    const root = fixture();
    git(root, 'init', '-q', '--initial-branch=main');
    expect(calibrationGitIdentity(root)).toBeNull();
  });
  it('fails closed for missing required harness inputs and scoped symlinks', () => {
    const root = fixture();
    rmSync(join(root, 'scripts/bike-calibration.ts'));
    expect(() => calibrationFingerprint(root)).toThrow();
    writeFileSync(join(root, 'scripts/bike-calibration.ts'), '// restored\n');
    symlinkSync(join(root, 'src/core/math.ts'), join(root, 'src/link.ts'));
    expect(() => calibrationFingerprint(root)).toThrow(/source contains a symlink/);
  });
  it('adds report identity without requiring historical fixtures to contain it', () => {
    const report = JSON.parse(
      readFileSync(new URL('../docs/vehicle-calibration.json', import.meta.url), 'utf8'),
    );
    expect(report.vehicles.xf2.hash).toMatch(/^[0-9a-f]{8}$/);
    const script = readFileSync(
      fileURLToPath(new URL('../scripts/vehicle-calibration.ts', import.meta.url)),
      'utf8',
    );
    const finished = script.indexOf('report.provenance = finishCalibrationProvenance(');
    const written = script.indexOf("writeFileSync('docs/vehicle-calibration.json'");
    expect(finished).toBeGreaterThanOrEqual(0);
    expect(written).toBeGreaterThan(finished);
    expect(script).toContain('if (!only) {');
  });
});
