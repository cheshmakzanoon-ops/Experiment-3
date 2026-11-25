#!/usr/bin/env node
/** Reproduce the committed network snapshot/control comparison without npm hooks.
 * Example (from the repository root):
 * node scripts/bench/engine-followup-network.mjs --output /tmp/network.json
 * Only read-only git commands are used. The child uses a bounded 768 MiB old heap.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaults = {
  baseline: '1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb',
  current: 'f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6',
  pairs: '10',
  warmups: '3',
  'snapshot-iterations': '20000',
  'control-iterations': '524288',
};
const args = { ...defaults };
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!key.startsWith('--') || !process.argv[i + 1])
    throw new Error('Arguments must be --name value pairs.');
  const name = key.slice(2);
  if (!(name in defaults) && !['repo', 'output', 'work-dir'].includes(name))
    throw new Error(`Unknown argument ${key}`);
  args[name] = process.argv[i + 1];
}
const repo = path.resolve(args.repo ?? fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(path.join(repo, 'package.json'));
const { build, version: esbuildVersion } = require('esbuild');
const ts = require('typescript');
const git = (...gitArgs) =>
  execFileSync('git', gitArgs, { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const refs = Object.fromEntries(
  ['baseline', 'current'].map((role) => [role, git('rev-parse', `${args[role]}^{commit}`).trim()]),
);
const positiveInteger = (name) => {
  const value = Number(args[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid --${name}`);
  return value;
};
const settings = {
  pairs: positiveInteger('pairs'),
  warmups: positiveInteger('warmups'),
  snapshotIterations: positiveInteger('snapshot-iterations'),
  controlIterations: positiveInteger('control-iterations'),
};
const workDir = args['work-dir']
  ? path.resolve(args['work-dir'])
  : mkdtempSync(path.join(tmpdir(), 'engine-followup-network-'));
mkdirSync(workDir, { recursive: true });
const outputPath = path.resolve(args.output ?? path.join(workDir, 'network-measurement.json'));
mkdirSync(path.dirname(outputPath), { recursive: true });

// Each source is read from its committed tree. Relative imports remain within
// that tree; installed third-party packages resolve from the supplied repo.
const sources = new Map();
function getSource(role, sourcePath) {
  const key = `${role}/${sourcePath}`;
  if (!sources.has(key))
    sources.set(key, { role, path: sourcePath, text: git('show', `${refs[role]}:${sourcePath}`) });
  return sources.get(key);
}
const exports = [
  ['src/net/server.ts', ['RaceServer']],
  ['src/net/authority.ts', ['AuthoritativeWorld']],
  ['src/net/bytes.ts', ['ByteWriter', 'ByteReader']],
  ['src/net/input.ts', ['ServerInputQueue', 'quantizeControls', 'readControls', 'writeControls']],
  ['src/net/codec.ts', ['decodeServerMessage', 'encodeSnapshot']],
  ['src/net/snapshot.ts', ['CAR_FLAG', 'emptyCarState']],
  ['src/simulation/config.ts', ['controls']],
  ['src/simulation/race.ts', ['PHASE']],
];
const plugin = {
  name: 'committed-engine-source',
  setup(builder) {
    builder.onResolve({ filter: /^(baseline|current)-engine$/ }, ({ path: specifier }) => ({
      path: specifier.split('-')[0],
      namespace: 'engine-entry',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'engine-entry' }, ({ path: role }) => ({
      contents: exports
        .map(
          ([sourcePath, names]) =>
            `export { ${names.join(', ')} } from 'engine-${role}:${sourcePath}';`,
        )
        .join('\n'),
      loader: 'js',
      resolveDir: repo,
    }));
    builder.onResolve({ filter: /^engine-(baseline|current):/ }, ({ path: specifier }) => {
      const match = /^engine-(baseline|current):(.*)$/.exec(specifier);
      return { path: `${match[1]}/${match[2]}`, namespace: 'engine-git' };
    });
    builder.onResolve(
      { filter: /^\./, namespace: 'engine-git' },
      ({ path: specifier, importer }) => {
        const separator = importer.indexOf('/');
        const role = importer.slice(0, separator);
        const sourcePath = importer.slice(separator + 1);
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(sourcePath), specifier),
        );
        if (resolved.startsWith('../'))
          throw new Error('Source import escaped the committed tree.');
        return { path: `${role}/${resolved}`, namespace: 'engine-git' };
      },
    );
    builder.onLoad({ filter: /.*/, namespace: 'engine-git' }, ({ path: key }) => {
      const separator = key.indexOf('/');
      const role = key.slice(0, separator);
      const sourcePath = key.slice(separator + 1);
      const extension = path.posix.extname(sourcePath);
      const loader = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.mjs': 'js', '.json': 'json' }[
        extension
      ];
      if (!loader) throw new Error(`Unsupported committed source extension: ${sourcePath}`);
      return { contents: getSource(role, sourcePath).text, loader, resolveDir: repo };
    });
  },
};
const workloadPath = fileURLToPath(
  new URL('./engine-followup-network-workload.mjs', import.meta.url),
);
const bundlePath = path.join(workDir, 'network-workload.bundle.mjs');
await build({
  entryPoints: [workloadPath],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  plugins: [plugin],
  logLevel: 'silent',
});

