import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  FORMULA_GRID_AXLE,
  formulaGridForFrame,
  formulaGridGeometry,
} from '../src/rendering/formula-grid-marks.ts';
import { GridPaintPresentation } from '../src/rendering/grid-paint.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { carBase, F, H, R, RACE_BASE } from '../src/simulation/protocol.ts';
import { trackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

describe('Formula starting-grid paint', () => {
  it.each(['aurel', 'vellamar', 'poggio-alto'] as const)(
    'seats the numbered %s boxes on the surface at the actual start positions',
    (circuit) => {
      const sim = new Simulation(
        { ...DEFAULT_OPTIONS, circuit, opponents: 11, vehicles: Array(12).fill('apx01') },
        circuitDefinition(circuit),
      );
      const geometry = formulaGridGeometry(sim.track);
      const pos = geometry.getAttribute('position'),
        uv = geometry.getAttribute('uv'),
        color = geometry.getAttribute('color'),
        normal = geometry.getAttribute('normal');
      const road = trackPoint(),
        frame = sim.makeFrame();
      const marked = new Set<number>();
      for (let i = 0; i < pos.count; i++) {
        const s = uv.getY(i) * 5,
          l = uv.getX(i) * 5;
        sim.track.at(s, road);
        expect(pos.getY(i)).toBeCloseTo(road.y + l * road.bank + 0.007, 3);
        expect(pos.getX(i)).toBeCloseTo(road.x + l * road.nx, 2);
        expect(pos.getZ(i)).toBeCloseTo(road.z + l * road.nz, 2);
        expect(normal.getY(i)).toBeGreaterThan(0.95);
        expect(Math.abs(l)).toBeLessThan(road.width - 0.15);
        if (color.getZ(i) < 0.2) {
          for (let id = 0; id < 12; id++) {
            const o = carBase(id);
            if (
              Math.abs(s - frame[o + F.S] - FORMULA_GRID_AXLE) < 0.041 &&
              Math.abs(l - sim.cars[id].lateral) < 1.9
            )
              marked.add(id);
          }
        }
      }
      expect(marked.size).toBe(12);
      expect(geometry.index!.count / 3).toBeLessThan(390);
      geometry.dispose();
    },
  );

  it('reuses the same one-draw markings across roster switches and restores the original mixed field', () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      opponents: 3,
      vehicles: ['apx01', 'fx26', 'fr3', 'jf2'],
    });
    const frame = sim.makeFrame();
    expect(formulaGridForFrame(frame)).toBe(true);
    const paint = new GridPaintPresentation(sim.track, new T.MeshStandardMaterial());
    paint.setGrandPrix(false, true);
    paint.build(new T.Group());
    const layer = paint.root.children[0],
      mesh = layer.children[0] as T.Mesh;
    expect(layer.children).toHaveLength(1);
    expect(mesh.receiveShadow && !mesh.castShadow).toBe(true);
    expect((mesh.material as T.MeshStandardMaterial).vertexColors).toBe(true);
    frame[carBase(3) + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
    paint.setGrandPrix(false, formulaGridForFrame(frame));
    expect(paint.diagnostics().mode).toBe('original');
    expect(layer.visible).toBe(false);
    paint.setGrandPrix(true);
    paint.setGrandPrix(false, true);
    expect(layer.visible).toBe(true);
    expect(layer.children[0]).toBe(mesh);
    expect(paint.root.children.filter((c) => c.visible)).toEqual([layer]);
    const index = carBase(3) + RACE_BASE + R.VEHICLE;
    for (const bad of [NaN, -10, 99999, 0.5]) {
      frame[index] = bad;
      expect(formulaGridForFrame(frame)).toBe(false);
    }
    frame[H.CARS] = 13;
    expect(formulaGridForFrame(frame)).toBe(false);
    expect(formulaGridForFrame(frame.subarray(0, 18))).toBe(false);
  });
});
