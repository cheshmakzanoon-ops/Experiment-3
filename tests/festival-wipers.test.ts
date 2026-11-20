import * as T from 'three';
import { expect, it } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';

it('fits both working blades on every Festival road car and parks them on the simulation clock', () => {
  for (const id of ['rh3', 'sc7', 'eh3', 'rs5', 'rm8', 'rg63', 'rp6', 'rr4', 'lx12', 'rd2']) {
    const def = VEHICLES[id],
      body = buildVehicleBody(0, def, bodySheetFor(def)!);
    const rig = body.lods[0].wipers;
    expect(rig, id).toBeDefined();
    const wiper = rig!,
      g = wiper.mesh.geometry,
      p = g.getAttribute('position') as T.BufferAttribute;
    const read = () => Array.from(p.array);
    wiper.update(0, 0, 0);
    const parked = read();
    wiper.update(0.7, 0, 0);
    expect(read()).toEqual(parked);
    wiper.update(1.24, 12, 0);
    wiper.update(1.24 * 1.5, 12, 0);
    const sweep = read();
    expect(sweep).not.toEqual(parked);
    expect(Math.min(...sweep.filter((_, i) => i % 3 === 2)), id).toBeLessThan(
      Math.min(...parked.filter((_, i) => i % 3 === 2)) - 0.07,
    );
    expect(Math.max(...sweep.filter((_, i) => i % 3 === 1)), id).toBeGreaterThan(
      Math.max(...parked.filter((_, i) => i % 3 === 1)) + 0.11,
    );
    const version = p.version;
    wiper.update(1.24 * 1.5, 0, 0);
    expect(p.version).toBe(version);
    wiper.update(2.48, 0, 0);
    expect(read()).toEqual(parked);
    wiper.update(1.24 * 1.5, 12, 0);
    expect(read()).toEqual(sweep);
    expect(wiper.motion.z).toBeCloseTo(0.5, 8);
    expect(body.lods.slice(1).every((l) => !l.wipers)).toBe(true);
    // The camera may see either extreme, so bounds cover both poses.
    const box = g.boundingBox!,
      position = new T.Vector3(),
      centre = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      position.fromBufferAttribute(p, i);
      expect(box.containsPoint(position)).toBe(true);
    }
    const pivot = wiper.footprint,
      armVertices = 20;
    // Both flexible rubber blade sections have a cold contact line. Every
    // vertex of that line lies immediately over the actual curved glazing.
    const glass = body.lods[0].group.getObjectByName('Cabin glass') as T.Mesh | undefined;
    if (glass) {
      glass.updateMatrixWorld();
      const ray = new T.Raycaster(undefined, new T.Vector3(0, -1, 0));
      for (const pose of [0.18, 0.5, 0.79]) {
        wiper.update(1.24 * (1 + pose), 12, 0);
        for (const first of [armVertices, armVertices + 56])
          for (let seg = 0; seg <= 8; seg++) {
            const a = first + 4 * seg;
            centre.fromBufferAttribute(p, a);
            position.fromBufferAttribute(p, a + 1);
            centre.add(position).multiplyScalar(0.5);
            ray.ray.origin.copy(centre).addScaledVector(ray.ray.direction, -0.08);
            const hit = ray.intersectObject(glass, false)[0];
            expect(hit, id).toBeDefined();
            expect(centre.y - hit.point.y).toBeGreaterThan(-0.001);
            expect(centre.y - hit.point.y).toBeLessThan(0.013);
          }
      }
    }
    expect(pivot.w).toBeGreaterThan(0.34);
    body.root.traverse((n) => {
      if (n instanceof T.Mesh) n.geometry.dispose();
    });
  }
}, 120000);
