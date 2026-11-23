import * as T from 'three';
import { expect, it } from 'vitest';
import { FormulaRearFlap } from '../src/rendering/formula-rear-flap.ts';
import { mergeStatic } from '../src/rendering/geometry.ts';

it.each(['high', 'mid', 'far'] as const)(
  'keeps the %s hydraulic pickup on the moving rear flap',
  (detail) => {
    const wing = new T.Group(),
      flap = new FormulaRearFlap();
    const carbon = new T.MeshStandardMaterial(),
      alloy = new T.MeshStandardMaterial();
    flap.buildDrive(wing, carbon, alloy, detail);
    mergeStatic(wing);
    flap.mount(wing);
    const housing = wing.children.find((c) => c instanceof T.Mesh) as T.Mesh;
    expect(housing.geometry.boundingBox!.min.y).toBeLessThan(0.49);
    expect(housing.geometry.boundingBox!.max.y).toBeGreaterThan(0.615);
    const piston = wing.getObjectByName('Flap piston up to the pickup pin');
    if (detail === 'far') {
      expect(piston).toBeUndefined();
      return;
    }
    const anchor = new T.Vector3(0, 0.613, -2.012),
      point = new T.Vector3(0, 0.618, -2.124);
    wing.position.set(3, 8, -4);
    wing.rotation.set(0.09, 0.31, -0.1);
    const readings = [];
    for (const t of [0, 0.4, 1, 0.4, 0]) {
      flap.setTravel(t);
      wing.updateMatrixWorld(true);
      const pin = flap.skin.localToWorld(point.clone());
      const end = piston!.localToWorld(new T.Vector3(0, 0.5, 0));
      expect(end.distanceTo(pin)).toBeLessThan(1e-8);
      expect(
        piston!
          .parent!.getWorldPosition(new T.Vector3())
          .distanceTo(wing.localToWorld(anchor.clone())),
      ).toBeLessThan(1e-8);
      expect(piston!.scale.y).toBeGreaterThan(0.045);
      readings.push(end.toArray());
    }
    expect(readings[0]).toEqual(readings[4]);
    expect(readings[1]).toEqual(readings[3]);
    expect(Math.abs(readings[0][1] - readings[2][1])).toBeGreaterThan(0.035);
  },
);
