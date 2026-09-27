/** Deterministic, offline-only derivatives of the hash-pinned supplied GLB.
 * Indices only: source vertices, UVs, skin weights, materials and joints stay
 * byte-identical. Boundaries are locked and each material is simplified alone.
 * --update-manifest is an explicit authoring action, never part of normal CI. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier as simplifier } from 'meshoptimizer';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = JSON.parse(
  readFileSync(`${root}src/rendering/supplied-player.manifest.json`, 'utf8'),
);
const manifestPath = `${root}src/rendering/supplied-player-lods.manifest.json`;
const outputPath = `${root}public/models/supplied-player-lods.bin.gz`;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const update = process.argv.includes('--update-manifest');
const packed = readFileSync(`${root}public/models/supplied-player.glb.gz`);
if (sha(packed) !== source.compressedSHA256) throw new Error('Wrong player source');
const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
if (
  !update &&
  existing?.sourceSHA256 === source.sha256 &&
  existsSync(outputPath) &&
  sha(readFileSync(outputPath)) === existing.compressedSHA256
) {
  console.log('Player LODs already match the pinned derivative.');
  process.exit(0);
}
const raw = gunzipSync(packed);
if (sha(raw) !== source.sha256) throw new Error('Player source integrity failed');
const jsonLength = raw.readUInt32LE(12);
const document = JSON.parse(raw.subarray(20, 20 + jsonLength).toString());
const binary = raw.subarray(28 + jsonLength);
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const sizes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
function accessor(id) {
  const a = document.accessors[id],
    view = document.bufferViews[a.bufferView];
  if (a.sparse || a.normalized || !components[a.type] || !sizes[a.componentType])
    throw new Error(`Unsupported accessor ${id}`);
  const width = components[a.type],
    size = sizes[a.componentType];
  const offset = (view.byteOffset || 0) + (a.byteOffset || 0);
  const stride = view.byteStride || width * size;
  const result =
    a.componentType === 5126 ? new Float32Array(a.count * width) : new Uint32Array(a.count * width);
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < width; c++) {
      const p = offset + i * stride + c * size;
      result[i * width + c] =
        a.componentType === 5126
          ? binary.readFloatLE(p)
          : size === 1
            ? binary.readUInt8(p)
            : size === 2
              ? binary.readUInt16LE(p)
              : binary.readUInt32LE(p);
    }
  return result;
}
await simplifier.ready;
const rows = [],
  chunks = [],
  counts = [0, 0, 0, 0];
let indexOffset = 0;
// Near is for lower graphics presets only. High/inspection keeps the original.
// Error is an object-space simplifier tolerance, not a measured surface-deviation or visual-parity certificate.
const levels = [
  { name: 'efficient-close', ratio: 0.28, error: 0.00035 },
  { name: 'medium', ratio: 0.13, error: 0.0015 },
  { name: 'distant', ratio: 0.045, error: 0.006 },
];
for (let mesh = 0; mesh < document.meshes.length; mesh++) {
  let meshBefore = 0,
    meshAfter = 0;
  for (let primitive = 0; primitive < document.meshes[mesh].primitives.length; primitive++) {
    const prim = document.meshes[mesh].primitives[primitive];
    const position = accessor(prim.attributes.POSITION);
    const normal = accessor(prim.attributes.NORMAL),
      uv = accessor(prim.attributes.TEXCOORD_0);
    const indices = accessor(prim.indices),
      count = position.length / 3;
    const attrs = new Float32Array(count * 5);
    for (let v = 0; v < count; v++) {
      attrs.set(normal.subarray(v * 3, v * 3 + 3), v * 5);
      attrs.set(uv.subarray(v * 2, v * 2 + 2), v * 5 + 3);
    }
    // Lock every vertex whose skin weights differ from its neighbours. This
    // retains the deformation boundary rather than merging unlike bone owners.
    let lock = null;
    if (prim.attributes.JOINTS_0 !== undefined) {
      const joints = accessor(prim.attributes.JOINTS_0),
        weights = accessor(prim.attributes.WEIGHTS_0);
      lock = new Uint8Array(count);
      const same = (a, b) => {
        for (let c = 0; c < 4; c++)
          if (
            joints[a * 4 + c] !== joints[b * 4 + c] ||
            Math.abs(weights[a * 4 + c] - weights[b * 4 + c]) > 0.00001
          )
            return false;
        return true;
      };
      for (let t = 0; t < indices.length; t += 3)
        for (let edge = 0; edge < 3; edge++) {
          const a = indices[t + edge],
            b = indices[t + ((edge + 1) % 3)];
          if (!same(a, b)) lock[a] = lock[b] = 1;
        }
    }
    const row = { mesh, primitive, vertices: count, originalCount: indices.length, levels: [] };
    counts[0] += indices.length / 3;
    meshBefore += indices.length / 3;
    for (let level = 0; level < levels.length; level++) {
      const spec = levels[level];
      // Layered decals lie extremely close to painted/composite/tire surfaces.
      // Simplifying either surface independently can cause depth intersections
      // even when its individual geometric error is small. Preserve both sides
      // of that authored layering instead of hiding damage with a depth bias.
      const material = document.materials[prim.material];
      const liverySurface =
        material.alphaMode === 'BLEND' || /^(Paint|Tyre|Composite) \|/.test(material.name || '');
      const keep =
        liverySurface || indices.length <= 900 || mesh === 4 || mesh === 15 || mesh === 16;
      const [reduced, error] = keep
        ? [indices, 0]
        : simplifier.simplifyWithAttributes(
            indices,
            position,
            3,
            attrs,
            5,
            [0.008, 0.008, 0.008, 0.03, 0.03],
            lock,
            Math.max(3, Math.floor((indices.length * spec.ratio) / 3) * 3),
            spec.error,
            ['LockBorder', 'ErrorAbsolute'],
          );
      if (
        !reduced.length ||
        reduced.length % 3 ||
        reduced.some((v) => v >= count) ||
        !Number.isFinite(error) ||
        error > spec.error * 1.001
      )
        throw new Error('Invalid simplification result');
      const exact = reduced.length === indices.length;
      row.levels.push({ offset: exact ? -1 : indexOffset, count: reduced.length, error });
      if (!exact) {
        const bytes = Buffer.alloc(reduced.byteLength);
        reduced.forEach((v, i) => bytes.writeUInt32LE(v, i * 4));
        chunks.push(bytes);
        indexOffset += reduced.length;
      }
      counts[level + 1] += reduced.length / 3;
      if (level === 0) meshAfter += reduced.length / 3;
    }
    rows.push(row);
  }
  console.log(`mesh ${mesh}: ${meshBefore} -> ${meshAfter} near triangles`);
}
const header = Buffer.from(JSON.stringify({ version: 1, sourceSHA256: source.sha256, rows }));
const prefix = Buffer.alloc(8);
prefix.write('PLD1');
prefix.writeUInt32LE(header.length, 4);
const bytes = Buffer.concat([
  prefix,
  header,
  Buffer.alloc((4 - (header.length % 4)) % 4),
  ...chunks,
]);
const compressed = gzipSync(bytes, { level: 9 });
const result = {
  version: 1,
  generator:
    'meshoptimizer@0.25.0 / exact livery surfaces, locked boundaries and skin-weight seams',
  sourceSHA256: source.sha256,
  sha256: sha(bytes),
  compressedSHA256: sha(compressed),
  bytes: bytes.length,
  compressedBytes: compressed.length,
  primitives: rows.length,
  triangles: counts,
  levels,
};
if (!update && JSON.stringify(result) !== JSON.stringify(existing))
  throw new Error('LOD derivative differs from pinned manifest. Review before --update-manifest.');
writeFileSync(outputPath, compressed);
if (update) writeFileSync(manifestPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
