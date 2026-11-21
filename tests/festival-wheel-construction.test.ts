import * as T from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireTyreStamp, tyreSizeMark } from '../src/rendering/vehicle-bodies/road-tyre-mould.ts';
import { wheelExposureTurns } from '../src/rendering/road-wheel-exposure.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import {
  WheelAssembly,
  type Detail,
  type WheelSheet,
} from '../src/rendering/vehicle-bodies/wheel.ts';

const owned: WheelAssembly[] = [];
function wheel(id: string, side = 1, detail: Detail = 0, festival = true, front = true) {
  const sheet = bodySheetFor(VEHICLES[id])!.wheels;
  const assembly = new WheelAssembly(
    VEHICLES[id].spec.wheelRadius,
    side,
    front,
    sheet,
    detail,
    festival,
  );
  owned.push(assembly);
  return { assembly, sheet, half: sheet.width[front ? 0 : 1] / 2 };
}
function mesh(wheel: WheelAssembly, name: string) {
  const result = wheel.pivot.getObjectByName(name);
  if (!(result instanceof T.Mesh)) throw new Error(`Missing wheel component: ${name}`);
  return result;
}
function ray(object: T.Object3D, origin: T.Vector3, direction: T.Vector3, far = 2) {
  object.updateMatrixWorld(true);
  return new T.Raycaster(origin, direction.normalize(), 0, far).intersectObject(object, true);
}
function triangles(wheel: WheelAssembly) {
  let count = 0;
  wheel.pivot.traverse((node) => {
    if (node instanceof T.Mesh)
      count += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
  });
  return count;
}
function signature(wheel: WheelAssembly) {
  const result: unknown[] = [];
  wheel.pivot.traverse((node) => {
    if (node instanceof T.Mesh)
      result.push([
        node.name,
        [...node.geometry.getAttribute('position').array],
        [...node.geometry.getAttribute('normal').array],
      ]);
  });
  return result;
}
afterEach(() => {
  for (const wheel of owned) {
    wheel.pivot.traverse((node) => {
      if (node instanceof T.Mesh) node.geometry.dispose();
    });
    (wheel.tyre.material as T.Material).dispose();
    wheel.disc?.dispose();
  }
  owned.length = 0;
});

