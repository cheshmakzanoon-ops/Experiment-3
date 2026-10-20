import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { gpBrakeRotor, GP_FRONT_DISC } from '../src/rendering/gp-brake-rotor.ts';
import { GP_RADIAL_BRAKE, gpRadialBrakeCaliper } from '../src/rendering/gp-radial-caliper.ts';

function assembly(detail: 'high' | 'mid' | 'far') {
  const materials = {
    disc: new T.MeshStandardMaterial(),
    aluminium: new T.MeshStandardMaterial(),
    steel: new T.MeshStandardMaterial(),
  };
  const meshes = gpBrakeRotor(detail, materials);
  const root = new T.Group();
  root.add(...meshes);
  root.updateMatrixWorld(true);
  return {
    materials,
    meshes,
    root,
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}

describe('GP carbon front brake assembly', () => {
  it.each(['high', 'mid', 'far'] as const)(
    '%s keeps a complete 340 mm friction annulus, eight-millimetre faces and the shared pad fit',
    (detail) => {
      const model = assembly(detail);
      try {
        expect(GP_FRONT_DISC.thickness).toBe(0.008);
        expect(GP_RADIAL_BRAKE.rotorThickness).toBe(GP_FRONT_DISC.thickness);
        const band = model.meshes[0];
        const bounds = new T.Box3().setFromObject(band);
        expect(bounds.max.y - bounds.min.y).toBeCloseTo(0.34, 7);
        expect(bounds.max.z - bounds.min.z).toBeCloseTo(0.34, 7);
        expect(bounds.max.x - bounds.min.x).toBeCloseTo(0.008, 7);
        // Sampling between tessellation vertices catches accidental slots,
        // reversed faces, or a visual ring with no depth.
        for (const side of [-1, 1])
          for (let i = 0; i < 48; i++) {
            const angle = ((i + 0.37) * Math.PI) / 24;
            const hit = new T.Raycaster(
              new T.Vector3(side * 0.05, 0.145 * Math.sin(angle), -0.145 * Math.cos(angle)),
              new T.Vector3(-side, 0, 0),
            ).intersectObject(band)[0];
            expect(hit).toBeDefined();
            expect(hit.point.x).toBeCloseTo(side * 0.004, 7);
          }
        expect(
          new T.Raycaster(new T.Vector3(0.05, 0, 0), new T.Vector3(-1, 0, 0))
            .intersectObject(model.root),
        ).toHaveLength(0);
      } finally {
        model.dispose();
      }
    },
  );

  it.each(['high', 'mid'] as const)(
    '%s shows real carrier windows, connected webs and open floating-bobbin bores',
    (detail) => {
      const model = assembly(detail);
      try {
        const carrier = model.meshes[1], hardware = model.meshes[2];
        const ray = (radius: number, angle: number) =>
          new T.Raycaster(
            new T.Vector3(0.05, radius * Math.sin(angle), -radius * Math.cos(angle)),
            new T.Vector3(-1, 0, 0),
          );
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          expect(ray(0.077, a + Math.PI / 6).intersectObject(model.root)).toHaveLength(0);
          expect(ray(0.077, a).intersectObject(carrier).length).toBeGreaterThan(0);
          expect(ray(0.113, a).intersectObject(hardware)).toHaveLength(0);
          expect(ray(0.119, a).intersectObject(hardware)[0].point.x).toBeCloseTo(0.005, 7);
          // The connected outer carrier reaches beneath the friction band,
          // and the bobbin rings physically span both materials.
          expect(ray(0.117, a).intersectObject(carrier).length).toBeGreaterThan(0);
          expect(ray(0.117, a).intersectObject(model.meshes[0]).length).toBeGreaterThan(0);
        }
      } finally {
        model.dispose();
      }
    },
  );


  it('keeps both stationary calipers clear of the full spinning friction band', () => {
    // Two-sided rays are essential: a ray starting inside an intersecting
    // housing bridge otherwise misses its back-facing exit and can pass.
    const materials = {
      caliper: new T.MeshStandardMaterial({ side: T.DoubleSide }),
      aluminium: new T.MeshStandardMaterial({ side: T.DoubleSide }),
      steel: new T.MeshStandardMaterial({ side: T.DoubleSide }),
      dark: new T.MeshStandardMaterial({ side: T.DoubleSide }),
    };
    try {
      for (const side of [-1, 1] as const) {
        const caliper = gpRadialBrakeCaliper(side, materials);
        caliper.position.set(side * GP_FRONT_DISC.sideOffset, -0.02, -0.135);
        caliper.updateMatrixWorld(true);
        try {
          for (let radial = 0; radial <= 10; radial++) {
            const radius = 0.116 + radial * 0.0053;
            for (let angle = 0; angle < 180; angle++) {
              const a = (angle * Math.PI) / 90;
              const ray = new T.Raycaster(
                new T.Vector3(
                  side * GP_FRONT_DISC.sideOffset,
                  radius * Math.sin(a),
                  radius * Math.cos(a),
                ),
                new T.Vector3(1, 0, 0),
              );
              for (const mesh of caliper.children) {
                const hits = ray.intersectObject(mesh);
                const distinct = hits.filter(
                  (hit, index) => index === 0 || hit.distance - hits[index - 1].distance > 1e-7,
                );
                // An odd number of crossings means the rotor centre is
                // inside a closed caliper part. The former bridge fails here.
                expect(distinct.length % 2).toBe(0);
                if (distinct.length)
                  expect(distinct[0].distance).toBeGreaterThanOrEqual(0.004 - 1e-7);
              }
            }
          }
        } finally {
          caliper.traverse((object) => {
            if (object instanceof T.Mesh) object.geometry.dispose();
          });
        }
      }
    } finally {
      for (const material of Object.values(materials)) material.dispose();
    }
  });

  it('keeps every detail level bounded, finite and owned by the existing wheel materials', () => {
    const counts: number[] = [];
    for (const [detail, budget] of [
      ['high', 2500],
      ['mid', 1500],
      ['far', 200],
    ] as const) {
      const model = assembly(detail);
      try {
        let triangles = 0;
        for (const mesh of model.meshes) {
          expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
          expect(Object.values(model.materials)).toContain(mesh.material);
          for (const attribute of Object.values(mesh.geometry.attributes))
            expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
          triangles +=
            (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3;
        }
        expect(model.meshes).toHaveLength(detail === 'far' ? 1 : 3);
        expect(triangles).toBeLessThan(budget);
        counts.push(triangles);
      } finally {
        model.dispose();
      }
    }
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });
});
