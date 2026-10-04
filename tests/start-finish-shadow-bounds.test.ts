import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { StartFinishVenue } from '../src/rendering/start-finish-venue.ts';
import { buildGrandstand } from '../src/rendering/grandstand.ts';
import { AUREL_VENUE } from '../src/rendering/venue-plan.ts';
import { Simulation } from '../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, carBase } from '../src/simulation/protocol.ts';
import { lightingDirection, shadowAnchor } from '../src/rendering/daylight.ts';

function stand() {
  const context = { fillRect() {}, fillText() {}, measureText: () => ({ width: 10 }) };
  const previous = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElement: () => ({ getContext: () => context, width: 0, height: 0 }) },
  });
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', opponents: 11, seed: 1887 });
  sim.autoPlayer = true;
  for (let i = 0; i < 960; i++) sim.step(1 / 120);
  const props = new T.Group();
  const crowd = new T.Group();
  const venue = new StartFinishVenue(sim.track);
  const material = new T.MeshStandardMaterial();
  const mats = {
    concrete: material,
    steel: material,
    roof: material,
    underside: material,
    seats: material,
    people: material,
    sign: material,
  };
  try {
    const site = AUREL_VENUE.grandstands.find((s) => s.s === 55)!;
    const root = buildGrandstand(sim.track, props, crowd, site, mats, [], undefined, venue);
    props.updateMatrixWorld(true);
    return { sim, props, crowd, root, venue };
  } finally {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: previous });
  }
}
function dispose(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const material of [o.material].flat()) material.dispose();
      if (o instanceof T.InstancedMesh) o.dispose();
    }
  });
}

describe('production start-finish shadow frustum', () => {
  for (const lighting of ['day', 'sunset'] as const) {
    it(`rejects the ${lighting} sphere false-positive without changing seat geometry`, () => {
      const { sim, props, crowd, root } = stand();
      const frame = sim.makeFrame(),
        original = frame.slice(),
        b = carBase(0);
      const target = new T.Vector3(frame[b + F.X], frame[b + F.Y], frame[b + F.Z]);
      const light = new T.DirectionalLight();
      const shadow = light.shadow.camera;
      Object.assign(shadow, { left: -38, right: 38, top: 38, bottom: -38, near: 20, far: 500 });
      shadow.updateProjectionMatrix();
      shadowAnchor(target, 1024, 38, light.target.position, lighting);
      light.position.copy(light.target.position).add(lightingDirection(lighting));
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
      light.shadow.updateMatrices(light);
      const view = new T.PerspectiveCamera(58, 16 / 9);
      const depth = new T.MeshDepthMaterial();
      const renderer = {} as T.WebGLRenderer;
      try {
        for (const tier of ['near', 'mid', 'far']) {
          const seats = root.getObjectByName(`seat_${tier}`) as T.InstancedMesh;
          const geometry = seats.geometry,
            index = geometry.index,
            instance = seats.instanceMatrix;
          const range = { ...geometry.drawRange },
            matrices = instance.array.slice();
          expect(light.shadow.getFrustum().intersectsObject(seats)).toBe(true);
          // Independent, per-instance oracle: none of the 952 actual seats
          // intersects the light, although Three's aggregate sphere does.
          const local = new T.Frustum().setFromProjectionMatrix(
            new T.Matrix4()
              .multiplyMatrices(shadow.projectionMatrix, shadow.matrixWorldInverse)
              .multiply(seats.matrixWorld),
          );
          const matrix = new T.Matrix4();
          for (let i = 0; i < seats.count; i++) {
            seats.getMatrixAt(i, matrix);
            expect(local.intersectsBox(geometry.boundingBox!.clone().applyMatrix4(matrix))).toBe(
              false,
            );
          }
          seats.onBeforeShadow(
            renderer,
            seats as unknown as T.Scene,
            view,
            shadow,
            geometry,
            depth,
            null as unknown as T.Group,
          );
          expect(geometry.drawRange.count).toBe(0);
          expect(seats.count).toBe(0);
          seats.onAfterShadow(
            renderer,
            seats as unknown as T.Scene,
            view,
            shadow,
            geometry,
            depth,
            null as unknown as T.Group,
          );
          expect(geometry.drawRange).toEqual(range);
          expect(seats.castShadow).toBe(true);
          expect(seats.count).toBe(952);
          expect(seats.geometry).toBe(geometry);
          expect(geometry.index).toBe(index);
          expect(seats.instanceMatrix).toBe(instance);
          expect(instance.array).toEqual(matrices);
        }
        expect(frame).toEqual(original);
      } finally {
        depth.dispose();
        dispose(props);
        dispose(crowd);
      }
    });
  }
});