function declaration(role, sourcePath, kind, name, member) {
  const text = getSource(role, sourcePath).text;
  const file = ts.createSourceFile(sourcePath, text, ts.ScriptTarget.Latest, true);
  const node = file.statements.find(
    (statement) => statement.kind === kind && statement.name?.text === name,
  );
  if (!node) throw new Error(`Cannot find ${name} in ${role}:${sourcePath}`);
  if (!member) return node.getText(file);
  const method = node.members.find((candidate) => candidate.name?.getText(file) === member);
  if (!method) throw new Error(`Cannot find ${name}.${member}`);
  return method.getText(file);
}
const sameSource = {};
for (const name of ['writeControls', 'readControls']) {
  const before = declaration(
    'baseline',
    'src/net/input.ts',
    ts.SyntaxKind.FunctionDeclaration,
    name,
  );
  const after = declaration('current', 'src/net/input.ts', ts.SyntaxKind.FunctionDeclaration, name);
  sameSource[name] = { equal: before === after, sha256: sha256(before) };
  if (before !== after) throw new Error(`${name} changed: update the equivalence rationale.`);
}
for (const name of ['capture', 'acceleration', 'clearContacts', 'tick']) {
  const before = declaration(
    'baseline',
    'src/net/authority.ts',
    ts.SyntaxKind.ClassDeclaration,
    'AuthoritativeWorld',
    name,
  );
  const after = declaration(
    'current',
    'src/net/authority.ts',
    ts.SyntaxKind.ClassDeclaration,
    'AuthoritativeWorld',
    name,
  );
  sameSource[`AuthoritativeWorld.${name}`] = { equal: before === after, sha256: sha256(before) };
  if (before !== after)
    throw new Error(`AuthoritativeWorld.${name} changed: update the timing attribution.`);
}
for (const sourcePath of ['src/net/bytes.ts', 'src/net/codec.ts', 'src/net/snapshot.ts']) {
  const before = getSource('baseline', sourcePath).text;
  const after = getSource('current', sourcePath).text;
  sameSource[sourcePath] = { equal: before === after, sha256: sha256(before) };
  if (before !== after) throw new Error(`${sourcePath} changed: update the benchmark assumptions.`);
}
const oldQuantizer = declaration(
  'baseline',
  'src/net/input.ts',
  ts.SyntaxKind.FunctionDeclaration,
  'quantizeControls',
);
const newQuantizer = declaration(
  'current',
  'src/net/input.ts',
  ts.SyntaxKind.FunctionDeclaration,
  'quantizeControls',
);
if (
  !oldQuantizer.includes('new ByteWriter(8)') ||
  !oldQuantizer.includes('new ByteReader(w.finish())')
)
  throw new Error('The baseline no longer matches the documented eight-temporary source path.');
if (/new\s+(?:ByteWriter|ByteReader)|\b(?:writeControls|readControls)\s*\(/.test(newQuantizer))
  throw new Error('The current quantizer has a temporary byte-storage call path.');
const sourceList = [...sources.values()].sort((a, b) =>
  `${a.role}/${a.path}`.localeCompare(`${b.role}/${b.path}`),
);
const blobs = git('rev-parse', ...sourceList.map((source) => `${refs[source.role]}:${source.path}`))
  .trim()
  .split('\n');
const manifest = sourceList.map((source, index) => ({
  role: source.role,
  path: source.path,
  blob: blobs[index],
  sha256: sha256(source.text),
}));
const metadata = {
  refs,
  sourceBlobs: manifest.filter(({ path: sourcePath }) => exports.some(([p]) => p === sourcePath)),
  dependencyManifestSha256: sha256(JSON.stringify(manifest)),
  committedModuleCount: manifest.length,
  sourceEquivalence: sameSource,
  quantizerSourceSha256: { baseline: sha256(oldQuantizer), current: sha256(newQuantizer) },
  runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  workloadSha256: sha256(readFileSync(workloadPath)),
  bundleSha256: sha256(readFileSync(bundlePath)),
  esbuildVersion,
  typescriptVersion: ts.version,
};
const configPath = path.join(workDir, 'network-config.json');
writeFileSync(configPath, JSON.stringify({ settings, metadata }, null, 2) + '\n');
const execution = spawnSync(
  process.execPath,
  ['--expose-gc', '--max-old-space-size=768', bundlePath, configPath],
  {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
if (execution.status !== 0)
  throw new Error(
    `Measurement child failed (${execution.status ?? execution.signal}): ${execution.stdout}`,
  );
const result = JSON.parse(execution.stdout);
writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
const manifestPath = outputPath.replace(/(?:\.json)?$/, '.sources.json');
writeFileSync(manifestPath, JSON.stringify({ refs, modules: manifest }, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      output: outputPath,
      sources: manifestPath,
      snapshots: result.snapshotTimings.map(({ recipients, summary }) => ({
        recipients,
        ...summary,
      })),
      quantization: result.controlTiming.summary,
      equivalence: result.controlEquivalence,
    },
    null,
    2,
  ),
);
