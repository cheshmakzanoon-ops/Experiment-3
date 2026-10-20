import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gpTorsoGeometry, shapeGpSuitGeometry } from '../src/rendering/gp-rider-suit.ts';
import { Rider } from '../src/rendering/rider.ts';

beforeAll(() => {
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());
const colours = { primary: 0xc12437, secondary: 0x18212a, accent: 0xf2e9d7 };

describe('GP torso and limb silhouette continuity', () => {
  it.each(['high', 'mid'] as const)(
    '%s has one closed torso/housing shell within the old combined topology budget',
    (detail) => {
      const geometry = shapeGpSuitGeometry(gpTorsoGeometry(detail), 'torso'),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        shell = new T.Mesh(geometry, material),
        position = geometry.getAttribute('position'),
        uv = geometry.getAttribute('uv'),
        normal = geometry.getAttribute('normal'),
        index = geometry.index!,
        edges = new Map<string, number>(),
        adjacency = new Map<string, Set<string>>(),
        keys = Array.from({ length: position.count }, (_, i) =>
          [position.getX(i), position.getY(i), position.getZ(i)]
            .map((v) => Math.round(v * 1e7))
            .join('/'),
        ),
        a = new T.Vector3(),
        b = new T.Vector3(),
        c = new T.Vector3();
      try {
        expect(index.count / 3).toBeLessThanOrEqual(detail === 'high' ? 1760 : 528);
        for (const attribute of Object.values(geometry.attributes))
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        for (let i = 0; i < position.count; i++)
          expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
        for (let i = 0; i < index.count; i += 3) {
          const ia = index.getX(i),
            ib = index.getX(i + 1),
            ic = index.getX(i + 2);
          a.fromBufferAttribute(position, ia);
          b.fromBufferAttribute(position, ib);
          c.fromBufferAttribute(position, ic);
          expect(b.sub(a).cross(c.sub(a)).lengthSq()).toBeGreaterThan(1e-18);
          const uvArea = Math.abs(
            (uv.getX(ib) - uv.getX(ia)) * (uv.getY(ic) - uv.getY(ia)) -
              (uv.getX(ic) - uv.getX(ia)) * (uv.getY(ib) - uv.getY(ia)),
          );
          expect(uvArea).toBeGreaterThan(1e-8);
          for (const [from, to] of [
            [ia, ib],
            [ib, ic],
            [ic, ia],
          ]) {
            const edge = [keys[from], keys[to]].sort().join('|');
            edges.set(edge, (edges.get(edge) ?? 0) + 1);
            const neighbours = adjacency.get(keys[from]) ?? new Set();
            neighbours.add(keys[to]);
            adjacency.set(keys[from], neighbours);
          }
        }
        expect([...edges.values()].every((count) => count === 2)).toBe(true);
        const seen = new Set<string>(),
          pending = [keys[0]];
        while (pending.length) {
          const key = pending.pop()!;
          if (seen.has(key)) continue;
          seen.add(key);
          pending.push(...adjacency.get(key)!);
        }
        // An overlapping, detached hump can be watertight too; requiring one
        // connected shell prevents that regression from passing the edge test.
        expect(seen.size).toBe(new Set(keys).size);
        shell.updateMatrixWorld(true);
        const ray = new T.Raycaster(),
          forward = new T.Vector3(0, 0, 1);
        let previous = 0;
        for (let x = -0.15; x < 0.151; x += 0.015) {
          ray.set(new T.Vector3(x + 0.00017, 0.423, -0.5), forward);
          const hits = ray.intersectObject(shell);
          // One outer back and one chest surface, with no buried second shell.
          expect(hits).toHaveLength(2);
          if (x > -0.15) expect(Math.abs(hits[0].point.z - previous)).toBeLessThan(0.035);
          previous = hits[0].point.z;
        }
      } finally {
        geometry.dispose();
        material.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s embeds the sleeve and trouser end caps inside the torso through riding and recovery',
    (detail) => {
      const rider = new Rider(colours, detail, 'leathers', 2, true),
        torso = rider.root.getObjectByName('Rider torso')!,
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        shell = new T.Mesh(shapeGpSuitGeometry(gpTorsoGeometry(detail), 'torso'), material),
        garments: T.SkinnedMesh[] = [],
        point = new T.Vector3(),
        intoTorso = new T.Matrix4(),
        ray = new T.Raycaster(),
        direction = new T.Vector3(0.019, 0.013, 1).normalize(),
        exposed: string[] = [];
      let minSaddleDiameter = 1;
      rider.root.traverse((object) => {
        if (object instanceof T.SkinnedMesh) garments.push(object);
      });
      const check = (label: string) => {
        rider.root.updateMatrixWorld(true);
        intoTorso.copy(torso.matrixWorld).invert();
        for (const garment of garments) {
          const positions = garment.geometry.getAttribute('position'),
            uv = garment.geometry.getAttribute('uv'),
            weights = garment.geometry.getAttribute('skinWeight'),
            a = new T.Vector3(),
            b = new T.Vector3();
          let start = -1;
          let minimum = Infinity;
          for (let i = 0; i < positions.count; i++) minimum = Math.min(minimum, positions.getY(i));
          for (let i = 0; i < positions.count; i++) {
            if (uv.getX(i) === 0) start = i;
            if (uv.getX(i) === 0.5 && start >= 0 && weights.getX(i) > 0 && weights.getX(i) < 1) {
              const bind = a
                .fromBufferAttribute(positions, i)
                .distanceTo(b.fromBufferAttribute(positions, start));
              garment.getVertexPosition(i, a);
              garment.getVertexPosition(start, b);
              minSaddleDiameter = Math.min(minSaddleDiameter, a.distanceTo(b) / bind);
            }
            if (Math.abs(positions.getY(i) - minimum) > 1e-7) continue;
            garment
              .getVertexPosition(i, point)
              .applyMatrix4(garment.matrixWorld)
              .applyMatrix4(intoTorso);
            ray.set(point, direction);
            // The cap must be inside the closed torso volume: one forward
            // exit, never zero (outside) or two (outside behind the shell).
            if (ray.intersectObject(shell).length !== 1)
              exposed.push(`${label}: ${garment.name} ${i} ${point.toArray().join(',')}`);
          }
        }
      };
      try {
        for (const lean of [-1.1, 0, 1.1])
          for (const tuck of [0, 1])
            for (const braking of [0, 1]) {
              rider.ride({ lean, offset: lean * 0.2, tuck, braking, steer: lean * 0.3 });
              check(`${lean}/${tuck}/${braking}`);
            }
        for (const phase of [0, 1, 2]) {
          rider.separated(phase, 2.1, 0.43);
          check(`recovery ${phase}`);
        }
        expect(exposed.slice(0, 10)).toEqual([]);
        expect(minSaddleDiameter).toBeGreaterThan(0.5);
      } finally {
        rider.dispose();
        shell.geometry.dispose();
        material.dispose();
      }
    },
  );
});
