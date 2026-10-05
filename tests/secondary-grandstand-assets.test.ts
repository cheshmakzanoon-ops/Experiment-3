import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import source from '../src/rendering/secondary-grandstands.geometry.json' with { type: 'json' };
import manifest from '../src/rendering/secondary-grandstands.manifest.json' with { type: 'json' };
import {
  decodeSecondaryStands,
  secondaryStandGeometry,
  SECONDARY_MESHES,
} from '../src/rendering/secondary-grandstand-assets.ts';

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
function changed(change: (value: typeof source) => void) {
  const value = structuredClone(source);
  change(value);
  return value;
}
const dims = { SCALAR: 1, VEC2: 2, VEC3: 3 };
interface Accessor {
  bufferView: number;
  byteOffset?: number;
  count: number;
  componentType: 5123 | 5125 | 5126;
  type: keyof typeof dims;
}
interface Glb {
  nodes: { name: string; mesh: number }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  buffers: { uri?: string }[];
  images?: unknown[];
  materials: unknown[];
}
describe('A12 authored geometry and source integrity', () => {
  it('matches native, author, GLB and runtime identities with no hidden regeneration', () => {
    for (const [path, hash] of [
      [manifest.source, manifest.sourceSHA256],
      [manifest.editable, manifest.editableSHA256],
      [manifest.exchange, manifest.exchangeSHA256],
      ['src/rendering/secondary-grandstands.geometry.json', manifest.runtimeSHA256],
    ])
      expect(sha(readFileSync(path))).toBe(hash);
    expect(readFileSync(manifest.editable).length).toBeGreaterThan(100000);
    expect(manifest.finalArtApproved).toBe(false);
  });
  it('bundles exact GLB accessors including normals, UVs and all three index tiers', () => {
    const raw = readFileSync(manifest.exchange);
    expect(raw.length).toBe(manifest.exchangeBytes);
    expect(raw.readUInt32LE(0)).toBe(0x46546c67);
    expect(raw.readUInt32LE(4)).toBe(2);
    expect(raw.readUInt32LE(8)).toBe(raw.length);
    const size = raw.readUInt32LE(12);
    expect(raw.readUInt32LE(16)).toBe(0x4e4f534a);
    const doc: Glb = JSON.parse(raw.subarray(20, 20 + size).toString());
    expect(raw.readUInt32LE(24 + size)).toBe(0x004e4942);
    const binary = raw.subarray(28 + size);
    expect(doc.buffers.every((b) => !b.uri)).toBe(true);
    expect(doc.images ?? []).toEqual([]);
    expect(doc.materials.length).toBe(5);
    for (const name of SECONDARY_MESHES) {
      const node = doc.nodes.find((n) => n.name === `A12_${name}`)!;
      const primitives = doc.meshes[node.mesh].primitives;
      expect(primitives).toHaveLength(1);
      const primitive = primitives[0];
      for (const [attribute, semantic] of [
        ['position', 'POSITION'],
        ['normal', 'NORMAL'],
        ['uv', 'TEXCOORD_0'],
        ['index', 'index'],
      ] as const) {
        const a =
          doc.accessors[semantic === 'index' ? primitive.indices : primitive.attributes[semantic]];
        const view = doc.bufferViews[a.bufferView];
        const bytes = dims[a.type] * (a.componentType === 5123 ? 2 : 4);
        const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
        const result = Buffer.concat(
          Array.from({ length: a.count }, (_, i) =>
            binary.subarray(
              offset + i * (view.byteStride ?? bytes),
              offset + i * (view.byteStride ?? bytes) + bytes,
            ),
          ),
        );
        const encoded = source.meshes[name][attribute];
        expect(result.equals(Buffer.from(encoded.data, 'base64'))).toBe(true);
        expect(a.count).toBe(encoded.count);
        expect(a.componentType).toBe(encoded.componentType);
      }
    }
  });
  for (const [label, value] of [
    ['null root', null],
    ['wrong units', { ...source, units: 'centimetres' }],
    [
      'missing roof',
      changed((s) => {
        delete (s.meshes as Partial<typeof s.meshes>).roof_far;
      }),
    ],
    [
      'truncated accessor',
      changed((s) => {
        s.meshes.roof_near.position.data = s.meshes.roof_near.position.data.slice(0, -4);
      }),
    ],
    [
      'invalid alphabet',
      changed((s) => {
        s.meshes.roof_near.position.data = '!' + s.meshes.roof_near.position.data.slice(1);
      }),
    ],
    [
      'oversized count',
      changed((s) => {
        s.meshes.roof_near.position.count = 2 ** 30;
      }),
    ],
    [
      'wrong element type',
      changed((s) => {
        s.meshes.post_near.position.componentType = 5125;
      }),
    ],
    [
      'wrong normal dimension',
      changed((s) => {
        s.meshes.post_near.normal.itemSize = 2;
      }),
    ],
    [
      'nonfinite position',
      changed((s) => {
        const b = Buffer.from(s.meshes.post_near.position.data, 'base64');
        b.writeFloatLE(NaN, 0);
        s.meshes.post_near.position.data = b.toString('base64');
      }),
    ],
    [
      'invalid normal',
      changed((s) => {
        const b = Buffer.from(s.meshes.post_near.normal.data, 'base64');
        b.writeFloatLE(9, 0);
        s.meshes.post_near.normal.data = b.toString('base64');
      }),
    ],
    [
      'out of range index',
      changed((s) => {
        const b = Buffer.from(s.meshes.post_near.index.data, 'base64');
        b.writeUInt16LE(65535, 0);
        s.meshes.post_near.index.data = b.toString('base64');
      }),
    ],
  ] as const)
    it(`rejects ${label}`, () => expect(() => decodeSecondaryStands(value)).toThrow());
  it('owns fresh buffers per scene while retaining the entire allocation budget', () => {
    let total = 0;
    for (const name of SECONDARY_MESHES) {
      const a = secondaryStandGeometry(name),
        b = secondaryStandGeometry(name);
      expect(a.index?.array).not.toBe(b.index?.array);
      expect(a.getAttribute('position').array).not.toBe(b.getAttribute('position').array);
      expect(a.index?.count).toBe(manifest.triangles[name] * 3);
      total += manifest.triangles[name];
      a.dispose();
      b.dispose();
    }
    expect(SECONDARY_MESHES).toHaveLength(30);
    expect(total).toBeLessThan(12000);
  });
});
