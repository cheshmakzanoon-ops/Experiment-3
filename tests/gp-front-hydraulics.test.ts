import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { GPFrontHydraulics } from '../src/rendering/gp-front-hydraulics.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

function centre(geometry: T.BufferGeometry, side: number, row: number) {
  const p = geometry.getAttribute('position'),
    rows = p.count / 14,
    point = new T.Vector3();
  for (let column = 0; column < 6; column++)
    point.add(new T.Vector3().fromBufferAttribute(p, (side * rows + row) * 7 + column));
  return point.divideScalar(6);
}

function dispose(root: T.Object3D) {
  root.traverse((object) => {
    if (object instanceof T.Mesh) object.geometry.dispose();
  });
}

describe('GP connected pressure circuit', () => {
  it.each(['high', 'mid'] as const)(
    '%s keeps both caliper outlets and fixed guides attached through real fork travel and steering',
    (detail) => {
      const chassis = new T.Group(),
        steering = new T.Group(),
        lower = new T.Group(),
        materials = {
          dark: new T.MeshStandardMaterial(),
          steel: new T.MeshStandardMaterial(),
          aluminium: new T.MeshStandardMaterial(),
          reservoir: new T.MeshStandardMaterial(),
        };
      chassis.rotation.x = -0.42;
      chassis.add(steering);
      steering.add(lower);
      const circuit = new GPFrontHydraulics(
          steering,
          lower,
          detail,
          materials,
          0.03,
          -0.738,
          0.125,
        ),
        geometry = circuit.lines.geometry,
        rows = geometry.getAttribute('position').count / 14 - 1,
        lengths: number[] = [];
      try {
        for (let step = 0; step <= 64; step++) {
          lower.position.y = -0.738 + (0.125 * step) / 64;
          steering.rotation.y = Math.sin(step * 0.3) * 0.6;
          circuit.update(lower.position.y);
          chassis.updateMatrixWorld(true);
          for (let side = 0; side < 2; side++) {
            const sign = side === 0 ? 1 : -1,
              // The historical caliper's unchanged lead endpoint, transformed
              // from its actual fork-lower frame rather than the steering root.
              outlet = lower.localToWorld(new T.Vector3(sign * 0.148, 0.135, -0.065)),
              guide = steering.localToWorld(new T.Vector3(sign * 0.148, -0.22, -0.065));
            expect(
              circuit.lines.localToWorld(centre(geometry, side, 0)).distanceTo(outlet),
            ).toBeLessThan(1e-7);
            expect(
              circuit.lines.localToWorld(centre(geometry, side, rows)).distanceTo(guide),
            ).toBeLessThan(1e-7);
            let length = 0,
              previous = centre(geometry, side, 0);
            for (let row = 1; row <= rows; row++) {
              const point = centre(geometry, side, row);
              length += point.distanceTo(previous);
              // Hose envelope clears the actual 58 mm outer fork tubes.
              if (point.y >= -0.35 && point.y <= 0.05)
                expect(Math.hypot(point.x - sign * 0.105, point.z - 0.03)).toBeGreaterThan(0.0317);
              previous = point;
            }
            lengths.push(length);
          }
        }
        expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThan(
          detail === 'high' ? 0.0002 : 0.0008,
        );
        expect(Math.min(...lengths)).toBeGreaterThan(0.41);
        // Both mirrored triangles retain outward winding and finite unit normals.
        const p = geometry.getAttribute('position'),
          n = geometry.getAttribute('normal'),
          index = geometry.getIndex()!;
        for (let i = 0; i < index.count; i += 3) {
          const a = index.getX(i),
            b = index.getX(i + 1),
            c = index.getX(i + 2),
            ab = new T.Vector3()
              .fromBufferAttribute(p, b)
              .sub(new T.Vector3().fromBufferAttribute(p, a)),
            ac = new T.Vector3()
              .fromBufferAttribute(p, c)
              .sub(new T.Vector3().fromBufferAttribute(p, a));
          expect(ab.cross(ac).dot(new T.Vector3().fromBufferAttribute(n, a))).toBeGreaterThan(0);
        }
        for (let i = 0; i < n.count; i++) {
          expect(new T.Vector3().fromBufferAttribute(n, i).length()).toBeCloseTo(1, 6);
          const point = new T.Vector3().fromBufferAttribute(p, i);
          expect(geometry.boundingBox!.containsPoint(point)).toBe(true);
          expect(geometry.boundingSphere!.containsPoint(point)).toBe(true);
        }
      } finally {
        dispose(chassis);
        for (const material of Object.values(materials)) material.dispose();
      }
    },
  );
});

