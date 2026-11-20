import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MOTOCROSS_CHASE } from '../src/rendering/offroad/chase-camera.ts';
import { GridPreparationView } from '../src/rendering/grid-preparation.ts';
import { GridPresentationView } from '../src/rendering/grid-presentation-view.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { surfaceSample } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const gates = [
  ['valley-ridge-mx', 'mx450', 'motocross-moto'],
  ['arena-nord-sx', 'mx450', 'motocross-moto'],
  ['valley-ridge-mx', 'mx250', 'motocross-moto'],
  ['arena-nord-sx', 'mx250', 'motocross-moto'],
  ['valley-ridge-mx', 'sm450', 'supermoto-moto'],
] as const;

const heldGrid = (machine: 'mx250' | 'mx450' | 'sm450' | 'apx01') =>
  new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 1,
    ruleset: gates.find(([, bike]) => bike === machine)?.[2] ?? DEFAULT_OPTIONS.ruleset,
    circuit: machine === 'apx01' ? 'aurel' : 'valley-ridge-mx',
    vehicles: [machine, machine],
  }).makeFrame();

function dispose(root: T.Object3D) {
  root.traverse((object) => {
    if (object instanceof T.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        material.dispose();
    }
    if (object instanceof T.InstancedMesh) object.dispose();
  });
}

