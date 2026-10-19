import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { Bike, EXPERT, NOVICE, type BikeInput } from '../src/simulation/bike.ts';
import { TRACTION_MAPS } from '../src/simulation/bike-definitions.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  B,
  BIKE_BASE,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';
import {
  SessionReplay,
  type ReplayPage,
  type ReplayPageStore,
} from '../src/storage/replay-pages.ts';
import { gpControlFeedback } from '../src/ui/gp-control-feedback.ts';

const DT = 1 / 240;
const control: BikeInput = {
  lean: 0,
  rider: 0,
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  drive: 0,
};
const parameters = Object.fromEntries(
  ['gpr1', 'gpr2'].map((id) => [
    id,
    new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]).dynamics.p,
  ]),
);

/** Controlled contact coefficients isolate front/rear load-transfer coupling.
 * Adapter sampling, actual torque and recorded channels are checked below. */
function corner(
  id: string,
  front: number,
  rear: number,
  lean: number,
  map = 3,
  dt = DT,
  current = true,
) {
  const bike = new Bike(NOVICE, {
    ...parameters[id],
    tractionMargin: TRACTION_MAPS[map],
    currentDriveTraction: current,
  });
  bike.speed = 35;
  bike.grip = Math.min(front, rear);
  bike.frontGrip = front;
  bike.rearGrip = rear;
  for (let i = 0; i < 3 / dt; i++)
    bike.step(
      {
        ...control,
        lean,
        rider: lean,
        drive: bike.p.drag * bike.speed ** 2 + (bike.p.rolling ?? 0) * bike.mass * G,
      },
      dt,
    );
  expect(bike.state).toBe('riding');
  return bike;
}

function rearUtilization(bike: Bike) {
  const camber = 1 - 0.18 * Math.max(0, Math.abs(bike.lean) - 0.8);
  const lateral =
    (bike.mass * Math.abs(bike.speed ** 2 * bike.curvature) * bike.p.cgToFront) / bike.p.wheelbase;
  return (
    Math.hypot(lateral, bike.driveForce - bike.rearBrakeForce) /
    (bike.p.mu * (bike.rearGrip ?? bike.grip) * camber * bike.rearLoad)
  );
}

class Pages implements ReplayPageStore {
  pages = new Map<number, ReplayPage>();
  async put(page: ReplayPage) {
    this.pages.set(page.id, structuredClone(page));
  }
  async get(id: number) {
    return structuredClone(this.pages.get(id)!);
  }
  async dispose() {
    this.pages.clear();
  }
}

