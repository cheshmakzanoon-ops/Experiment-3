import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, staticSag } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import {
  addMotocrossPowertrain,
  motocrossAxleLug,
  motocrossExpansionChamber,
  motocrossSilencerOutlet,
  motocrossSumpGuard,
  motocrossSwingarmRail,
} from '../src/rendering/offroad/motocross-castings.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

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

function inspect(geometry: T.BufferGeometry) {
  const material = new T.MeshBasicMaterial(),
    mesh = new T.Mesh(geometry, material),
    ray = new T.Raycaster();
  return {
    cast(origin: T.Vector3, direction: T.Vector3) {
      ray.set(origin, direction);
      return ray.intersectObject(mesh);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

describe('motocross cast components', () => {
  it('gives the two-stroke a lower cylinder/head without the four-stroke cam housing', () => {
    const materials = new BikeMaterials(0),
      twoStroke = new T.Group(),
      fourStroke = new T.Group();
    try {
      for (const [group, cycle] of [
        [twoStroke, 'two-stroke'],
        [fourStroke, 'four-stroke'],
      ] as const)
        addMotocrossPowertrain(
          group,
          'high',
          materials,
          materials.aluminium,
          materials.dark,
          cycle,
        );
      expect(twoStroke.getObjectByName('Motocross shouldered cam cover')).toBeUndefined();
      const head = new T.Box3().setFromObject(
          twoStroke.getObjectByName('Motocross compact two-stroke cylinder head')!,
        ),
        cam = new T.Box3().setFromObject(
          fourStroke.getObjectByName('Motocross shouldered cam cover')!,
        ),
        jacket = new T.Box3().setFromObject(
          twoStroke.getObjectByName('Motocross compact two-stroke water jacket')!,
        );
      expect(head.max.y).toBeLessThan(cam.max.y - 0.06);
      expect(head.getSize(new T.Vector3()).y).toBeLessThan(0.075);
      expect(jacket.getSize(new T.Vector3()).y).toBeLessThan(0.155);
      expect(head.min.y).toBeLessThan(jacket.max.y);
    } finally {
      for (const group of [twoStroke, fourStroke])
        group.traverse((object) => {
          if (object instanceof T.Mesh) object.geometry.dispose();
        });
      materials.dispose();
    }
  });

  it.each(['high', 'mid', 'far'] as const)(
    '%s two-stroke chamber has continuous open ends, a broad belly and a connected silencer stinger',
    (detail) => {
      const geometry = motocrossExpansionChamber(detail);
      try {
        const position = geometry.getAttribute('position'),
          uv = geometry.getAttribute('uv'),
          rows = new Map<number, number[]>(),
          point = (i: number) => new T.Vector3().fromBufferAttribute(position, i);
        for (let i = 0; i < position.count; i++) {
          const row = rows.get(uv.getY(i)) ?? [];
          row.push(i);
          rows.set(uv.getY(i), row);
        }
        const rings = [...rows.values()],
          centres = rings.map((ring) => {
            const centre = new T.Vector3();
            for (const i of ring.slice(0, -1)) centre.add(point(i));
            return centre.divideScalar(ring.length - 1);
          }),
          radii = rings.map((ring, i) => point(ring[0]).distanceTo(centres[i])),
          inlet = new T.Vector3(0, 0, 0.151)
            .applyAxisAngle(new T.Vector3(1, 0, 0), 0.22)
            .add(new T.Vector3(-0.177, -0.005, -0.615)),
          outletDirection = new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(1, 0, 0), 0.22),
          lastDirection = centres.at(-1)!.clone().sub(centres.at(-2)!).normalize();
        expect(centres[0].distanceTo(new T.Vector3(0, -0.225, 0.096))).toBeLessThan(0.000001);
        expect(centres.at(-1)!.distanceTo(inlet)).toBeLessThan(0.000001);
        expect(lastDirection.dot(outletDirection)).toBeGreaterThan(0.999);
        expect(radii[0]).toBeCloseTo(0.022, 5);
        expect(radii.at(-1)!).toBeCloseTo(0.018, 5);
        expect(Math.max(...radii)).toBeGreaterThan(0.078);
        expect(Math.max(...radii)).toBeLessThan(0.085);
        expect(geometry.boundingBox!.min.y).toBeGreaterThan(-0.47);
        expect(geometry.boundingBox!.max.z).toBeLessThan(0.32);
        expect(geometry.index!.count / 3).toBeLessThan(4000);
        // Collapse only the duplicated UV seam, then require every internal
        // edge to join exactly two faces. A disconnected cone or capped end
        // cannot pass this check even if its silhouette looks continuous.
        const vertices = new Map<string, number>(),
          ids = Array.from({ length: position.count }, (_, i) => {
            const key = point(i)
              .toArray()
              .map((v) => Math.round(v * 1e6))
              .join(',');
            if (!vertices.has(key)) vertices.set(key, vertices.size);
            return vertices.get(key)!;
          }),
          edges = new Map<string, number>(),
          index = geometry.index!;
        for (let i = 0; i < index.count; i += 3)
          for (const [a, b] of [
            [0, 1],
            [1, 2],
            [2, 0],
          ]) {
            const start = ids[index.getX(i + a)],
              end = ids[index.getX(i + b)],
              key = start < end ? `${start}:${end}` : `${end}:${start}`;
            edges.set(key, (edges.get(key) ?? 0) + 1);
          }
        const boundaries = [...edges].filter(([, count]) => count === 1),
          openEnds = new Set([...rings[0], ...rings.at(-1)!].map((i) => ids[i]));
        expect([...edges.values()].every((count) => count === 1 || count === 2)).toBe(true);
        expect(boundaries).toHaveLength((rings[0].length - 1) * 2);
        expect(
          boundaries.every(([edge]) => edge.split(':').every((v) => openEnds.has(Number(v)))),
        ).toBe(true);
        for (const attribute of Object.values(geometry.attributes))
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      } finally {
        geometry.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s fork lug preserves the axle bore through both cast faces',
    (detail) => {
      const view = inspect(motocrossAxleLug(detail));
      try {
        for (const side of [-1, 1]) {
          for (let i = 0; i < 24; i++) {
            const a = (i * Math.PI) / 12;
            expect(
              view.cast(
                new T.Vector3(side * 0.1, Math.cos(a) * 0.0105, Math.sin(a) * 0.0105),
                new T.Vector3(-side, 0, 0),
              ),
            ).toHaveLength(0);
          }
          // The empty bore is enclosed by real shoulders, rather than the
          // whole casting being invisible or using a transparent material.
          for (const [y, z] of [
            [0.026, 0],
            [-0.023, 0],
            [0, 0.025],
          ])
            expect(
              view.cast(new T.Vector3(side * 0.1, y, z), new T.Vector3(-side, 0, 0)).length,
            ).toBeGreaterThan(0);
        }
      } finally {
        view.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s swingarms leave actual adjustment slots at the recorded axle',
    (detail) => {
      const length = 0.57;
      for (const side of [-1, 1]) {
        const geometry = motocrossSwingarmRail(length, side, detail),
          view = inspect(geometry);
        try {
          for (const z of [-length - 0.01, -length, -length + 0.013])
            expect(
              view.cast(new T.Vector3(side * 0.3, 0, z), new T.Vector3(-side, 0, 0)),
            ).toHaveLength(0);
          for (const y of [-0.02, 0.021])
            expect(
              view.cast(new T.Vector3(side * 0.3, y, -length), new T.Vector3(-side, 0, 0)).length,
            ).toBeGreaterThan(0);
          expect(geometry.boundingBox!.max.y).toBeGreaterThan(0.045);
          expect(geometry.boundingBox!.max.y).toBeLessThan(0.06);
        } finally {
          view.dispose();
        }
      }
    },
  );

  it.each(['high', 'mid', 'far'] as const)(
    '%s sump is a curved two-sided guard with a measurable wall',
    (detail) => {
      const geometry = motocrossSumpGuard(detail),
        view = inspect(geometry);
      try {
        for (const z of [-0.15, -0.03, 0.12])
          for (const x of [-0.045, 0, 0.045]) {
            const inner = view.cast(new T.Vector3(x, 0, z), new T.Vector3(0, -1, 0))[0],
              outer = view.cast(new T.Vector3(x, -1, z), new T.Vector3(0, 1, 0))[0];
            expect(inner).toBeDefined();
            expect(outer).toBeDefined();
            const inward = outer.face!.normal.clone().negate(),
              wall = view.cast(
                outer.point.clone().addScaledVector(inward, 0.03),
                inward.clone().negate(),
              )[0];
            expect(wall).toBeDefined();
            const thickness = wall.point.clone().sub(outer.point).dot(inward);
            expect(thickness).toBeGreaterThan(0.0035);
            expect(thickness).toBeLessThan(0.0041);
            expect(inner.face!.normal.y).toBeGreaterThan(0.3);
            expect(outer.face!.normal.y).toBeLessThan(-0.3);
          }
        const floor = view.cast(new T.Vector3(0, 0, -0.03), new T.Vector3(0, -1, 0))[0].point.y,
          nose = view.cast(new T.Vector3(0, 0, 0.16), new T.Vector3(0, -1, 0))[0].point.y;
        expect(nose - floor).toBeGreaterThan(0.095);
        expect(geometry.boundingBox!.min.y).toBeGreaterThan(-0.533);
        expect(geometry.index!.count / 3).toBeLessThan(950);
        for (const attribute of Object.values(geometry.attributes))
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      } finally {
        view.dispose();
      }
    },
  );

  it.each(['high', 'mid', 'far'] as const)(
    '%s silencer has a deep open outlet with a supported return',
    (detail) => {
      const view = inspect(motocrossSilencerOutlet(detail));
      try {
        for (const x of [-0.012, 0, 0.012])
          expect(view.cast(new T.Vector3(x, 0, -0.5), new T.Vector3(0, 0, 1))).toHaveLength(0);
        for (const x of [-0.026, 0.026]) {
          const lip = view.cast(new T.Vector3(x, 0, -0.5), new T.Vector3(0, 0, 1))[0];
          expect(lip).toBeDefined();
          expect(lip.point.z).toBeCloseTo(-0.222, 5);
        }
      } finally {
        view.dispose();
      }
    },
  );

  it.each(['mx250', 'mx450'])(
    '%s complete LODs keep a real exhaust bore, contacts and the existing triangle budget',
    (id) => {
      const counts: number[] = [],
        materials = new BikeMaterials(0);
      try {
        for (const detail of ['high', 'mid', 'far'] as const) {
          const definition = VEHICLES[id],
            model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms()),
            sag = staticSag(definition);
          try {
            model.pose({
              fork: sag.fork,
              shock: sag.shock,
              steer: 0,
              frontRotation: 0,
              rearRotation: 0,
              chassisLean: 0,
              riderOffset: 0,
              tuck: 0,
              brake: 0,
              rearBrake: 0,
              discTemp: 0,
              compoundColour: 0xffffff,
              riding: true,
            });
            model.root.updateMatrixWorld(true);
            const silencer = model.root.getObjectByName('Motocross tapered open exhaust silencer')!,
              origin = silencer.localToWorld(new T.Vector3(0, 0, -0.5)),
              direction = new T.Vector3(0, 0, 1).transformDirection(silencer.matrixWorld),
              ray = new T.Raycaster(origin, direction, 0, 0.66);
            // Whole production assembly: removing just the visible end disc
            // would still fail if the main barrel retained its sealed cap.
            expect(ray.intersectObject(silencer, true)).toHaveLength(0);
            let triangles = 0;
            const exhaustBounds = new T.Box3();
            model.root.traverse((o) => {
              if (!(o instanceof T.Mesh)) return;
              if (o.material === materials.titanium) exhaustBounds.expandByObject(o);
              const geometry = o.geometry as T.BufferGeometry;
              triangles +=
                ((geometry.index?.count ?? geometry.getAttribute('position').count) / 3) *
                (o instanceof T.InstancedMesh ? o.count : 1);
              for (const attribute of Object.values(geometry.attributes))
                expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
            });
            counts.push(triangles);
            expect(triangles).toBeLessThan(130000);
            // Test the production branch after batching as well as the
            // standalone helpers: only MX250 gets the broad two-stroke pipe.
            if (id === 'mx250') expect(exhaustBounds.min.x).toBeLessThan(-0.29);
            else expect(exhaustBounds.min.x).toBeGreaterThan(-0.21);
            expect(model.rider.pegs.map((p) => p.toArray())).toEqual([
              [0.17, -0.44, -0.1],
              [-0.17, -0.44, -0.1],
            ]);
          } finally {
            model.dispose();
          }
        }
      } finally {
        materials.dispose();
      }
      expect(counts[0]).toBeGreaterThan(counts[1]);
      expect(counts[1]).toBeGreaterThan(counts[2]);
    },
  );
});