describe('Festival road wheel construction', () => {
  it('forms one dished spoke root with two solid branches and an open fork on both sides', () => {
    for (const id of ['rh3', 'sc7'])
      for (const side of [-1, 1])
        for (const detail of [0, 1] as const) {
          const { assembly, sheet } = wheel(id, side, detail);
          const rim = mesh(assembly, 'Rim'),
            R = sheet.rimRadius;
          const probe = (radius: number, tangent: number) =>
            ray(rim, new T.Vector3(side * 0.7, radius, tangent), new T.Vector3(-side, 0, 0));
          const root = probe(R * 0.39, 0)[0];
          expect(root, `${id}/${side}/LOD${detail} spoke root`).toBeDefined();
          expect(root.face!.normal.x * side, 'triangles face outboard').toBeGreaterThan(0.6);
          expect(root.normal!.x * side, 'dished shading normals face outboard').toBeGreaterThan(
            0.85,
          );
          expect(probe(R * 0.82, 0), 'fork really opens between the branches').toHaveLength(0);
          for (const branch of [-1, 1]) {
            const hit = probe(R * 0.82, branch * R * 0.135)[0];
            expect(hit, `${id} solid fork branch`).toBeDefined();
            expect(hit.point.x * side, 'hub sits behind the outer spoke face').toBeGreaterThan(
              root.point.x * side + 0.015,
            );
            expect(
              hit.face!.normal.x * side,
              'right wheel winding remains outward',
            ).toBeGreaterThan(0.8);
          }
        }
  });

  it('opens real cooling channels between friction plates while keeping vane and friction surfaces solid', () => {
    for (const id of ['rh3', 'sc7'])
      for (const side of [-1, 1])
        for (const detail of [0, 1] as const) {
          const { assembly, sheet, half } = wheel(id, side, detail);
          const disc = mesh(assembly, 'Brake disc'),
            R = sheet.rimRadius * sheet.disc;
          disc.geometry.computeBoundingBox();
          const centreX = disc.geometry.boundingBox!.getCenter(new T.Vector3()).x;
          let openChannels = 0,
            solidVanes = 0;
          for (let k = 0; k < 120; k++) {
            const a = (k / 120) * Math.PI * 2;
            const direction = new T.Vector3(0, -Math.cos(a), -Math.sin(a));
            const hits = ray(
              disc,
              new T.Vector3(centreX, Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15),
              direction,
              R * 0.7,
            );
            if (hits.length) solidVanes++;
            else openChannels++;
          }
          expect(openChannels, 'a sealed annulus must fail').toBeGreaterThan(60);
          expect(solidVanes, 'rotor plates need physical connecting vanes').toBeGreaterThan(10);
          const friction = ray(
            disc,
            new T.Vector3(side * 0.6, R * 0.82, 0),
            new T.Vector3(-side, 0, 0),
          )[0];
          expect(friction).toBeDefined();
          expect(friction.face!.normal.x * side).toBeGreaterThan(0.99);
          expect(friction.point.x * side, 'disc is recessed behind the rim').toBeLessThan(
            half * 0.62 - 0.04,
          );
          expect(disc.geometry.boundingBox!.max.x - disc.geometry.boundingBox!.min.x).toBeCloseTo(
            0.032,
            6,
          );
        }
  });

  it('keeps the caliper on the steered upright and the hot rotor on the rolling hub', () => {
    const { assembly } = wheel('rh3');
    const caliper = mesh(assembly, 'Brake caliper'),
      disc = mesh(assembly, 'Brake disc');
    const bell = mesh(assembly, 'Machined rim lip and brake bell');
    assembly.update(0.31, 0.21, -0.025, 0.3, 3200, 155, 300);
    assembly.pivot.updateMatrixWorld(true);
    const caliperBefore = caliper.matrixWorld.clone(),
      rotorBefore = disc.matrixWorld.clone();
    assembly.update(0.31, 0.21, -0.025, 2.1, 3200, 155, 900);
    assembly.pivot.updateMatrixWorld(true);
    expect(caliper.parent).toBe(assembly.pivot);
    expect(disc.parent).toBe(assembly.spin);
    expect(bell.parent).toBe(assembly.spin);
    expect(caliper.matrixWorld.equals(caliperBefore)).toBe(true);
    expect(disc.matrixWorld.equals(rotorBefore)).toBe(false);
    expect(assembly.tyre.rotation.x).toBe(0);
    expect(assembly.pose.value.x).toBe(2.1);
    expect(assembly.pose.value.y).toBeGreaterThan(0);
    expect(assembly.disc!.emissiveIntensity).toBeGreaterThan(0.8);
    expect(bell.material).not.toBe(assembly.disc);
    expect((bell.material as T.MeshStandardMaterial).emissiveIntensity).toBe(1);
    expect((bell.material as T.MeshStandardMaterial).emissive.getHex()).toBe(0);
  });

  it('contains the brake caliper within the barrel and behind the spokes', () => {
    for (const id of ['rh3', 'sc7'])
      for (const side of [-1, 1])
        for (const front of [true, false]) {
          const { assembly, sheet, half } = wheel(id, side, 0, true, front);
          const caliper = mesh(assembly, 'Brake caliper').geometry.getAttribute('position');
          const barrelInnerRadius =
            sheet.rimRadius - Math.max(0.012, sheet.rimRadius * (1 - sheet.disc) * 0.28);
          for (let i = 0; i < caliper.count; i++) {
            expect(Math.hypot(caliper.getY(i), caliper.getZ(i))).toBeLessThan(
              barrelInnerRadius - 0.001,
            );
            expect(caliper.getX(i) * side).toBeLessThan(half * 0.62 - 0.04);
          }
        }
  });

  it('keeps the cast brake silhouette under five hundred triangles per mid-distance road wheel', () => {
    for (const id of ['rh3', 'sc7', 'rp6'])
      for (const side of [-1, 1]) {
        const spec = VEHICLES[id],
          sheet = bodySheetFor(spec)!.wheels;
        const builds = ([0, 1] as const).map(
          (detail) =>
            new WheelAssembly(
              spec.spec.wheelRadius,
              side,
              true,
              sheet,
              detail,
              true,
              undefined,
              true,
            ),
        );
        owned.push(...builds);
        const [hero, road] = builds.map((w) => mesh(w, 'Brake caliper').geometry);
        const points = road.getAttribute('position');
        expect((road.index?.count ?? points.count) / 3).toBeLessThanOrEqual(500);
        expect(road.groups).toHaveLength(0);
        hero.computeBoundingBox();
        road.computeBoundingBox();
        for (const axis of ['x', 'y', 'z'] as const)
          for (const edge of ['min', 'max'] as const)
            expect(
              Math.abs(hero.boundingBox![edge][axis] - road.boundingBox![edge][axis]),
            ).toBeLessThan(0.018);
        const r = sheet.rimRadius,
          half = sheet.width[0] / 2;
        for (let i = 0; i < points.count; i++) {
          expect(Math.hypot(points.getY(i), points.getZ(i))).toBeLessThan(r);
          expect(points.getX(i) * side).toBeLessThan(half * 0.63);
        }
      }
  });

  it('bounds near/mid cost and preserves far and specialist wheels exactly', () => {
    for (const id of ['rh3', 'sc7']) {
      const near = wheel(id).assembly,
        mid = wheel(id, 1, 1).assembly;
      const legacy = wheel(id, 1, 0, false).assembly;
      expect(triangles(near)).toBeLessThan(10000);
      expect(triangles(near) - triangles(legacy)).toBeLessThan(6500);
      expect(triangles(mid)).toBeLessThan(triangles(near) * 0.65);
      expect(near.spin.children.length - legacy.spin.children.length).toBe(1);
      expect(signature(wheel(id, 1, 2).assembly)).toEqual(
        signature(wheel(id, 1, 2, false).assembly),
      );
      near.pivot.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        const geometry = node.geometry as T.BufferGeometry;
        for (const attribute of Object.values(geometry.attributes))
          expect([...attribute.array].every(Number.isFinite), `${node.name} finite geometry`).toBe(
            true,
          );
      });
    }
    const base = bodySheetFor(VEHICLES.rh3)!.wheels;
    for (const style of ['wire', 'beadlock', 'kart'] as const) {
      const sheet: WheelSheet = { ...base, style };
      const a = new WheelAssembly(0.33, 1, true, sheet, 0, true);
      const b = new WheelAssembly(0.33, 1, true, sheet, 0, false);
      owned.push(a, b);
      expect(a.pivot.userData.festivalWheel).toBeUndefined();
      expect(signature(a)).toEqual(signature(b));
    }
  });
});

