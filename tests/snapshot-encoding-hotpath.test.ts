import { describe, expect, it, vi } from 'vitest';
import { Random } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';
import { CAR_STRIDE, F, HEADER, carBase } from '../src/simulation/protocol.ts';
import { VEHICLE_IDS, vehicleAt, vehicleIndex } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import { referenceWorldSnapshot } from './helpers/reference-world-snapshot.ts';

const scenarios: { name: string; options: Partial<SessionOptions> }[] = [
  {
    name: 'twelve wet Formula and touring cars',
    options: {
      opponents: 11,
      weather: 'rain',
      vehicles: Array.from({ length: 12 }, (_, i) => (i % 2 ? 'tc1' : 'apx01')),
    },
  },
  {
    name: 'road motorcycles',
    options: { vehicles: ['gpr1', 'sbk1000', 'gpr2', 'ss600'] },
  },
  {
    name: 'mixed road cars and motorcycles',
    options: { vehicles: ['apx01', 'gpr1', 'tc1', 'sbk1000'] },
  },
  {
    name: 'motocross gate',
    options: {
      mode: 'race',
      circuit: 'valley-ridge-mx',
      ruleset: 'motocross-moto',
      vehicles: ['mx450', 'mx250', 'mx450', 'mx250'],
    },
  },
  {
    name: 'rallycross cars',
    options: { circuit: 'kestrel-rx', ruleset: 'rallycross', vehicles: Array(4).fill('rcx6') },
  },
  {
    name: 'rally stage cars',
    options: {
      mode: 'race',
      circuit: 'pinewood-stage',
      ruleset: 'rally-stage',
      vehicles: Array(4).fill('rl2'),
    },
  },
  {
    name: 'supermoto on pavement',
    options: { vehicles: Array(4).fill('sm450') },
  },
  {
    name: 'four-wheel cars after motorcycle sessions',
    options: {},
  },
];

function session(options: Partial<SessionOptions> = {}) {
  return new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 3, ...options });
}

function bytes(frame: Float32Array) {
  return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
}

describe('snapshot encoder byte compatibility', () => {
  // The four-entrant cases recycle the same subarray across all vehicle families.
  // A filtered run starts with the same dirty sentinel, so no test needs a predecessor.
  const recycledStorage = new Float32Array(HEADER + 4 * CAR_STRIDE + 8).fill(-987.25);
  it.each(scenarios)('matches the reference writer for seeded $name', ({ options }) => {
    const sim = session({ ...options, seed: 73021 });
    const random = new Random(1729);
    const storage =
      sim.cars.length === 4
        ? recycledStorage
        : new Float32Array(HEADER + sim.cars.length * CAR_STRIDE + 8).fill(-987.25);
    const reused = storage.subarray(4, storage.length - 4);
    for (let sample = 0; sample < 3; sample++) {
      sim.setInput({
        ...sim.cars[0].input,
        throttle: random.next(),
        brake: random.next() * 0.2,
        steer: (random.next() - 0.5) * 0.1,
      });
      for (let tick = 0; tick < 8; tick++) sim.step(1 / 120);
      // Exercise rank changes without needing overtakes during these short samples.
      for (let i = sim.race.order.length - 1; i > 0; i--) {
        const j = Math.floor(random.next() * (i + 1));
        [sim.race.order[i], sim.race.order[j]] = [sim.race.order[j], sim.race.order[i]];
      }
      const stepMs = random.next() * 9;
      const dropped = sample % 3;
      const reference = referenceWorldSnapshot(
        sim, new Float32Array(reused.length), stepMs, dropped,
      );
      expect(sim.writeFrame(reused, stepMs, dropped)).toBe(reused);
      expect(bytes(reused)).toEqual(bytes(reference));
      expect([...storage.subarray(0, 4), ...storage.subarray(storage.length - 4)]).toEqual(
        Array(8).fill(-987.25),
      );
    }
  });

  it('retains first-occurrence ranks and resets absent ranks on each reused frame', () => {
    const sim = session();
    const reused = sim.makeFrame();
    const sparse: number[] = [];
    sparse.length = 5;
    sparse[2] = 3;
    sparse[4] = 0;
    const orders = [
      [3, 2, 1, 0],
      [2, 0],
      [2, 0, 2, 3, 3],
      [],
      [NaN, -1, 12, 0.5, Infinity, 1, -0, 1],
      sparse,
      [0, 1, 2, 3],
    ];
    for (const order of orders) {
      // Preserve holes as well as the array identity used by the director.
      sim.race.order.length = 0;
      sim.race.order.length = order.length;
      order.forEach((id, index) => {
        sim.race.order[index] = id;
      });
      const reference = referenceWorldSnapshot(sim, new Float32Array(reused.length));
      sim.writeFrame(reused);
      expect(bytes(reused)).toEqual(bytes(reference));
      for (let id = 0; id < sim.cars.length; id++) {
        expect(reused[carBase(id) + F.RANK]).toBe(order.indexOf(id) + 1);
      }
    }
  });

  it('retains every registry index and the unknown-id fallback', () => {
    for (const id of [...VEHICLE_IDS, '', '__proto__', 'constructor', 'APX01', 'unregistered']) {
      expect(vehicleIndex(id)).toBe(Math.max(0, VEHICLE_IDS.indexOf(id)));
    }
    for (const id of VEHICLE_IDS) expect(vehicleAt(vehicleIndex(id)).id).toBe(id);
  });
});

describe('snapshot lookup work', () => {
  it.each([1, 4, 12])('reads a %i-entrant order once per snapshot', (count) => {
    const sim = session({ opponents: count - 1 });
    const frame = sim.makeFrame();
    let reads = 0;
    Object.defineProperty(sim.race, 'order', {
      value: new Proxy(sim.race.order, {
        get(target, property, receiver) {
          if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) reads++;
          return Reflect.get(target, property, receiver);
        },
      }),
    });
    referenceWorldSnapshot(sim, frame);
    const referenceReads = reads;
    reads = 0;
    sim.writeFrame(frame);
    expect(referenceReads).toBe((count * (count + 1)) / 2);
    expect(reads).toBe(count);
  });

  it('does not rescan the frozen vehicle registry for each entrant', () => {
    const sim = session({ opponents: 11, vehicles: Array(12).fill(VEHICLE_IDS.at(-1)!) });
    const frame = sim.makeFrame();
    const nativeIndexOf = Array.prototype.indexOf;
    let scans = 0;
    let referenceScans = 0;
    let actualScans = 0;
    const spy = vi.spyOn(Array.prototype, 'indexOf').mockImplementation(function (
      this: readonly unknown[],
      value: unknown,
      fromIndex?: number,
    ) {
      if (this === VEHICLE_IDS) scans++;
      return nativeIndexOf.call(this, value, fromIndex);
    });
    try {
      referenceWorldSnapshot(sim, frame);
      referenceScans = scans;
      scans = 0;
      sim.writeFrame(frame);
      actualScans = scans;
    } finally {
      spy.mockRestore();
    }
    expect(referenceScans).toBe(12);
    expect(actualScans).toBe(0);
  });
});
