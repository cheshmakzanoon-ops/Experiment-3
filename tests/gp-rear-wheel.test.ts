import * as T from 'three';
import { expect, it } from 'vitest';
import { gpRearBrakeCaliper, gpRearRotor, GP_REAR_DISC } from '../src/rendering/gp-rear-brake.ts';
import { gpRearHugger } from '../src/rendering/gp-rear-chassis.ts';

it.each(['high', 'mid', 'far'] as const)(
  '%s rear disc connects its swept track to the dished hub with five open webs',
  (detail) => {
    const geometry = gpRearRotor(detail),
      mat = new T.MeshBasicMaterial({ side: T.DoubleSide }),
      mesh = new T.Mesh(geometry, mat),
      ray = new T.Raycaster();
    const at = (r: number, angle: number) => {
      ray.set(new T.Vector3(-1, r * Math.sin(angle), -r * Math.cos(angle)), new T.Vector3(1, 0, 0));
      return ray.intersectObject(mesh);
    };
    try {
      expect(at(0, 0)).toHaveLength(0);
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI) / 5;
        expect(at(0.064, a + 0.17).length).toBeGreaterThan(0);
        expect(at(0.064, a + 0.71)).toHaveLength(0);
        expect(at(0.103, a + 0.38)[0].point.x).toBeCloseTo(-GP_REAR_DISC.thickness / 2, 6);
        expect(at(0.031, a)[0].point.x).toBeCloseTo(
          GP_REAR_DISC.hubOffset - GP_REAR_DISC.thickness / 2,
          6,
        );
      }
      if (detail === 'high') expect(at(0.089, 0)).toHaveLength(0);
    } finally {
      geometry.dispose();
      mat.dispose();
    }
  },
);

it.each(['high', 'mid'] as const)(
  '%s rear pads straddle the rotor and the bridge clears its sweep',
  (detail) => {
    const mat = new T.MeshPhysicalMaterial({ side: T.DoubleSide }),
      caliper = gpRearBrakeCaliper(detail, {
        aluminium: mat,
        dark: mat,
        caliper: mat,
        steel: mat,
      });
    // Work in caliper coordinates: rotation about its axle preserves the swept annulus.
    caliper.position.set(0, 0, 0);
    caliper.rotation.set(0, 0, 0);
    caliper.updateMatrixWorld(true);
    const hits = new T.Raycaster(
      new T.Vector3(-1, 0, 0.096),
      new T.Vector3(1, 0, 0),
    ).intersectObject(caliper, true);
    expect(hits.some((h) => h.point.x < -0.00225 && h.point.x > -0.005)).toBe(true);
    expect(hits.some((h) => h.point.x > 0.00225 && h.point.x < 0.005)).toBe(true);
    for (let y = -0.034; y <= 0.034; y += 0.002) {
      for (const x of [-0.00225, 0, 0.00225]) {
        const ray = new T.Raycaster(new T.Vector3(x, y, 0), new T.Vector3(0, 0, 1));
        for (const hit of ray.intersectObject(caliper, true)) {
          expect(Math.hypot(hit.point.y, hit.point.z)).toBeGreaterThan(GP_REAR_DISC.radius);
        }
      }
    }
    caliper.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    mat.dispose();
  },
);

it.each(['high', 'mid', 'far'] as const)(
  '%s carbon hugger follows the slick crown with clearance on both shoulders',
  (detail) => {
    const radius = 0.32,
      crown = 0.11,
      arm = 0.56,
      geometry = gpRearHugger(radius, crown, arm, detail),
      p = geometry.getAttribute('position'),
      n = geometry.getAttribute('normal');
    let min = Infinity,
      shoulder = Infinity,
      crownHeight = 0;
    for (let i = 0; i < p.count; i++) {
      const x = Math.abs(p.getX(i)),
        r = Math.hypot(p.getY(i), p.getZ(i));
      if (x < 0.097) min = Math.min(min, r - (radius - crown + Math.sqrt(crown ** 2 - x ** 2)));
      if (x < 1e-6) crownHeight = Math.max(crownHeight, r);
      if (x > 0.09 && x < 0.097) shoulder = Math.min(shoulder, r);
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 4);
    }
    expect(min).toBeGreaterThan(0.012);
    expect(crownHeight - shoulder).toBeGreaterThan(0.035);
    geometry.dispose();
  },
);
