import { expect, it, vi } from 'vitest';
import { FormulaCar } from '../src/rendering/car.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { F, H, R, RACE_BASE, carBase } from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { disposePhase27Scene } from '../e2e/fixtures/phase27c-resources.ts';

it('powers the inspected rival’s LCD and skips an invisible APX rig behind its catalogue shell', () => {
  const context = new Proxy(
    {
      measureText: (s: string) => ({ width: s.length * 8 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    },
    { get: (o, k) => Reflect.get(o, k) ?? (() => {}) },
  );
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1 });
  const car = new FormulaCar(1),
    f = sim.makeFrame(),
    o = carBase(1);
  const pose = (cockpit: boolean) => car.update(f, f, o, 1, 0, f[H.TIME], cockpit);
  try {
    const before = car.display.version;
    car.setLod(10, 'high', false);
    pose(false);
    expect(car.display.version).toBe(before);
    car.setLod(0, 'high', true);
    pose(false);
    expect(car.display.version).toBe(before + 1);
    pose(true);
    expect(car.display.version).toBe(before + 1);
    f[H.TIME] += 0.1;
    f[o + F.GEAR] = 3;
    pose(true);
    expect(car.display.version).toBe(before + 2);
    car.catalogueBodiesAvailable = true;
    const driver = vi.spyOn(car.driver, 'update');
    for (const id of ['fx26', 'fr3', 'jf2']) {
      f[o + RACE_BASE + R.VEHICLE] = vehicleIndex(id);
      f[H.TIME] += 1;
      f[o + F.X] += 15;
      pose(true);
      expect(car.root.position.x).toBeCloseTo(f[o + F.X], 6);
      expect(car.display.version).toBe(before + 2);
      expect(driver).not.toHaveBeenCalled();
    }
    f[o + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    f[H.TIME] = 0;
    pose(true);
    expect(driver).toHaveBeenCalledTimes(1);
    expect(car.display.version).toBe(before + 3);
    car.catalogueBodiesAvailable = false;
    f[o + RACE_BASE + R.VEHICLE] = vehicleIndex('fx26');
    pose(true);
    expect(driver).toHaveBeenCalledTimes(2);
  } finally {
    disposePhase27Scene(car.root);
    vi.unstubAllGlobals();
  }
});