describe('motocross gates keep staff without Formula tyre blankets', () => {
  it.each(gates)(
    'plants eight teams on %s behind their own %s rear wheels',
    (circuit, machine, ruleset) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        circuit,
        mode: 'race',
        ruleset,
        opponents: 7,
        vehicles: Array(8).fill(machine),
      });
      const frame = sim.makeFrame(),
        view = new GridPreparationView(),
        foot = new T.Vector3(),
        m = new T.Matrix4(),
        soil = surfaceSample();
      const camera = new T.Vector3().fromArray(frame, carBase(0) + F.X);
      try {
        for (let id = 0; id < 8; id++)
          expect(frame[carBase(id) + RACE_BASE + R.VEHICLE]).toBe(vehicleIndex(machine));
        view.update(frame, camera, true, sim.track);
        expect(view.diagnostics()).toEqual({ blankets: 0, staff: 16 });
        expect(view.straps.count).toBe(0);
        const bodies = view.root.getObjectByName(
          'Grid preparation staff bodies',
        ) as T.InstancedMesh;
        expect(bodies.count).toBe(16);
        for (let i = 0; i < bodies.count; i++) {
          bodies.getMatrixAt(i, m);
          foot.setFromMatrixPosition(m);
          sim.track.sample(foot.x, foot.z, soil);
          expect(Math.abs(foot.y - soil.height)).toBeLessThan(0.035);
          const o = carBase(Math.floor(i / 2)),
            bike = new T.Vector3().fromArray(frame, o + F.X);
          const heading = new T.Vector3(0, 0, 1).applyQuaternion(
            new T.Quaternion().fromArray(frame, o + F.QX),
          );
          heading.y = 0;
          heading.normalize();
          const offset = foot.clone().sub(bike);
          expect(offset.dot(heading)).toBeLessThan(-MOTOCROSS_CHASE.distance - 0.5);
          expect(Math.abs(offset.x * heading.z - offset.z * heading.x)).toBeLessThan(0.31);
          expect(new T.Vector3(0, 1, 0).transformDirection(m).y).toBeCloseTo(1, 6);
        }
      } finally {
        dispose(view.root);
      }
    },
  );
  it.each(gates)(
    'keeps the %s radio crew on their %s gate apron through walk-off and replay',
    (circuit, machine, ruleset) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        circuit,
        mode: 'race',
        ruleset,
        opponents: 7,
        vehicles: Array(8).fill(machine),
      });
      const view = new GridPresentationView(),
        frame = sim.makeFrame(),
        camera = new T.Vector3().fromArray(frame, carBase(0) + F.X),
        matrix = new T.Matrix4(),
        point = new T.Vector3(),
        soil = surfaceSample();
      const bikes = Array.from({ length: 8 }, (_, i) => {
        const base = carBase(i),
          origin = new T.Vector3().fromArray(frame, base + F.X);
        const forward = new T.Vector3(0, 0, 1).applyQuaternion(
          new T.Quaternion().fromArray(frame, base + F.QX),
        );
        forward.y = 0;
        return { origin, forward: forward.normalize() };
      });
      const radios = view.root.getObjectByName('Motocross gate crew radios') as T.InstancedMesh;
      try {
        let held: number[][] = [];
        for (const t of [0, 26, 0]) {
          view.update(frame, camera, t, sim.track);
          expect(view.diagnostics()).toMatchObject({
            blankets: 0, actors: 0, cast: { actors: 16, umbrellas: 0, tablets: 8 },
          });
          expect(radios.count).toBe(8);
          const poses: number[][] = [];
          for (let batch = 0; batch < 4; batch++) {
            const bodies = view.root.getObjectByName(
              `Grid presentation staff bodies ${batch}`,
            ) as T.InstancedMesh;
            for (let i = 0; i < bodies.count; i++) {
              bodies.getMatrixAt(i, matrix);
              point.setFromMatrixPosition(matrix);
              sim.track.sample(point.x, point.z, soil);
              expect(Math.abs(point.y - soil.height)).toBeLessThan(0.01);
              expect(new T.Vector3(0, 1, 0).transformDirection(matrix).y).toBeCloseTo(1, 6);
              const inOwnSlot = bikes.some(({ origin, forward }) => {
                const dx = point.x - origin.x,
                  dz = point.z - origin.z;
                return (
                  Math.abs(dx * forward.z - dz * forward.x) < 0.3 &&
                  dx * forward.x + dz * forward.z < (t ? -3 : -1.3)
                );
              });
              expect(inOwnSlot).toBe(true);
              poses.push([...matrix.elements]);
            }
          }
          if (!held.length) held = poses;
          else if (t === 0) expect(poses).toEqual(held);
        }
        view.update(frame, camera, null, sim.track);
        expect(radios.count).toBe(0);
      } finally {
        view.dispose();
        dispose(view.root);
      }
    },
  );

  it('clears car blankets and straps on all three dirt bikes and restores Formula on the same view', () => {
    const formula = heldGrid('apx01'),
      mx250 = heldGrid('mx250'),
      mx450 = heldGrid('mx450'),
      sm450 = heldGrid('sm450'),
      view = new GridPreparationView();
    let formulaMatrices: Float32Array | undefined;
    try {
      for (const frame of [formula, mx250, formula, mx450, sm450, formula]) {
        const before = frame.slice(),
          isFormula = frame === formula,
          camera = new T.Vector3().fromArray(frame, carBase(0) + F.X);
        expect(frame[H.TIME]).toBe(0);
        view.update(frame, camera);
        expect(view.diagnostics()).toEqual({ blankets: isFormula ? 8 : 0, staff: 4 });
        expect(view.straps.count).toBe(isFormula ? 16 : 0);
        if (isFormula) {
          const matrices = view.blankets.instanceMatrix.array as Float32Array;
          if (formulaMatrices) expect(matrices).toEqual(formulaMatrices);
          else formulaMatrices = matrices.slice();
        }
        expect(frame).toEqual(before);
      }
      for (const frame of [mx250, mx450, sm450]) {
        const camera = new T.Vector3().fromArray(frame, carBase(0) + F.X);
        frame[H.TIME] = 0.4;
        view.update(frame, camera);
        expect(view.diagnostics()).toEqual({ blankets: 0, staff: 0 });
        expect(view.straps.count).toBe(0);
        frame[H.TIME] = 0;
        view.update(frame, camera);
        expect(view.diagnostics()).toEqual({ blankets: 0, staff: 4 });
      }
    } finally {
      dispose(view.root);
    }
  });

  it('keeps the tick-zero presentation cast while skipping MX blanket-removal rigs and restoring Formula', () => {
    const formula = heldGrid('apx01'),
      mx250 = heldGrid('mx250'),
      mx450 = heldGrid('mx450'),
      sm450 = heldGrid('sm450'),
      view = new GridPresentationView();
    let formulaDiagnostics: ReturnType<GridPresentationView['diagnostics']> | undefined;
    try {
      for (const frame of [formula, mx250, formula, mx450, sm450, formula]) {
        const before = frame.slice(),
          isFormula = frame === formula,
          camera = new T.Vector3().fromArray(frame, carBase(0) + F.X);
        for (const time of [0, 12, 4, 12]) {
          view.update(frame, camera, time);
          const result = view.diagnostics();
          expect(result.blankets).toBe(isFormula ? 8 : 0);
          expect(result.actors).toBe(isFormula ? 8 : 0);
          expect(result.cast.actors).toBe(4);
          if (isFormula && time === 12) {
            if (formulaDiagnostics) expect(result).toEqual(formulaDiagnostics);
            else formulaDiagnostics = result;
          }
        }
        expect(frame).toEqual(before);
      }
      view.update(mx450, new T.Vector3().fromArray(mx450, carBase(0) + F.X), null);
      expect(view.diagnostics()).toMatchObject({ blankets: 0, actors: 0, cast: { actors: 0 } });
    } finally {
      view.dispose();
      dispose(view.root);
    }
  });
});
