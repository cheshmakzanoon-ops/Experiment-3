import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { indexedRibbonNormals } from '../src/engine/assets/indexed-ribbon-normals.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { renderRibbonCase } from './fixtures/circuit-ribbon-cases.ts';
import stress from './fixtures/circuit-ribbon-uint32-a937.json' with { type: 'json' };
const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const oracle = JSON.parse(
  gunzipSync(readFileSync('tests/fixtures/circuit-ribbon-a937.json.gz')).toString(),
) as {
  cases: {
    name: string;
    meshes: {
      attributes: Record<string, { bytes: string }>;
      index: { type: string; bytes: string };
    }[];
  }[];
};
for (const c of oracle.cases)
  it(`exact frozen normal bytes: ${c.name}`, () => {
    for (const mesh of c.meshes) {
      const p = Uint8Array.from(Buffer.from(mesh.attributes.position.bytes, 'base64'));
      const ix = Uint8Array.from(Buffer.from(mesh.index.bytes, 'base64'));
      const indices =
        mesh.index.type === 'Uint32Array' ? new Uint32Array(ix.buffer) : new Uint16Array(ix.buffer);
      const actual = indexedRibbonNormals(new Float32Array(p.buffer), indices);
      expect(bytes(actual).equals(Buffer.from(mesh.attributes.normal.bytes, 'base64'))).toBe(true);
    }
  });
it('matches frozen Uint32 stress normal hash', () => {
  const track = new Track('clear');
  const built = renderRibbonCase({
    name: 'stress',
    track,
    options: {
      start: 0,
      end: 5,
      step: 0.01,
      columns: 140,
      offset: (s, t) => (t * 2 - 1) * track.at(s, trackPoint()).width,
    },
  });
  try {
    const g = built.meshes[0].geometry;
    const normal = indexedRibbonNormals(
      g.getAttribute('position').array as Float32Array,
      g.index!.array as Uint32Array,
    );
    expect(createHash('sha256').update(bytes(normal)).digest('hex')).toBe(
      stress.case.meshes[0].attributes.normal.sha256,
    );
  } finally {
    built.meshes.forEach((m) => m.geometry.dispose());
    built.material.dispose();
  }
});
it('preserves zero, repeated-index and unreferenced normals exactly', () => {
  const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 3, 4, 5]);
  const i = new Uint16Array([0, 1, 2, 0, 0, 1, 2, 2, 2]);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(p, 3));
  g.setIndex(new T.BufferAttribute(i, 1));
  g.computeVertexNormals();
  expect(bytes(indexedRibbonNormals(p, i)).equals(bytes(g.getAttribute('normal').array))).toBe(
    true,
  );
  g.dispose();
});
