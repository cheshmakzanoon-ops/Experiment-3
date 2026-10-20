import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
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
