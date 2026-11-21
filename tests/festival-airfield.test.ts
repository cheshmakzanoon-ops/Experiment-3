import * as T from 'three';
import { expect, it } from 'vitest';
import type { Structure } from '../src/simulation/open-world/placement.ts';
import { Buildings } from '../src/rendering/open-world/buildings.ts';

it('fits a raked control cab, an open gallery and a road-level entrance to the Kestrel tower', () => {
  const site: Structure = {
    kind: 'tower',
    x: 128,
    z: 72,
    base: 8,
    height: 26,
    hx: 4,
    hz: 4,
    heading: 0.35,
    floors: 7,
    style: 27,
  };
  const buildings = new Buildings([site]);
  try {
    const group = buildings.root.getObjectByName('Kestrel air traffic control')!;
    const panes = group.getObjectByName('Eight outward-raked control-room panes') as T.Mesh<
      T.CylinderGeometry,
      T.MeshPhysicalMaterial
    >;
    const fittings = group.getObjectByName('Gallery rails, consoles and stair details')!;
    const practical = group.getObjectByName('Cab luminaires, displays and aerial lamp') as T.Mesh<
      T.BufferGeometry,
      T.MeshBasicMaterial
    >;
    buildings.root.updateMatrixWorld(true);
    expect(group.children.length).toBe(4);
    expect(panes.geometry.parameters.radialSegments).toBe(8);
    expect(panes.geometry.parameters.radiusTop).toBeGreaterThan(
      panes.geometry.parameters.radiusBottom,
    );
    expect(panes.material.transparent).toBe(true);
    expect(panes.material.depthWrite).toBe(false);
    const shell = group.getObjectByName('Control tower core, gallery and roof')!;
    const eye = group.localToWorld(new T.Vector3(0.5, 1.4, 8));
    const normal = new T.Vector3(0, 0, -1).transformDirection(group.matrixWorld);
    const [groundFloor] = new T.Raycaster(eye, normal, 0, 10).intersectObject(shell);
    expect(groundFloor.distance).toBeCloseTo(4, 5);
    const c = new T.PerspectiveCamera(55, 1.8, 0.02, 3000);
    c.position.copy(group.position).z += 40;
    c.updateMatrixWorld();
    buildings.update(c, 'medium', 720);
    expect(fittings.visible).toBe(true);
    c.position.z += 1400;
    c.updateMatrixWorld();
    buildings.update(c, 'medium', 720);
    expect(fittings.visible).toBe(false);
    expect(panes.visible).toBe(true);
    buildings.setNight(0);
    const daylight = practical.material.color.r;
    buildings.setNight(1);
    expect(practical.material.color.r).toBeGreaterThan(4 * daylight);
    expect(buildings.stats.triangles).toBeLessThan(6000);
  } finally {
    buildings.dispose();
  }
});