describe('GP traction uses the current front-brake load transfer', () => {
  it.each(['gpr1', 'gpr2'])(
    '%s removes the split-grip overlap spike and records the actual extra torque cut',
    (id) => {
      const bike = corner(id, 1, 0.35, 0.4);
      const precedingLoad = corner(id, 1, 0.35, 0.4, 3, DT, false);
      const input = {
        ...control,
        lean: 0.4,
        rider: 0.4,
        throttle: 1,
        drive: 6000,
        frontBrake: 0.3,
      };
      const entrySpeed = bike.speed;
      bike.step(input, DT);
      precedingLoad.step(input, DT);
      // The preceding-load path reports 1.3+ times the rear grip while its TC
      // claims to be active. No crash is claimed for this short straight/turn.
      expect(precedingLoad.rearUse).toBeGreaterThan(1.3);
      expect(bike.rearUse).toBeLessThanOrEqual(1);
      expect(bike.rearUse).toBeCloseTo(rearUtilization(bike), 4);
      expect(bike.frontUse).toBeLessThanOrEqual(1);
      expect(bike.frontBrakeForce).toBe(precedingLoad.frontBrakeForce);
      expect(bike.driveForce).toBeLessThan(precedingLoad.driveForce - 150);
      expect(bike.driveForce).toBeGreaterThan(50);
      expect(bike.intervention).toBeGreaterThan(precedingLoad.intervention);
      // Sport's front lever also requests 30% of its input at the rear. TC
      // trims engine torque; that brake request still opposes delivered drive.
      const rearServiceRequest = bike.p.rearBrake * input.frontBrake * 0.3;
      expect(bike.intervention).toBeCloseTo(
        1 - (bike.driveForce + rearServiceRequest) / input.drive,
        12,
      );
      expect(bike.speed).toBeCloseTo(entrySpeed + bike.longitudinal * DT, 12);
      expect(bike.rearSlip).toBe(0);
      expect(bike.state).toBe('riding');
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s respects both circles throughout split-contact brake/throttle transitions across TC settings',
    (id) => {
      for (const [front, rear] of [
        [1, 0.35],
        [1, 0.65],
        [0.65, 0.4],
        [0.35, 1],
      ]) {
        for (const map of [1, 3, 6])
          for (const lean of [0, 0.4, 0.8])
            for (const dt of [1 / 120, 1 / 240]) {
              const bike = corner(id, front, rear, lean, map, dt);
              for (let i = 0; i < 0.4 / dt; i++) {
                const speed = bike.speed;
                bike.step(
                  { ...control, lean, rider: lean, throttle: 1, drive: 6000, frontBrake: 0.3 },
                  dt,
                );
                expect(bike.state).toBe('riding');
                expect(bike.frontUse).toBeLessThanOrEqual(1.001);
                expect(bike.rearUse).toBeLessThanOrEqual(1.001);
                expect(bike.rearUse).toBeCloseTo(rearUtilization(bike), 3);
                expect(bike.rearSlip).toBe(0);
                expect(bike.speed).toBeCloseTo(speed + bike.longitudinal * dt, 10);
                expect(bike.frontLoad + bike.rearLoad).toBeCloseTo(
                  bike.mass * G + (bike.p.downforce ?? 0) * speed ** 2,
                  8,
                );
              }
            }
      }
    },
  );

  it.each(['gpr1', 'gpr2'])(
    '%s releases the lever and progressively drives out on the same low-grip rear tyre',
    (id) => {
      const bike = corner(id, 1, 0.35, 0.5);
      for (let i = 0; i < 0.5 / DT; i++)
        bike.step(
          { ...control, lean: 0.5, rider: 0.5, throttle: 0.6, drive: 3600, frontBrake: 0.3 },
          DT,
        );
      const exitSpeed = bike.speed;
      let peakUse = 0;
      for (let i = 0; i < 2 / DT; i++) {
        const progress = (i * DT) / 2;
        bike.step(
          {
            ...control,
            lean: 0.5 * (1 - progress),
            rider: 0.5 * (1 - progress),
            throttle: 0.6 + 0.4 * progress,
            drive: 3600 + 2400 * progress,
          },
          DT,
        );
        peakUse = Math.max(peakUse, bike.frontUse, bike.rearUse);
        expect(bike.state).toBe('riding');
        expect(bike.rearSlip).toBe(0);
      }
      expect(peakUse).toBeLessThanOrEqual(1.001);
      expect(bike.speed).toBeGreaterThan(exitSpeed + 3);
      expect(bike.driveForce).toBeGreaterThan(500);
      expect(Math.abs(bike.lean)).toBeLessThan(0.1);
    },
  );

  it('preserves Raw demand, slip risk, and every existing non-GP aid configuration', () => {
    for (const id of ['gpr1', 'gpr2']) {
      const aids = { ...EXPERT, lean: true };
      const current = new Bike(aids, parameters[id]);
      const previous = new Bike(aids, { ...parameters[id], currentDriveTraction: false });
      for (const bike of [current, previous]) {
        bike.speed = 35;
        bike.grip = bike.rearGrip = 0.35;
        bike.frontGrip = 1;
      }
      let peakSlip = 0;
      for (let i = 0; i < 120; i++) {
        const input = {
          ...control,
          lean: 0.2,
          rider: 0.2,
          throttle: 1,
          drive: 6000,
          frontBrake: 0.3,
        };
        current.step(input, DT);
        previous.step(input, DT);
        peakSlip = Math.max(peakSlip, current.rearSlip);
        expect({ ...current, p: null }).toEqual({ ...previous, p: null });
        expect(current.intervention).toBe(0);
      }
      expect(peakSlip).toBeGreaterThan(1);
    }
    for (const id of ['sbk1000', 'ss600', 'nr900', 'cr750', 'mx450', 'mx250', 'sm450']) {
      const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
      expect(bike.dynamics.p.currentDriveTraction).toBeUndefined();
    }
  });

  it('publishes real adapter forces and corrected aid feedback through full-session replay and backward seeks', async () => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    sim.race.time = sim.race.greenAt + 1;
    sim.step(1 / 120);
    const bike = sim.cars[0] as BikeVehicle;
    bike.place(sim.track, 120);
    const d = bike.dynamics;
    d.speed = 35;
    d.lean = 0.4;
    d.riderOffset = 0.1;
    d.steer = Math.atan(
      (d.p.wheelbase * G * (Math.tan(d.lean) + d.riderGain())) / (d.speed ** 2 * Math.cos(d.lean)),
    );
    bike.gear = 3;
    bike.rpm = 12000;
    bike.autoShift = false;
    sim.setInput({ ...bike.input, throttle: 1, brake: 0.3, steer: 0.8, clutch: 0 });
    const replay = new SessionReplay(1, new Pages(), undefined, 4);
    const frames: Float32Array[] = [];
    const o = carBase(0),
      b = o + BIKE_BASE,
      rear = o + WHEEL_BASE + 2 * WHEEL_STRIDE;
    try {
      for (let i = 0; i < 32; i++) {
        // Controlled, differently gripped contacts; each production step
        // still computes tyre condition, torque, aids and thermal work.
        bike.contacts[0].grip = bike.contacts[1].grip = 1;
        bike.contacts[2].grip = bike.contacts[3].grip = 0.65;
        if (i === 16) sim.setInput({ ...bike.input, throttle: 0, brake: 0, steer: 0.8, clutch: 0 });
        sim.step(1 / 120);
        expect(d.state).toBe('riding');
        expect(d.rearUse).toBeLessThanOrEqual(1.001);
        expect(bike.tires[2].fx).toBe(d.driveForce - d.rearBrakeForce);
        if (i % 8 === 0) {
          const frame = sim.makeFrame();
          expect(frame[b + B.INTERVENTION]).toBe(Math.fround(d.intervention));
          expect(frame[rear + W.FX]).toBe(Math.fround(bike.tires[2].fx));
          frames.push(frame);
          replay.append(frame);
        }
      }
      expect(gpControlFeedback(frames[0])?.action).toBe('POWER LIMITED');
      expect(gpControlFeedback(frames[2])).toBeNull();
      await replay.settle();
      const a = replay.makeFrame(),
        next = replay.makeFrame();
      for (const index of [0, 2, 0]) {
        const time = frames[index][H.TIME] - frames[0][H.TIME];
        for (let attempt = 0; attempt < 3 && replay.sample(time, a, next) === null; attempt++)
          await replay.settle();
        expect(replay.sample(time, a, next)).not.toBeNull();
        expect(a).toEqual(frames[index]);
        expect(gpControlFeedback(a)).toEqual(gpControlFeedback(frames[index]));
      }
    } finally {
      await replay.dispose();
    }
  });
});
