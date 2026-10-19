import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { clamp } from '../src/core/math.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { GP_R1 } from '../src/simulation/bike-definitions.ts';
import { CircuitScene } from '../src/rendering/circuit.ts';
import { batchScene, box } from '../src/rendering/geometry.ts';
import {
  GP_GRID_PAINT,
  GridPaintPresentation,
  gpGridPaintGeometry,
} from '../src/rendering/grid-paint.ts';
import { StaticTransformGroup } from '../src/rendering/static-transform-group.ts';
import { gpLaunchGridFor, surfaceGridFor } from '../src/rendering/studio/road-detail.ts';

function meshes(root: T.Object3D) {
  const list: T.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof T.Mesh) list.push(object);
  });
  return list;
}

function dispose(root: T.Object3D) {
  meshes(root).forEach((mesh) => mesh.geometry.dispose());
}

/** Frozen negative control: the car boxes previously authored by CircuitScene.
 * Comparing the final batches protects original positions, normals and UVs. */
function originalGrid(track: Track, material: T.MeshStandardMaterial) {
  const root = new T.Group(),
    grid = surfaceGridFor(track);
  for (let i = 0; i < grid.rows * 2; i++) {
    const s = track.length - grid.front - Math.floor(i / 2) * grid.spacing,
      l = i % 2 === 0 ? -grid.lateral : grid.lateral,
      p = track.at(s, trackPoint()),
      slot = new T.Group();
    slot.position.set(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + 0.012, p.z + p.nz * l);
    slot.rotation.y = Math.atan2(p.tx, p.tz);
    root.add(slot);
    for (const x of [-1.1, 1.1]) box(slot, material, x, 0, 0, 0.08, 0.01, 4);
    box(slot, material, 0, 0, 2, 2.3, 0.01, 0.08);
  }
  batchScene(root, new Set());
  return root;
}

