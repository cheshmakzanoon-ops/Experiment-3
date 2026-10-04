import { expect, it } from 'vitest';
import * as T from 'three';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  drainGratingGeometry,
  trackInfrastructurePlan,
} from '../src/rendering/track-infrastructure.ts';

it('keeps the Quarry drain bars visible above the actual shipping runoff triangles', () => {
  const track = new Track();
  const shell = Object.assign(Object.create(CircuitScene.prototype) as CircuitScene, {
    track,
    surfaces: new T.Group(),
  });
  const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
  const p = trackPoint();
  const runoff = shell.ribbon(material, {
    start: 1080,
    end: 1510,
    columns: 4,
    offset: (s, t) => (t * 2 - 1) * (track.at(s, p).width + 4),
    height: () => -0.008,
  });
  expect(runoff.geometry.index!.count).toBeGreaterThan(0);
  shell.surfaces.updateMatrixWorld(true);
  const ray = new T.Raycaster();
  let checked = 0;
  for (const site of trackInfrastructurePlan(track).drains) {
    if (site.s < 1090 || site.s > 1500) continue;
    const { grate, bed } = drainGratingGeometry(track, site);
    const pos = grate.getAttribute('position');
    // Sample the top of every authored bar; independently raycast the retained
    // renderer's real runoff mesh at those world coordinates, not a helper formula.
    for (let i = 0; i < pos.count; i++) {
      if (grate.getAttribute('normal').getY(i) < 0.95) continue;
      const x = site.x + Math.cos(site.yaw) * pos.getX(i) + Math.sin(site.yaw) * pos.getZ(i);
      const z = site.z - Math.sin(site.yaw) * pos.getX(i) + Math.cos(site.yaw) * pos.getZ(i);
      ray.set(new T.Vector3(x, site.y + 2, z), new T.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(shell.surfaces.children, false)[0];
      expect(hit).toBeDefined();
      const above = pos.getY(i) + site.y - hit.point.y;
      expect(above, `buried drain at ${site.s}m: ${above}`).toBeGreaterThan(0.0005);
      expect(above).toBeLessThan(0.009);
      checked++;
    }
    grate.dispose();
    bed.dispose();
  }
  expect(checked).toBeGreaterThan(300);
  shell.surfaces.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });
  material.dispose();
});
