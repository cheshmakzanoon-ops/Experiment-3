import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import * as T from 'three';
import { ribbonOracleCases, renderRibbonCase } from './fixtures/circuit-ribbon-cases.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import stress from './fixtures/circuit-ribbon-uint32-a937.json' with { type: 'json' };

const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (array: ArrayBufferView) =>
  Buffer.from(array.buffer, array.byteOffset, array.byteLength);
interface ArrayOracle {
  type: string;
  bytes: string;
  itemSize?: number;
  normalized?: boolean;
}
interface MeshOracle {
  attributes: Record<string, ArrayOracle>;
  index: ArrayOracle;
  drawRange: { start: number; count: number | null };
  groups: { start: number; count: number; materialIndex?: number }[];
  castShadow: boolean;
  receiveShadow: boolean;
  strip: { width: number; centreline: number[][] } | null;
}
const compressed = readFileSync('tests/fixtures/circuit-ribbon-a937.json.gz');
const oracle = JSON.parse(gunzipSync(compressed).toString()) as {
  sourceCommit: string;
  sourceFileSHA256: string;
  caseFixtureSHA256: string;
  threeRevision: string;
  nodeVersion: string;
  cases: {
    name: string;
    circuit: string;
    start: number;
    end: number;
    first: number;
    meshes: MeshOracle[];
  }[];
};

it('pins independently captured a937 source and fixture evidence, never regenerating from candidate code', () => {
  expect(oracle.sourceCommit).toBe('a937cacf028ae81e3bd6c6fa3d4634f2295e4886');
  expect(oracle.sourceFileSHA256).toBe(
    'f7eb51d30f26a38bee10dee2bcf4ef3e18b69d67314aa33f52c536088380c920',
  );
  expect(sha(compressed)).toBe('c1f565980982ee6264b82ac4e43c98ee965f0734ad4512d85db082c4f2bd566b');
  expect(sha(readFileSync('tests/fixtures/circuit-ribbon-cases.ts'))).toBe(
    oracle.caseFixtureSHA256,
  );
  expect(oracle.threeRevision).toBe(T.REVISION);
  expect(oracle.cases).toHaveLength(13);
});

describe('source-equivalent Three ribbons after neutral buffer extraction', () => {
  for (const entry of ribbonOracleCases())
    it(entry.name, () => {
      const expected = oracle.cases.find((c) => c.name === entry.name)!;
      const before = sha(JSON.stringify(entry.track.points));
      const built = renderRibbonCase(entry);
      try {
        expect(entry.track.circuit.id).toBe(expected.circuit);
        expect(entry.options.start).toBe(expected.start);
        expect(entry.options.end).toBe(expected.end);
        expect(built.meshes).toHaveLength(expected.meshes.length);
        expect(built.meshes.indexOf(built.first)).toBe(expected.first);
        for (const [i, mesh] of built.meshes.entries()) {
          const reference = expected.meshes[i],
            geometry = mesh.geometry;
          expect(Object.keys(geometry.attributes)).toEqual(Object.keys(reference.attributes));
          for (const [name, attribute] of Object.entries(geometry.attributes)) {
            const saved = reference.attributes[name];
            expect(attribute.itemSize, name).toBe(saved.itemSize);
            expect(attribute.normalized, name).toBe(saved.normalized);
            expect(attribute.array.constructor.name, name).toBe(saved.type);
            // Compare EVERY byte, including all normal components and all custom
            // attributes. No epsilon, percentile, sampled points or golden update.
            expect(
              Buffer.compare(bytes(attribute.array), Buffer.from(saved.bytes, 'base64')),
              `${entry.name}/${i}/${name}`,
            ).toBe(0);
          }
          expect(geometry.index!.array.constructor.name).toBe(reference.index.type);
          expect(
            Buffer.compare(
              bytes(geometry.index!.array),
              Buffer.from(reference.index.bytes, 'base64'),
            ),
          ).toBe(0);
          expect(JSON.parse(JSON.stringify(geometry.drawRange))).toEqual(reference.drawRange);
          expect(geometry.groups).toEqual(reference.groups);
          expect(mesh.material).toBe(built.material);
          expect(mesh.castShadow).toBe(reference.castShadow);
          expect(mesh.receiveShadow).toBe(reference.receiveShadow);
          const strip = mesh.userData.strip;
          expect(
            strip
              ? {
                  width: strip.width,
                  centreline: strip.centreline.map((v: T.Vector3) => v.toArray()),
                }
              : null,
          ).toEqual(reference.strip);
        }
        expect(sha(JSON.stringify(entry.track.points))).toBe(before);
      } finally {
        built.meshes.forEach((mesh) => mesh.geometry.dispose());
        built.material.dispose();
      }
    });
});

