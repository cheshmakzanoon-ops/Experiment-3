import { describe, expect, it } from 'vitest';
import { TAU, Vec3 } from '../src/core/math.ts';
import { wheelPhase } from '../src/rendering/wheel-pose.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  M,
  PROTOCOL_VERSION,
  W,
  WHEEL_BASE,
  WHEEL_MOTION_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { advanceWheelRotation } from '../src/simulation/wheel-rotation.ts';
import { Simulation } from '../src/simulation/world.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';

const car = carBase(0),
  motion = car + WHEEL_MOTION_BASE,
  DT = 1 / 240;

class Pages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    const page = this.pages.get(id);
    if (!page) throw new Error('Missing recorded page');
    return structuredClone(page);
  }
  async dispose() {
    this.pages.clear();
  }
}

async function recordedWinding() {
  const store = new Pages(),
    replay = new SessionReplay(1, store, undefined, 2),
    originals: Float32Array[] = [];
  for (let i = 0; i < 24; i++) {
    const frame = new Float32Array(HEADER + CAR_STRIDE),
      total = 0.25 + i * (2 * TAU + 0.3),
      turns = Math.floor(total / TAU);
    frame[H.CARS] = 1;
    frame[H.TIME] = 5 + i / 15;
    frame[car + F.QW] = 1;
    frame[motion + M.VALID] = 15;
    for (let w = 0; w < 4; w++) {
      frame[motion + M.TURNS_FR + w] = 100 + turns;
      frame[car + WHEEL_BASE + w * WHEEL_STRIDE + W.ROTATION] = total - turns * TAU;
    }
    originals.push(frame.slice());
    replay.append(frame);
    if (i % 2 === 1) await replay.settle();
  }
  await replay.settle();
  return { store, replay, originals };
}

describe('production wheel winding and recording', () => {
  it.each([
    ['apx01', 'aurel'],
    ['gpr1', 'aurel'],
    ['mx450', 'valley-ridge-mx'],
  ] as const)(
    'records every physical %s wheel substep on %s without losing turns',
    (vehicle, circuit) => {
      const sim = new Simulation({
          ...DEFAULT_OPTIONS,
          mode: 'practice',
          opponents: 0,
          vehicles: [vehicle],
          circuit,
        }),
        entrant = sim.cars[0],
        integrated = [0, 0, 0, 0];
      entrant.body.orientation.rotate(new Vec3(0, 0, 30), entrant.body.velocity);
      if (entrant instanceof BikeVehicle) entrant.dynamics.speed = 30;
      entrant.input.throttle = 0.2;
      for (const tire of entrant.tires) {
        tire.omega = 30 / tire.radius;
        tire.rotation = 0;
        tire.turns = 100;
      }
      // Each public step is exactly one production substep. The independent
      // sum is taken from its resulting angular velocity before it is discarded
      // by the next step; endpoint-only reconstruction cannot pass this witness.
      for (let tick = 0; tick < 96; tick++) {
        entrant.step(DT, sim.track);
        for (let w = 0; w < 4; w++) integrated[w] += entrant.tires[w].omega * DT;
      }
      const frame = sim.makeFrame();
      expect(frame[motion + M.VALID]).toBe(15);
      expect(Math.max(...integrated.map(Math.abs))).toBeGreaterThan(TAU * 2);
      for (let w = 0; w < 4; w++) {
        const tire = entrant.tires[w],
          p = car + WHEEL_BASE + w * WHEEL_STRIDE;
        expect((tire.turns - 100) * TAU + tire.rotation).toBeCloseTo(integrated[w], 9);
        expect(frame[motion + M.TURNS_FR + w]).toBe(tire.turns);
        expect(frame[p + W.ROTATION]).toBe(Math.fround(tire.rotation));
        expect((frame[motion + M.TURNS_FR + w] - 100) * TAU + frame[p + W.ROTATION]).toBeCloseTo(
          integrated[w],
          5,
        );
      }
    },
    30000,
  );

  it('writes the same exact winding in festival snapshots without borrowing another wheel counter', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'rh3', traffic: false });
    for (let w = 0; w < 4; w++)
      advanceWheelRotation(sim.cars[0].tires[w], (w - 1) * 3 * TAU + 0.2 * (w + 1));
    const frame = sim.makeFrame();
    expect(frame[motion + M.VALID]).toBe(15);
    for (let w = 0; w < 4; w++) {
      const tire = sim.cars[0].tires[w];
      expect(frame[motion + M.TURNS_FR + w]).toBe(tire.turns);
      expect(frame[car + WHEEL_BASE + w * WHEEL_STRIDE + W.ROTATION]).toBe(
        Math.fround(tire.rotation),
      );
    }
  });

  it('reloads exact winding across evicted full-session replay page seams and reordered seeks', async () => {
    const { store, replay, originals } = await recordedWinding(),
      a = replay.makeFrame(),
      b = replay.makeFrame();
    try {
      expect(store.pages.get(0)!.version).toBe(PROTOCOL_VERSION);
      expect(replay.diagnostics().cached).not.toContain(0);
      for (const index of [1, 15, 3, 1]) {
        replay.prepareSeek((index + 0.5) / 15);
        await replay.settle();
        const alpha = replay.sample((index + 0.5) / 15, a, b);
        expect(alpha).not.toBeNull();
        expect(a).toEqual(originals[index]);
        expect(b).toEqual(originals[index + 1]);
        const phase = wheelPhase(a, b, car, car + WHEEL_BASE, alpha!);
        // Two complete revolutions in each interval remain present even with
        // zero endpoint omegas, through cache eviction and asynchronous seek.
        expect(phase - a[car + WHEEL_BASE + W.ROTATION]).toBeGreaterThan(TAU);
        expect(replay.error).toBeNull();
      }
    } finally {
      await replay.dispose();
    }
  });

  it('rejects a pre-winding replay page before exposing it to presentation', async () => {
    const { store, replay } = await recordedWinding();
    try {
      store.pages.get(0)!.version = 13;
      replay.prepareSeek(0);
      await replay.settle();
      expect(replay.error).toContain('Incompatible replay page');
      const a = replay.makeFrame().fill(-1),
        b = replay.makeFrame().fill(-2);
      expect(replay.sample(0, a, b)).toBeNull();
      expect(a.every((v) => v === -1)).toBe(true);
      expect(b.every((v) => v === -2)).toBe(true);
    } finally {
      await replay.dispose();
    }
  });
});
