import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build, version as esbuildVersion } from 'esbuild';

export { assert };
export const BASELINE = 'dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc';

// support.mjs is two directories below the repository root.
const repository = fileURLToPath(new URL('../..', import.meta.url));
const execute = promisify(execFile);
let importSequence = 0;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function git(...args) {
  const { stdout } = await execute('git', ['--no-optional-locks', '-C', repository, ...args], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function importBundle(code, label) {
  // Even identical bundles must have distinct module instances across variants/calls.
  const url =
    'data:text/javascript;base64,' +
    Buffer.from(code).toString('base64') +
    '#engine-runtime-' +
    label +
    '-' +
    importSequence++;
  return import(url);
}

/**
 * Build the same entry twice, replacing only the declared production .ts files
 * with their exact git-show bytes in the baseline bundle. Other dependencies
 * come from the candidate checkout in both variants. No files are written.
 */
export async function variants(entry, paths) {
  assert.equal(typeof entry, 'string', 'entry must be esbuild stdin source');
  assert.ok(Array.isArray(paths) && paths.length > 0, 'paths must be a nonempty array');
  assert.equal(new Set(paths).size, paths.length, 'replacement paths must be unique');

  const targets = paths.map((path) => {
    assert.equal(typeof path, 'string', 'replacement paths must be strings');
    assert.match(path, /^src\/.*\.ts$/, 'only production src/*.ts files may be replaced');
    const absolute = resolve(repository, path);
    assert.equal(
      relative(repository, absolute).split(sep).join('/'),
      path,
      'replacement paths must be normalized repository-relative paths',
    );
    return { path, absolute };
  });

  let baselineRef;
  try {
    baselineRef = (await git('rev-parse', '--verify', BASELINE + '^{commit}'))
      .toString('utf8')
      .trim();
  } catch (cause) {
    throw new Error(
      'Missing baseline commit. Fetch it before running: git fetch --no-tags origin ' + BASELINE,
      { cause },
    );
  }
  assert.equal(baselineRef, BASELINE, 'baseline must resolve to the pinned commit');

  const candidateHead = (await git('rev-parse', '--verify', 'HEAD')).toString('utf8').trim();
  const statusScope = [
    'src',
    'scripts/engine-runtime-probes',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
  ];
  const trackedStatus = async () =>
    (await git('status', '--porcelain=v1', '--untracked-files=no', '--', ...statusScope))
      .toString('utf8')
      .trimEnd();
  const candidateTrackedStatus = await trackedStatus();
  const sources = await Promise.all(
    targets.map(async (target) => {
      const [baseline, candidate] = await Promise.all([
        git('show', BASELINE + ':' + target.path),
        readFile(target.absolute),
      ]);
      return { ...target, baseline, candidate };
    }),
  );
  const baselineByAbsolute = new Map(sources.map((source) => [source.absolute, source.baseline]));
  const replaced = new Set();

  const options = {
    absWorkingDir: repository,
    stdin: {
      contents: entry,
      resolveDir: repository,
      sourcefile: 'engine-runtime-probe-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  };
  const [baselineBuild, candidateBuild] = await Promise.all([
    build({
      ...options,
      plugins: [
        {
          name: 'exact-git-baseline-sources',
          setup(builder) {
            builder.onLoad({ filter: /\.ts$/, namespace: 'file' }, (args) => {
              const absolute = resolve(args.path);
              const contents = baselineByAbsolute.get(absolute);
              if (contents === undefined) return undefined;
              replaced.add(absolute);
              return {
                contents: contents.toString('utf8'),
                loader: 'ts',
                resolveDir: dirname(absolute),
              };
            });
          },
        },
      ],
    }),
    // The candidate uses the ordinary esbuild loader and unmodified checkout.
    build(options),
  ]);

  for (const source of sources) {
    assert.ok(replaced.has(source.absolute), 'entry did not load baseline target: ' + source.path);
    assert.deepEqual(
      await readFile(source.absolute),
      source.candidate,
      'candidate target changed during bundling: ' + source.path,
    );
  }
  assert.equal(
    (await git('rev-parse', '--verify', 'HEAD')).toString('utf8').trim(),
    candidateHead,
    'candidate HEAD changed during bundling',
  );
  assert.equal(
    await trackedStatus(),
    candidateTrackedStatus,
    'tracked candidate source/probe status changed during bundling',
  );
  assert.equal(baselineBuild.outputFiles.length, 1, 'baseline must produce one in-memory bundle');
  assert.equal(candidateBuild.outputFiles.length, 1, 'candidate must produce one in-memory bundle');

  const baselineCode = baselineBuild.outputFiles[0].text;
  const candidateCode = candidateBuild.outputFiles[0].text;
  const provenance = {
    baselineRef,
    candidateHead,
    candidateSource: 'working-tree bytes, declared targets checked unchanged during bundling',
    candidateTrackedState: candidateTrackedStatus ? 'dirty' : 'clean',
    candidateTrackedChanges: candidateTrackedStatus ? candidateTrackedStatus.split('\n') : [],
    candidateTrackedStatusScope: statusScope,
    candidateStatusPolicy: 'Tracked changes only; untracked files are excluded from this status claim',
    nodeVersion: process.version,
    esbuildVersion,
    entrySha256: sha256(entry),
    scope: 'Only listed production files use the baseline ref; all other dependencies use the candidate checkout.',
    files: sources.map(({ path, baseline, candidate }) => ({
      path,
      baselineSha256: sha256(baseline),
      candidateSha256: sha256(candidate),
      baselineBytes: baseline.byteLength,
      candidateBytes: candidate.byteLength,
    })),
    bundles: {
      baselineSha256: sha256(baselineCode),
      candidateSha256: sha256(candidateCode),
    },
  };
  const baseline = await importBundle(baselineCode, 'baseline');
  const candidate = await importBundle(candidateCode, 'candidate');
  return { baseline, candidate, provenance };
}
