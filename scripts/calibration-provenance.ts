import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Deliberately includes all runtime source, not just definitions. Generated
 * reports are excluded: a calibration must not become an input to itself. */
export const CALIBRATION_SOURCE_SCOPE = Object.freeze([
  'src/**',
  'scripts/vehicle-calibration.ts',
  'scripts/bike-calibration.ts',
  'scripts/dynamics-fixtures.ts',
  'scripts/calibration-margins.ts',
  'scripts/calibration-provenance.ts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
]);

/** Resolve the executing harness, never its independently selected output cwd. */
export function calibrationSourceRoot(harnessURL: string | URL) {
  return realpathSync(fileURLToPath(new URL('..', harnessURL)));
}

export function calibrationFingerprint(root: string) {
  const entries: [string, string][] = [];
  function visit(relative: string) {
    const path = join(root, relative);
    const stat = lstatSync(path);
    // Do not follow a scoped link outside the checkout or hash only its name
    // while the runtime imports unaccounted-for target bytes.
    if (stat.isSymbolicLink())
      throw new Error(`Calibration source contains a symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`);
    } else if (stat.isFile()) {
      entries.push([relative, createHash('sha256').update(readFileSync(path)).digest('hex')]);
    } else throw new Error(`Unsupported calibration source input: ${relative}`);
  }
  for (const scope of CALIBRATION_SOURCE_SCOPE) visit(scope.replace(/\/\*\*$/, ''));
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    algorithm: 'sha256' as const,
    serialization: 'json-array-of-relative-path-and-sha256-v1' as const,
    scope: [...CALIBRATION_SOURCE_SCOPE],
    fileCount: entries.length,
    sha256: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
  };
}

/** Git is contextual metadata, not a substitute for the measured source hash.
 * An extracted archive nested in another checkout must not inherit its HEAD. */
export function calibrationGitIdentity(root: string) {
  try {
    // Git commands must discover this checkout, not an inherited override
    // pointing at some other repository or index. Never serialize this env.
    const environment = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE'])
      delete environment[key];
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: environment,
      }).trim();
    const sourceRoot = realpathSync(root);
    const gitRoot = realpathSync(git('rev-parse', '--show-toplevel'));
    // Windows Git can spell a directory differently (8.3, case or separators)
    // from Node's realpath. Verify the actual directory, not a case-folded path:
    // bigint IDs preserve all bits, and an archive has a different inode from
    // its parent checkout even when Git discovers that parent's HEAD.
    const source = statSync(sourceRoot, { bigint: true });
    const discovered = statSync(gitRoot, { bigint: true });
    if (
      !source.isDirectory() ||
      !discovered.isDirectory() ||
      source.dev <= 0n ||
      source.ino <= 0n ||
      source.dev !== discovered.dev ||
      source.ino !== discovered.ino
    )
      return null;
    const commit = git('rev-parse', 'HEAD');
    if (!/^[0-9a-f]{40}$/.test(commit)) return null;
    return {
      rootVerified: true as const,
      root: sourceRoot,
      commit,
      dirty: git('status', '--porcelain', '--untracked-files=normal') !== '',
    };
  } catch {
    // No invented clean status or parent-repository commit for source archives,
    // unborn repositories, unavailable git, or failed metadata reads.
    return null;
  }
}

export interface CalibrationInvocation {
  simulationVersion: number;
  strict: boolean;
  requestedVehicleIds: readonly string[] | null;
}
export function beginCalibrationProvenance(root: string, invocation: CalibrationInvocation) {
  root = realpathSync(root);
  return {
    root,
    git: calibrationGitIdentity(root),
    fingerprint: calibrationFingerprint(root),
    runtime: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
    invocation: {
      ...invocation,
      requestedVehicleIds: invocation.requestedVehicleIds
        ? [...invocation.requestedVehicleIds]
        : null,
    },
  };
}

/** Must finish before any output write. A mixed-source run cannot publish a
 * successful report, even if every measured number happened to be in band. */
export function finishCalibrationProvenance(
  before: ReturnType<typeof beginCalibrationProvenance>,
  measuredVehicleIds: readonly string[],
) {
  const after = calibrationFingerprint(before.root);
  if (before.fingerprint.sha256 !== after.sha256)
    throw new Error(
      `Calibration source changed during measurement; no report written ` +
        `(${before.fingerprint.sha256} -> ${after.sha256})`,
    );
  return {
    schemaVersion: 1,
    source: {
      root: before.root,
      gitBefore: before.git,
      gitAfter: calibrationGitIdentity(before.root),
      fingerprintBefore: before.fingerprint,
      fingerprintAfter: after,
      stable: true,
    },
    runtime: before.runtime,
    simulationVersion: before.invocation.simulationVersion,
    strict: before.invocation.strict,
    selection: {
      requestedVehicleIds: before.invocation.requestedVehicleIds,
      measuredVehicleIds: [...measuredVehicleIds],
    },
  };
}
