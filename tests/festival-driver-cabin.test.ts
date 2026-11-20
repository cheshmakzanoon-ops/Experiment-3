import * as T from 'three';
import { describe, it, expect } from 'vitest';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { bodySheetFor } from '../src/rendering/vehicle-bodies/body-sheet.ts';
import { cabinLayout } from '../src/rendering/vehicle-bodies/cabin.ts';
import { roadSteeringWheel } from '../src/rendering/vehicle-bodies/road-steering.ts';
import { buildVehicleBody } from '../src/rendering/vehicle-bodies/index.ts';

const roadCars = Object.values(VEHICLES).filter((def) => def.classId === 'road');
describe('Festival driver eye and footwell', () => {
  it.each(roadCars)(
    '$id fits its instrument face and signs the materials on its rotating wheel',
    (def) => {
      const b = buildVehicleBody(0, def, bodySheetFor(def)!);
      const root = b.lods[0].group,
        c = b.lods[0].cabin!;
      const screen = c.detail.children.find((o) => o.name.endsWith('display')) as T.Mesh;
      c.head.visible = false;
      c.detail.visible = true;
      root.updateMatrixWorld(true);
      const wheel = c.steering.children[0] as T.Mesh;
      const geometry = wheel.geometry,
        finish = geometry.getAttribute('wheelFinish');
      expect(geometry.groups).toHaveLength(0);
      expect(finish.count).toBe(geometry.getAttribute('normal').count);
      let metal = 0,
        leather = 0;
      for (let i = 0; i < finish.count; i++) {
        if (finish.getY(i) > 0.5) metal++;
        if (finish.getY(i) === 0) leather++;
      }
      expect(metal).toBeGreaterThan(60);
      expect(leather).toBeGreaterThan(400);
      const face = new T.Vector3(0, 0, -1).transformDirection(screen.matrixWorld);
      expect(face.y).toBeGreaterThan(0);
      const panels: T.Object3D[] = [];
      root.traverseVisible((n) => {
        if (
          n instanceof T.Mesh &&
          !c.steering.getObjectById(n.id) &&
          !c.arms?.group.getObjectById(n.id)
        )
          panels.push(n);
      });
      const size = (screen.geometry as T.PlaneGeometry).parameters;
      for (const x of [-0.43, 0, 0.43])
        for (const y of [-0.41, 0, 0.41]) {
          const p = screen.localToWorld(new T.Vector3(x * size.width, y * size.height, 0));
          const ray = new T.Raycaster(
            p.clone().addScaledVector(face, 0.065),
            face.clone().negate(),
            0,
            0.066,
          );
          expect(
            ray.intersectObjects(panels, false)[0]?.object.id,
            `${def.id} screen ${x},${y}`,
          ).toBe(screen.id);
        }
      const meshes = new Set<T.BufferGeometry>();
      b.root.traverse((n) => {
        if (n instanceof T.Mesh) meshes.add(n.geometry);
      });
      for (const g of meshes) g.dispose();
      c.display?.dispose();
    },
  );
  it('occludes the near shoulder of both SC-7 front tyres from the footwell', () => {
    const d = VEHICLES.sc7,
      b = buildVehicleBody(0, d, bodySheetFor(d)!);
    const root = b.lods[0].group,
      c = b.lods[0].cabin!;
    root.updateMatrixWorld(true);
    const meshes: T.Object3D[] = [];
    root.traverseVisible((n) => {
      if (n instanceof T.Mesh) meshes.push(n);
    });
    for (const side of [-1, 1]) {
      const origin = new T.Vector3(
        side * Math.abs(c.layout.eye[0]),
        c.layout.eye[1] - 0.012,
        c.layout.eye[2] - 0.055,
      );
      for (const h of [0.025, 0.065, 0.1]) {
        const target = new T.Vector3(side * 0.716, h, b.frame.frontAxle - 0.277);
        const hits = new T.Raycaster(origin, target.sub(origin).normalize(), 0, 2).intersectObjects(
          meshes,
          false,
        );
        const tyre = hits.find((h) => h.object.name.startsWith('Tyre ('));
        expect(tyre).toBeDefined();
        expect(hits[0].distance).toBeLessThan(tyre!.distance - 0.025);
        expect(hits[0].object.name).not.toContain('Tyre');
      }
    }
    const owned = new Set<T.BufferGeometry>();
    b.root.traverse((n) => {
      if (n instanceof T.Mesh) owned.add(n.geometry);
    });
    for (const g of owned) g.dispose();
    c.display?.dispose();
  });
});

it('selects one steering-wheel range for the active lens and viewport, including a zoomed exterior', () => {
  const def = VEHICLES.rh3,
    wheel = roadSteeringWheel(cabinLayout(def, bodySheetFor(def)!));
  const camera = new T.PerspectiveCamera(60, 16 / 9, 0.02, 500),
    scene = new T.Scene();
  scene.add(wheel);
  scene.updateMatrixWorld();
  const renderer = {
    getCurrentViewport(v: T.Vector4) {
      return v.set(0, 0, 1280, 720);
    },
  } as T.WebGLRenderer;
  const pose = (z: number, zoom: number) => {
    camera.position.z = z;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    wheel.onBeforeRender(renderer, scene, camera, wheel.geometry, wheel.material, null!);
    return { ...wheel.geometry.drawRange };
  };
  const near = pose(0.7, 1),
    far = pose(12, 1);
  expect(near.start).toBe(0);
  expect(far.start).toBe(near.count);
  expect(far.count / 3).toBeLessThan(650);
  expect(far.count).toBeLessThan(near.count * 0.15);
  expect(pose(12, 4)).toEqual(near);
  expect(wheel.geometry.index!.count).toBe(far.count + near.count);
  expect(wheel.geometry.getAttribute('position').count).toBeLessThan(
    wheel.geometry.index!.count * 0.6,
  );
  wheel.geometry.dispose();
});