describe('GP grid paint uses motorcycle scale and the production surface', () => {
  it('places all twelve GP launch paths under the real simulation rear-wheel contacts', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit: 'poggio-alto',
      mode: 'race',
      opponents: 11,
      vehicles: Array(12).fill('gpr1'),
    });
    const enabled = { value: 1 },
      grid = gpLaunchGridFor(sim.track, enabled);
    expect(grid.enabled).toBe(enabled);
    expect(grid.slots).toHaveLength(sim.cars.length * 2);
    for (let i = 0; i < sim.cars.length; i++) {
      expect(grid.slots[i * 2]).toBeCloseTo(
        sim.cars[i].s - sim.track.length - GP_R1.bike!.cgToRear,
        4,
      );
      expect(grid.slots[i * 2 + 1]).toBeCloseTo(sim.cars[i].lateral, 5);
    }
  });
  it.each(['aurel', 'vellamar', 'poggio-alto'])(
    'keeps each compact %s mark on the graded road with upward normals',
    (id) => {
      const track = new Track('clear', false, undefined, circuitDefinition(id));
      // Include a corner grade as well as the start straight: stamp placement
      // must use each actual vertex datum, not one flat plane per grid slot.
      for (const s of [track.length - track.pit.gridStart, 570, 1270]) {
        const geometry = gpGridPaintGeometry(track, s, -track.pit.gridColumn),
          position = geometry.getAttribute('position'),
          uv = geometry.getAttribute('uv'),
          normal = geometry.getAttribute('normal');
        expect(geometry.index!.count).toBe(18);
        for (let i = 0; i < position.count; i++) {
          const along = uv.getY(i) * 5,
            lateral = uv.getX(i) * 5,
            at = track.at(along, trackPoint());
          expect(position.getX(i)).toBeCloseTo(at.x + at.nx * lateral, 3);
          expect(position.getZ(i)).toBeCloseTo(at.z + at.nz * lateral, 3);
          expect(position.getY(i)).toBeCloseTo(
            at.y + at.bank * clamp(lateral, -12, 12) + GP_GRID_PAINT.lift,
            4,
          );
          expect(normal.getY(i)).toBeGreaterThan(0.97);
          expect(Math.abs(lateral)).toBeLessThan(at.width - 0.25);
        }
        const along = Array.from({ length: uv.count }, (_, i) => uv.getY(i) * 5),
          across = Array.from({ length: uv.count }, (_, i) => uv.getX(i) * 5);
        expect(Math.max(...across) - Math.min(...across)).toBeCloseTo(1.3, 5);
        expect(Math.max(...along) - Math.min(...along)).toBeLessThan(0.75);
        expect(Math.min(...along) - s).toBeGreaterThan(0.4);
        geometry.dispose();
      }
    },
  );

  it.each(['aurel', 'poggio-alto'])(
    'preserves the exact original %s car/road-bike batches after GP switches',
    (id) => {
      const track = new Track('clear', false, undefined, circuitDefinition(id)),
        material = new T.MeshStandardMaterial(),
        parent = new T.Group(),
        paint = new GridPaintPresentation(track, material),
        original = originalGrid(track, material);
      paint.build(parent);
      const retained = paint.root.children[0],
        actual = meshes(retained),
        expected = meshes(original);
      expect(actual).toHaveLength(expected.length);
      for (let i = 0; i < actual.length; i++) {
        expect(actual[i].castShadow).toBe(expected[i].castShadow);
        expect(actual[i].receiveShadow).toBe(expected[i].receiveShadow);
        expect(actual[i].geometry.index!.array).toEqual(expected[i].geometry.index!.array);
        for (const name of ['position', 'normal', 'uv'])
          expect(actual[i].geometry.getAttribute(name).array).toEqual(
            expected[i].geometry.getAttribute(name).array,
          );
      }
      paint.setGrandPrix(true);
      paint.setGrandPrix(false);
      expect(paint.root.children[0]).toBe(retained);
      expect(retained.visible).toBe(true);
      dispose(parent);
      dispose(original);
      material.dispose();
    },
  );

  it('retains at most two paint layers through live/replay switches and scene batching', () => {
    const track = new Track(),
      material = new T.MeshStandardMaterial(),
      props = new StaticTransformGroup(),
      surfaces = new StaticTransformGroup(),
      paint = new GridPaintPresentation(track, material);
    let family = 'car';
    const scene = Object.assign(Object.create(CircuitScene.prototype), {
      props,
      surfaces,
      gridPaint: paint,
      grandPrixGrid: { value: 0 },
      motorcycleSurface: { value: 0 },
      gpSurface: { value: 0 },
      tyreRubber: {
        setMotorcycle: (enabled: boolean, gp: boolean) => {
          const next = enabled ? (gp ? 'gp' : 'bike') : 'car',
            changed = family !== next;
          family = next;
          return changed;
        },
      },
    }) as CircuitScene;
    // Menu selection can arrive before construction reaches the paint job.
    scene.setGrandPrixGrid(true);
    paint.build(props);
    scene.setGrandPrixGrid(false);
    batchScene(props, new Set([paint.root]));
    props.sealTransforms();
    props.updateMatrixWorld(true);
    const retained = meshes(paint.root),
      geometry = retained.map((mesh) => mesh.geometry);
    for (let i = 0; i < 90; i++) {
      scene.setMotorcyclePresentation(i % 3 !== 0, i % 3 === 2);
      scene.setGrandPrixGrid(i % 3 === 2);
      props.updateMatrixWorld(true);
      expect(paint.diagnostics().cachedLayers).toBe(2);
      expect(paint.root.children.filter((layer) => layer.visible)).toHaveLength(1);
      expect(meshes(paint.root).map((mesh) => mesh.geometry)).toEqual(geometry);
    }
    paint.build(props);
    expect(props.children).toEqual([paint.root]);
    expect(new Set(retained.map((mesh) => mesh.material))).toEqual(new Set([material]));
    scene.setGrandPrixGrid(true);
    scene.setMotorcyclePresentation(false);
    expect(paint.diagnostics().mode).toBe('gp');
    const gp = paint.root.children.find((layer) => layer.visible)!;
    const gpMeshes = meshes(gp);
    expect(gpMeshes.every((mesh) => !mesh.castShadow && mesh.receiveShadow)).toBe(true);
    expect(gpMeshes.reduce((sum, mesh) => sum + mesh.geometry.index!.count / 3, 0)).toBe(72);
    const bytes = gpMeshes.reduce(
      (sum, mesh) =>
        sum +
        Object.values(mesh.geometry.attributes).reduce(
          (n, attribute) => n + attribute.array.byteLength,
          0,
        ) +
        mesh.geometry.index!.array.byteLength,
      0,
    );
    expect(bytes).toBeLessThan(6000);
    dispose(props);
    material.dispose();
  });
});
