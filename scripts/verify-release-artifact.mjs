import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Shared by Pages and the downloadable release. Both consume the gated bytes;
 * neither may rebuild, substitute a QA/demo build, or relabel a different source. */
export function verifyReleaseArtifact(directory, validatedSha, sourceRoot = process.cwd()) {
  if (!/^[0-9a-f]{40}$/.test(validatedSha)) throw new Error('Invalid validated source SHA');
  const walk = (path) => {
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink in release: ${path}`);
    if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) walk(join(path, name));
  };
  walk(directory);
  if (readFileSync(join(directory, 'SOURCE_COMMIT.txt'), 'utf8').trim() !== validatedSha)
    throw new Error('Release source marker differs from the validated commit');
  if (!readFileSync(join(directory, 'index.html')).length) throw new Error('Empty release entry');
  const identity = JSON.parse(readFileSync(join(directory, 'BUILD_IDENTITY.json'), 'utf8'));
  if (
    identity.version !== 1 ||
    identity.commit !== validatedSha ||
    !/^[0-9a-f]{64}$/.test(identity.fingerprint) ||
    identity.variant !== 'product'
  )
    throw new Error('Validated build identity differs from the gated source commit');
  if ((identity.edition ?? 'full') !== 'full')
    throw new Error(`Refusing to publish a "${identity.edition}" edition as the game`);
  for (const [family, filename] of [
    ['track-signal-hardware', 'aurel-track-signal-hardware.glb'],
    ['track-boards', 'aurel-track-boards.glb'],
    ['broadcast-cameras', 'aurel-broadcast-cameras.glb'],
    ['aurel-vegetation', 'aurel-vegetation.glb'],
    ['aurel-quarry', 'aurel-quarry.glb'],
    ['event-hall', 'aurel-event-hall.glb'],
    ['secondary-grandstands', 'aurel-secondary-grandstands.glb'],
  ]) {
    const source = JSON.parse(
      readFileSync(join(sourceRoot, `src/rendering/${family}.manifest.json`), 'utf8'),
    );
    const bundled = family === 'event-hall' || family === 'secondary-grandstands';
    if (bundled && source.exchange !== `public/models/${filename}`)
      throw new Error(`Unexpected authored exchange path: ${family}`);
    const manifest = bundled
      ? {
          url: source.exchange.slice(7),
          bytes: source.exchangeBytes,
          sha256: source.exchangeSHA256,
        }
      : source;
    const asset = `models/${filename}`;
    if (manifest.url !== asset) throw new Error(`Unexpected trackside asset path: ${family}`);
    const bytes = readFileSync(join(directory, asset));
    if (
      bytes.length !== manifest.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== manifest.sha256
    )
      throw new Error(`Validated asset differs from its source manifest: ${asset}`);
  }
  return identity;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 4)
    throw new Error('Usage: node scripts/verify-release-artifact.mjs <directory> <validated-sha>');
  verifyReleaseArtifact(process.argv[2], process.argv[3]);
}