beforeAll(() => {
  const noop = () => undefined,
    context = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'createLinearGradient' || key === 'createRadialGradient'
            ? () => ({ addColorStop: noop })
            : key === 'measureText'
              ? () => ({ width: 10 })
              : noop,
        set: () => true,
      },
    );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
});
afterAll(() => vi.unstubAllGlobals());

function pose(id: string, fork: number): BikePoseValues {
  return {
    fork,
    shock: staticSag(VEHICLES[id]).shock,
    steer: 0.3,
    frontRotation: 6,
    rearRotation: 4,
    chassisLean: 0.7,
    riderOffset: 0.1,
    tuck: 0.65,
    brake: 0.5,
    rearBrake: 0,
    discTemp: 400,
    compoundColour: 0xffffff,
    riding: true,
  };
}

it.each(
  ['gpr1', 'gpr2'].flatMap((id) => (['high', 'mid'] as const).map((detail) => ({ id, detail }))),
)(
  '$id $detail uses the live fork and restores the same hose geometry on replay seek without new resources',
  ({ id, detail }) => {
    const materials = new BikeMaterials(0),
      bike = new BikeModel(VEHICLES[id], 0, detail, materials, false),
      mesh = bike.root.getObjectByName(
        'GP compliant paired brake hoses',
      ) as T.Mesh<T.BufferGeometry>;
    expect(mesh).toBeTruthy();
    const geometry = mesh.geometry,
      position = geometry.getAttribute('position') as T.BufferAttribute,
      normal = geometry.getAttribute('normal') as T.BufferAttribute,
      disposed = vi.fn();
    geometry.addEventListener('dispose', disposed);
    try {
      const frame = Object.freeze(pose(id, 0.035));
      bike.pose(frame);
      const before = Float32Array.from(position.array),
        normals = Float32Array.from(normal.array),
        version = position.version;
      bike.pose(frame);
      expect(position.version).toBe(version);
      bike.pose(pose(id, VEHICLES[id].bike!.forkTravel));
      expect(Array.from(position.array)).not.toEqual(Array.from(before));
      bike.pose(frame);
      expect(position.array).toEqual(before);
      expect(normal.array).toEqual(normals);
      expect(mesh.geometry).toBe(geometry);
      expect(geometry.getAttribute('position')).toBe(position);
      expect(geometry.getAttribute('normal')).toBe(normal);
      const rig = bike as unknown as { forkLower: T.Group };
      bike.root.updateMatrixWorld(true);
      const expected = rig.forkLower.localToWorld(new T.Vector3(0.148, 0.135, -0.065));
      expect(mesh.localToWorld(centre(geometry, 0, 0)).distanceTo(expected)).toBeLessThan(1e-7);
      if (detail === 'mid') {
        // Inspect the real unbatched inlet geometry against the production
        // caliper casting, after its actual rotation and material batching.
        // A High-only inlet reused here would float outside the simpler box.
        const controls = new T.Group(),
          lower = new T.Group(),
          calipers: T.Mesh[] = [];
        controls.add(lower);
        new GPFrontHydraulics(
          controls,
          lower,
          'mid',
          materials,
          0.03,
          -0.7 - staticSag(VEHICLES[id]).fork,
          VEHICLES[id].bike!.forkTravel,
        );
        rig.forkLower.traverse((part) => {
          if (part instanceof T.Mesh && part.material === materials.caliper) calipers.push(part);
        });
        try {
          const leads = lower.children.filter(
            (part) => part.name === 'GP caliper hydraulic lead',
          ) as T.Mesh<T.BufferGeometry>[];
          expect(leads).toHaveLength(2);
          for (const lead of leads) {
            const inlet = centre(lead.geometry, 0, 0),
              inward = new T.Vector3(-Math.sign(inlet.x), 0, 0).transformDirection(
                rig.forkLower.matrixWorld,
              ),
              ray = new T.Raycaster(rig.forkLower.localToWorld(inlet), inward, 0, 0.02),
              hit = ray.intersectObjects(calipers, false)[0];
            expect(hit?.distance ?? Infinity).toBeLessThan(0.007);
          }
        } finally {
          dispose(controls);
        }
      }
    } finally {
      bike.dispose();
      expect(disposed).toHaveBeenCalledTimes(1);
      materials.dispose();
    }
  },
);

it('leaves the far silhouette and other motorcycle hydraulic presentation unchanged', () => {
  for (const [id, detail] of [
    ['gpr1', 'far'],
    ['gpr2', 'far'],
    ['sbk1000', 'high'],
  ] as const) {
    const materials = new BikeMaterials(0),
      bike = new BikeModel(VEHICLES[id], 0, detail, materials, false);
    try {
      expect(bike.root.getObjectByName('GP compliant paired brake hoses')).toBeUndefined();
    } finally {
      bike.dispose();
      materials.dispose();
    }
  }
});