it('retains separate tyre contact and brake heat while sharing only equal rigid wheel buffers', () => {
  for (const id of ['rh3', 'eh3']) {
    const def = VEHICLES[id],
      body = buildVehicleBody(0, def, bodySheetFor(def)!);
    const [a, b, c, d] = body.wheels[0];
    expect(a.tyre.geometry).toBe(b.tyre.geometry);
    expect(a.tyre.material).not.toBe(b.tyre.material);
    expect(a.contact).not.toBe(b.contact);
    expect(a.disc).not.toBe(c.disc);
    expect(mesh(a, 'Rim').geometry).not.toBe(mesh(b, 'Rim').geometry);
    const sameWidth = id === 'rh3';
    expect(a.tyre.geometry === c.tyre.geometry).toBe(sameWidth);
    expect(mesh(a, 'Rim').geometry === mesh(c, 'Rim').geometry).toBe(sameWidth);
    expect(mesh(b, 'Brake caliper').geometry === mesh(d, 'Brake caliper').geometry).toBe(sameWidth);
    expect(a.tyre.geometry).not.toBe(body.wheels[1][0].tyre.geometry);
    a.update(0, 0.1, 0.01, 2, 2500, 155, 950);
    expect(a.disc!.emissiveIntensity).toBeGreaterThan(c.disc!.emissiveIntensity);
    expect(b.pose.value.x).toBe(0);
    const ownedGeometry = new Set<T.BufferGeometry>();
    body.root.traverse((n) => {
      if (n instanceof T.Mesh) ownedGeometry.add(n.geometry);
    });
    for (const g of ownedGeometry) g.dispose();
  }
}, 30000);

