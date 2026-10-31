import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

interface BasisBuild {
  version: number;
  source: { commit: string };
  compiler: { sdkVersion: string; commit: string };
  settings: { DYNAMIC_EXECUTION: number; EMBIND_AOT: number; EXPORTED_RUNTIME_METHODS: string[] };
  recipe: string;
  recipeSHA256: string;
  files: Record<string, { bytes: number; sha256: string }>;
}
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
/** Asset refreshes must not overwrite the strict-CSP build with Three's dynamic
 * glue. The original codec and pinned build are verified independently of art. */
export function verifyBasisTranscoder(root: string) {
  const directory = join(root, 'public/assets/basis');
  const build = JSON.parse(readFileSync(join(directory, 'build.json'), 'utf8')) as BasisBuild;
  if (
    build.version !== 1 ||
    build.source.commit !== '051ad6d8a64bb95a79e8601c317055fd1782ad3e' ||
    build.compiler.sdkVersion !== '4.0.19' ||
    build.compiler.commit !== '7b4e60e4bfcba326025e373024369eaa9904af55' ||
    build.settings.DYNAMIC_EXECUTION !== 0 ||
    build.settings.EMBIND_AOT !== 1 ||
    !build.settings.EXPORTED_RUNTIME_METHODS.includes('HEAP8') ||
    build.recipe !== 'scripts/assets/build-basis-csp.sh'
  )
    throw new Error('Unexpected strict-CSP Basis build contract');
  if (sha256(readFileSync(join(root, build.recipe))) !== build.recipeSHA256)
    throw new Error('Basis build recipe changed without rebuilding the artifacts');
  for (const name of [
    'basis_transcoder.js',
    'basis_transcoder.wasm',
    'LICENSE.txt',
    'ZSTD_LICENSE.txt',
  ]) {
    const bytes = readFileSync(join(directory, name)),
      expected = build.files[name];
    if (!expected || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256)
      throw new Error(`Basis artifact integrity mismatch: ${name}`);
  }
  return build;
}
