import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { motocrossHandguard } from '../src/rendering/offroad/motocross-handguard.ts';
import { mxCrossbarPad } from '../src/rendering/offroad/motocross-bar-pad.ts';
import { prepareMxFenderFlex } from '../src/rendering/offroad/mx-fender-flex.ts';
import {
  mxNumberBoard,
  mxSideNumberPlate,
  mxSidePlateMounts,
} from '../src/rendering/offroad/motocross-number-board.ts';
import {
  motocrossFender,
  motocrossForkGuard,
  motocrossTripleClamp,
} from '../src/rendering/offroad/motocross-detail.ts';

/** Check the submitted triangle topology, joining duplicated seam vertices.
 * A painted closed face or unrelated upper/lower sheets cannot pass this. */
function closedShell(geometry: T.BufferGeometry) {
  const positions = geometry.getAttribute('position'),
    index = geometry.index,
    edges = new Map<string, { count: number; direction: number }>(),
    points = [new T.Vector3(), new T.Vector3(), new T.Vector3()],
    cross = new T.Vector3();
  let volume = 0;
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const keys: string[] = [];
    for (let corner = 0; corner < 3; corner++) {
      points[corner].fromBufferAttribute(positions, index?.getX(i + corner) ?? i + corner);
      keys.push(
        points[corner]
          .toArray()
          .map((x) => Math.round(x * 1e7))
          .join(','),
      );
    }
    expect(
      new T.Triangle(...(points as [T.Vector3, T.Vector3, T.Vector3])).getArea(),
    ).toBeGreaterThan(1e-12);
    volume += points[0].dot(cross.crossVectors(points[1], points[2])) / 6;
    for (let corner = 0; corner < 3; corner++) {
      const a = keys[corner],
        b = keys[(corner + 1) % 3],
        key = a < b ? `${a}|${b}` : `${b}|${a}`,
        edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  for (const edge of edges.values()) expect(edge).toEqual({ count: 2, direction: 0 });
  expect(volume).toBeGreaterThan(0);
  for (const attribute of Object.values(geometry.attributes))
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
  return volume;
}

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

describe('motocross formed bodywork', () => {
  it.each([true, false])('holds both skins of the mounting lands while the free blade flexes (%s)', (front) => {
    const mesh = motocrossFender(front, 'high', true);
    try {
      prepareMxFenderFlex(mesh, front);
      const p = mesh.getAttribute('position'), normal = mesh.getAttribute('normal');
      const delta = mesh.morphAttributes.position![0], dn = mesh.morphAttributes.normal![0];
      const n = new T.Vector3(), d = new T.Vector3();
      let pinned = 0, maxBend = 0, normalChange = 0;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        if (front ? z > -0.1 && z < 0.09 : z > -0.77) {
          pinned++;
          expect(delta.getY(i)).toBeCloseTo(0, 9);
          expect(d.fromBufferAttribute(dn, i).length()).toBeLessThan(1e-6);
        }
        maxBend = Math.max(maxBend, -delta.getY(i));
        normalChange = Math.max(normalChange, d.fromBufferAttribute(dn, i).length());
        n.fromBufferAttribute(normal, i).add(d);
        expect(n.length()).toBeCloseTo(1, 5);
      }
      expect(pinned).toBeGreaterThan(20);
      expect(maxBend).toBeCloseTo(front ? 0.026 : 0.018, 4);
      expect(normalChange).toBeGreaterThan(0.06);
    } finally {
      mesh.dispose();
    }
  });
  it.each(['high', 'mid', 'far'] as const)(
    '%s control padding has a through bore and number board has a curved, unprinted back',
    (detail) => {
      for (const compact of [false, true]) {
        const pad = mxCrossbarPad(detail, compact),
          board = mxNumberBoard(detail, compact);
        const foam = inspect(pad),
          plate = inspect(board);
        try {
          expect(closedShell(pad)).toBeGreaterThan(0.0004);
          expect(closedShell(board)).toBeGreaterThan(0.00018);
          const across = new T.Vector3(-1, 0, 0),
            front = new T.Vector3(0, 0, -1);
          expect(foam.cast(new T.Vector3(1, 0, 0), across)).toHaveLength(0);
          expect(foam.cast(new T.Vector3(1, 0.019, 0), across).length).toBeGreaterThan(0);
          const centre = plate.cast(new T.Vector3(0.002, 0, 1), front)[0];
          const wing = plate.cast(new T.Vector3(0.125, 0, 1), front)[0];
          expect(centre.point.z - wing.point.z).toBeGreaterThan(0.017);
          expect(centre.uv!.x).toBeCloseTo(0.5, 1);
          const reverse = plate.cast(new T.Vector3(0.002, 0, -1), front.clone().negate())[0];
          expect(centre.point.z - reverse.point.z).toBeCloseTo(0.0038, 5);
          expect(reverse.uv!.x).toBeLessThan(12 / 512);
          expect(reverse.face!.normal.z).toBeLessThan(-0.9);
        } finally {
          foam.dispose();
          plate.dispose();
        }
      }
    },
  );

  it.each(['high', 'mid', 'far'] as const)(
    '%s tail fairings clear the exhaust envelope and print readable numbers only on the outside',
    (detail) => {
      for (const compact of [true, false]) {
        for (const side of [-1, 1]) {
          const geometry = mxSideNumberPlate(detail, side, compact),
            view = inspect(geometry);
          const inward = new T.Vector3(-side, 0, 0),
            outward = inward.clone().negate();
          try {
            expect(closedShell(geometry)).toBeGreaterThan(0.00023);
            const sample = (z: number, y: number, exterior: boolean) =>
              view.cast(new T.Vector3(exterior ? side : 0, y, z), exterior ? inward : outward)[0];
            const nose = sample(-0.41, -0.025, true),
              tail = sample(-0.55, -0.025, true);
            expect(Math.sign(nose.uv!.x - tail.uv!.x)).toBe(-side);
            const back = sample(-0.41, -0.025, false);
            expect((nose.point.x - back.point.x) * side).toBeCloseTo(0.0038, 5);
            expect(back.uv!.x).toBeLessThanOrEqual(12 / 512);
            expect(nose.face!.normal.x * side).toBeGreaterThan(0.7);
            for (const mount of mxSidePlateMounts(side, compact)) {
              const face = sample(mount.z, mount.y, true);
              expect(Math.abs(face.point.x - mount.x)).toBeLessThan(
                detail === 'far' ? 0.004 : 0.00001,
              );
            }
            if (side > 0) {
              expect(tail.point.x).toBeLessThan(0.2);
              continue;
            }
            // Independent conservative envelope of the actual tilted can, including its
            // two rolled retaining bands. Check between mesh stations and around the cap.
            let minimum = Infinity,
              covered = 0;
            for (let z = -0.775; z <= -0.455; z += 0.004) {
              for (let y = -0.075; y < 0.075; y += 0.004) {
                const dy = (y + 0.005) * Math.cos(0.22) + (z + 0.615) * Math.sin(0.22);
                if (Math.abs(dy) >= 0.053) continue;
                const hit = sample(z, y, false);
                if (!hit) continue;
                const can = 0.177 + Math.sqrt(0.053 ** 2 - dy ** 2);
                minimum = Math.min(minimum, -hit.point.x - can);
                covered++;
              }
            }
            expect(covered).toBeGreaterThan(1100);
            expect(minimum).toBeGreaterThan(0.012);
          } finally {
            view.dispose();
          }
        }
      }
    },
  );

  it.each(['high', 'mid', 'far'] as const)(
    '%s handguards have closed skins on both bars and preserve the sightline through the cockpit',
    (detail) => {
      const forward = new T.Vector3(0, 0, 1),
        backward = new T.Vector3(0, 0, -1);
      for (const side of [-1, 1])
        for (const compact of [false, true]) {
          const geometry = motocrossHandguard(detail, side, compact),
            view = inspect(geometry);
          try {
            expect(closedShell(geometry)).toBeGreaterThan(0.00003);
            const top = compact ? 0.024 : 0.035;
            // From the front and the cockpit, the blade has distinct outward skins.
            const front = view.cast(new T.Vector3(side * 0.32, top, 1), backward)[0];
            const back = view.cast(new T.Vector3(side * 0.32, top, -1), forward)[0];
            expect(front.point.z - back.point.z).toBeCloseTo(0.0032, 5);
            expect(front.face!.normal.z).toBeGreaterThan(0.7);
            expect(back.face!.normal.z).toBeLessThan(-0.7);
            expect(view.cast(new T.Vector3(side * 0.18, 0, -1), forward)).toHaveLength(0);
            for (const u of [0.32, 0.72]) {
              const x = side * (0.214 + 0.232 * u);
              const y =
                -0.036 + (top + 0.023 + 0.036) * (0.4 + 0.16 * u) + 0.007 * Math.sin(Math.PI * u);
              const hits = view.cast(new T.Vector3(x, y, -1), forward);
              expect(hits.length === 0).toBe(detail !== 'far');
            }
          } finally {
            view.dispose();
          }
        }
    },
  );

  for (const front of [true, false])
    it.each(['high', 'mid', 'far'] as const)(
      `${front ? 'front' : 'rear'} %s fender has outward skins, real wall thickness and closed lips`,
      (detail) => {
        const geometry = motocrossFender(front, detail),
          view = inspect(geometry);
        try {
          const volume = closedShell(geometry);
          expect(volume).toBeGreaterThan(front ? 0.00035 : 0.0002);
          expect(volume).toBeLessThan(front ? 0.00065 : 0.0004);
          // Front-sided rays from above/below test raster winding, not merely
          // a DoubleSide material hiding an inside-out patch.
          for (const z of front ? [-0.18, 0.08, 0.32, 0.44] : [-1.04, -0.91, -0.73])
            for (const x of [-0.025, 0, 0.025]) {
              const top = view.cast(new T.Vector3(x, 1, z), new T.Vector3(0, -1, 0))[0],
                bottom = view.cast(new T.Vector3(x, -1, z), new T.Vector3(0, 1, 0))[0];
              expect(top).toBeDefined();
              expect(bottom).toBeDefined();
              const separation = top.point.y - bottom.point.y;
              expect(separation).toBeGreaterThan(0.0031);
              expect(separation).toBeLessThan(0.0055);
              expect(top.face!.normal.y).toBeGreaterThan(0.6);
              expect(bottom.face!.normal.y).toBeLessThan(-0.6);
            }
          expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeLessThan(0.225);
          expect(geometry.index!.count / 3).toBeLessThan(2000);
        } finally {
          view.dispose();
        }
      },
    );

  it.each(['high', 'mid'] as const)(
    '%s fork guard is a closed 3 mm C-section with a real open rear and clearance around the fork tube',
    (detail) => {
      const geometry = motocrossForkGuard(detail),
        view = inspect(geometry);
      try {
        const volume = closedShell(geometry);
        expect(volume).toBeGreaterThan(0.0001);
        expect(volume).toBeLessThan(0.00025);
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++)
          expect(Math.hypot(positions.getX(i), positions.getZ(i))).toBeGreaterThan(0.0325);
        for (const y of [0.08, 0.2, 0.3]) {
          // An observer inside the fork bore sees the inner surface ahead and
          // at either side, while the rear is actually open to the lower tube.
          expect(view.cast(new T.Vector3(0, y, 0), new T.Vector3(0, 0, -1))).toHaveLength(0);
          for (const direction of [
            new T.Vector3(0, 0, 1),
            new T.Vector3(-1, 0, 0),
            new T.Vector3(1, 0, 0),
          ]) {
            const inner = view.cast(new T.Vector3(0, y, 0), direction)[0],
              outer = view.cast(
                direction
                  .clone()
                  .multiplyScalar(0.1)
                  .add(new T.Vector3(0, y, 0)),
                direction.clone().negate(),
              )[0];
            expect(inner).toBeDefined();
            expect(outer).toBeDefined();
            expect(outer.point.distanceTo(inner.point)).toBeGreaterThan(0.0027);
            expect(outer.point.distanceTo(inner.point)).toBeLessThan(0.004);
          }
        }
        expect(geometry.index!.count / 3).toBeLessThan(1000);
      } finally {
        view.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s triple clamp leaves the full fork cross-sections open inside continuous collars',
    (detail) => {
      const view = inspect(motocrossTripleClamp(detail, 0.035, 0.022));
      try {
        for (const side of [-1, 1]) {
          for (let a = 0; a < 32; a++) {
            const angle = (a * Math.PI) / 16;
            expect(
              view.cast(
                new T.Vector3(
                  side * 0.095 + Math.cos(angle) * 0.03,
                  0.2,
                  0.022 + Math.sin(angle) * 0.03,
                ),
                new T.Vector3(0, -1, 0),
              ),
            ).toHaveLength(0);
          }
          expect(
            view.cast(new T.Vector3(side * 0.132, 0.2, 0.022), new T.Vector3(0, -1, 0)),
          ).toHaveLength(1);
        }
        expect(view.cast(new T.Vector3(0, 0.2, 0), new T.Vector3(0, -1, 0))).toHaveLength(0);
        expect(view.cast(new T.Vector3(0.035, 0.2, 0), new T.Vector3(0, -1, 0))).toHaveLength(1);
      } finally {
        view.dispose();
      }
    },
  );
});