it('keeps the rubber phase with its rim and exposes each road tyre from its own angular speed', () => {
  const def = VEHICLES.rd2,
    sheet = bodySheetFor(def)!.wheels;
  const wheels = [-1, 1].map(
    (side) => new WheelAssembly(def.spec.wheelRadius, side, true, sheet, 2, true, undefined, true),
  );
  owned.push(...wheels);
  const axis = new T.Vector3(1, 0, 0);
  for (const [i, phase] of [-Math.PI - 0.02, Math.PI + 0.02].entries()) {
    const w = wheels[i],
      omega = i ? -46 : 0;
    w.update(0, 0, 0, phase, 3100, 160, 90, undefined, w.radius, omega);
    expect(w.mould!.value.x).toBeCloseTo(sheet.rimRadius / def.spec.wheelRadius);
    expect(w.mould!.value.y).toBe(wheelExposureTurns(omega));
    const mounted = new T.Vector3(0, 0.23, -0.08);
    const rolled = mounted.clone().applyAxisAngle(axis, w.spin.rotation.x);
    const sampled = Math.atan2(rolled.z, -rolled.y) + w.pose.value.x;
    const original = Math.atan2(mounted.z, -mounted.y);
    expect(Math.cos(sampled - original)).toBeCloseTo(1, 12);
  }
  expect(wheels[0].mould!.value.y).toBe(0);
  expect(wheels[1].mould!.value.y).toBeGreaterThan(0);
});

it('prints the geometric tyre dimensions and releases shared mould textures exactly once', () => {
  const size = { rim: 0.2286, radius: 0.2286 + 0.225 * 0.45, width: 0.225 };
  const ctx = new Proxy({}, { get: () => () => {} });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
  try {
    expect(tyreSizeMark(size)).toBe('225/45 R18');
    const a = acquireTyreStamp(size, 'road')!,
      b = acquireTyreStamp(size, 'road')!;
    expect(b.texture).toBe(a.texture);
    const free = vi.fn();
    a.texture.addEventListener('dispose', free);
    a.release();
    a.release();
    expect(free).not.toHaveBeenCalled();
    b.release();
    expect(free).toHaveBeenCalledTimes(1);
    const fresh = acquireTyreStamp(size, 'road')!;
    expect(fresh.texture).not.toBe(a.texture);
    fresh.release();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps cast paint, steel pad retention and axle-specific rotor uniforms on their original draws', () => {
  const sheet = bodySheetFor(VEHICLES.sc7)!.wheels;
  for (const side of [-1, 1]) {
    const wheel = new WheelAssembly(
      VEHICLES.sc7.spec.wheelRadius,
      side,
      true,
      sheet,
      0,
      true,
      undefined,
      true,
    );
    owned.push(wheel);
    const caliper = mesh(wheel, 'Brake caliper'),
      rotor = mesh(wheel, 'Brake disc');
    expect(caliper.parent).toBe(wheel.pivot);
    expect(rotor.parent).toBe(wheel.spin);
    expect(caliper.geometry.groups).toHaveLength(0);
    const colors = caliper.geometry.getAttribute('color'),
      unique = new Set<number>();
    for (let i = 0; i < colors.count; i++) unique.add(Math.round(colors.getY(i) * 65535));
    expect(unique.size).toBeGreaterThanOrEqual(4);
    expect((caliper.material as T.MeshStandardMaterial).vertexColors).toBe(true);
    expect(wheel.disc!.customProgramCacheKey()).toContain('road-brake-slotted');
  }
});