it('preserves original Uint32 index transition and every stress-buffer byte hash', () => {
  expect(sha(readFileSync('tests/fixtures/circuit-ribbon-uint32-a937.json'))).toBe(
    'b567c355178ab8559b5ba7f83dfe3b3daf7a1124909005eaa14aabbc7c2a61ce',
  );
  expect(stress.sourceCommit).toBe(oracle.sourceCommit);
  const track = new Track('clear');
  const built = renderRibbonCase({
    name: stress.case.name,
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
    expect(built.meshes).toHaveLength(1);
    const geometry = built.meshes[0].geometry,
      expected = stress.case.meshes[0];
    expect(geometry.index!.array).toBeInstanceOf(Uint32Array);
    expect(Object.keys(geometry.attributes)).toEqual(Object.keys(expected.attributes));
    for (const [name, saved] of Object.entries(expected.attributes)) {
      const attribute = geometry.attributes[name];
      expect(attribute.itemSize).toBe(saved.itemSize);
      expect(attribute.normalized).toBe(saved.normalized);
      expect(attribute.array.constructor.name).toBe(saved.type);
      expect(attribute.array.byteLength).toBe(saved.byteLength);
      expect(sha(bytes(attribute.array)), name).toBe(saved.sha256);
    }
    expect(geometry.index!.array.constructor.name).toBe(expected.index.type);
    expect(geometry.index!.array.byteLength).toBe(expected.index.byteLength);
    expect(sha(bytes(geometry.index!.array))).toBe(expected.index.sha256);
  } finally {
    built.meshes.forEach((mesh) => mesh.geometry.dispose());
    built.material.dispose();
  }
});

it('keeps the extracted module renderer neutral and the existing owner responsible for normals and chunking', () => {
  const shared = readFileSync('src/engine/assets/circuit-ribbon-data.ts', 'utf8');
  const owner = readFileSync('src/rendering/circuit.ts', 'utf8');
  expect(shared).not.toMatch(/from ['"][^'"]*(?:three|babylon|rendering)/);
  expect(shared).not.toContain('computeVertexNormals');
  expect(owner).toContain('g.computeVertexNormals();');
  expect(owner).toContain('const pieces = Math.ceil((finish - begin) / 80);');
  expect(owner).toContain('const count = Math.ceil((end - start) / 80);');
  expect(owner).toContain(
    'if (width <= CircuitScene.STRIP_WIDTH) o.userData.strip = { centreline, width };',
  );
});

it('preserves the caller material, custom hooks and parent ownership without disposing source resources', () => {
  const track = new Track('clear'),
    surfaces = new T.Group();
  const scene = Object.assign(Object.create(CircuitScene.prototype), {
    track,
    surfaces,
    group: new T.Group(),
  }) as CircuitScene;
  const material = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
  const hook = () => {},
    key = () => 'source-hook-retained';
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = key;
  material.userData.retained = { original: true };
  let disposals = 0;
  material.addEventListener('dispose', () => {
    disposals++;
  });
  try {
    const first = scene.ribbon(material, {
      start: 0,
      end: 161,
      offset: (_s, t) => 4 + t * 0.14,
      height: () => 0.006,
    });
    expect(surfaces.children).toHaveLength(3);
    expect(first).toBe(surfaces.children[0]);
    for (const child of surfaces.children) {
      expect(child.parent).toBe(surfaces);
      expect((child as T.Mesh).material).toBe(material);
    }
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.userData.retained).toEqual({ original: true });
    expect(material.roughness).toBe(0.55);
    expect(disposals).toBe(0);
  } finally {
    surfaces.children.forEach((mesh) => (mesh as T.Mesh).geometry.dispose());
    material.dispose();
  }
});

it('has no transitive rendering-module or renderer-package dependency', () => {
  const queue = [resolve('src/engine/assets/circuit-ribbon-data.ts')],
    visited = new Set<string>();
  while (queue.length) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    expect(file).not.toContain('/rendering/');
    const source = readFileSync(file, 'utf8');
    // Include type imports as a stricter boundary; JSON data has no executable
    // module dependency. Check static, side-effect and literal dynamic imports.
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
      const name = match[1];
      expect(name).not.toBe('three');
      expect(name.startsWith('three/')).toBe(false);
      expect(name.startsWith('@babylonjs/')).toBe(false);
      if (name.startsWith('.') && name.endsWith('.ts')) queue.push(resolve(dirname(file), name));
    }
  }
  expect(visited.size).toBeGreaterThan(1);
});
