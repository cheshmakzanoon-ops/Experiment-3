import { describe, expect, it } from 'vitest';
import { clamp, G } from '../src/core/math.ts';
import { InputLog, Resimulation } from '../src/core/flashback.ts';
import { controls, DEFAULT_OPTIONS, DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { RiderWeight } from '../src/simulation/offroad/rider-weight.ts';
import { writeOffroadBlock } from '../src/simulation/offroad/session.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { O, OFFROAD_STRIDE } from '../src/simulation/protocol.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;

/** Real surveyed take-off: initial rolling speed plus normal rider inputs,
 * then control ownership changes in the air. No flight state is fabricated. */
function launch(definition = MX_450, assist: Assist = 'raw', dt = DT, ai = false) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.aiControlled(1e6);
  for (let g = 1; g < definition.spec.gearRatios.length - 1; g++) {
    bike.gear = g;
    const rpm =
      ((speed / definition.spec.wheelRadius) *
        definition.spec.gearRatios[g + 1] *
        definition.spec.finalDrive *
        30) /
      Math.PI;
    if (rpm < definition.spec.shiftRPM * 0.85) break;
  }
  for (let t = 0; t < 6; t += dt) {
    if (!bike.airborne)
      rideLine(
        bike,
        track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed)
          : speed,
      );
    bike.step(dt, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      if (!ai) bike.aiControlled(0);
      Object.assign(bike.input, controls());
      return { bike, track };
    }
  }
  throw new Error('The surveyed take-off was not reached');
}

function fly(run: ReturnType<typeof launch>, seconds: number, lean: number, dt = DT) {
  run.bike.input.riderLean = lean;
  for (let n = 0; n < Math.round(seconds / dt); n++) run.bike.step(dt, run.track);
  return run.bike;
}

function observable(bike: DirtBikeVehicle) {
  const block = new Float32Array(OFFROAD_STRIDE);
  writeOffroadBlock(block, 0, bike, null);
  return {
    block,
    position: { ...bike.body.position },
    velocity: { ...bike.body.velocity },
    orientation: { ...bike.body.orientation },
    pitch: bike.pitch,
    rate: bike.pitchRate,
    frontSpin: bike.frontSpin,
    rearSpin: bike.rearSpin,
    landing: bike.lastLanding,
  };
}

describe('finite rider stroke', () => {
  it('bounds position/rate for rapid reversals, invalid samples and released controls', () => {
    const stroke = new RiderWeight();
    for (let n = 0; n < 2000; n++) {
      const previous = stroke.position;
      stroke.step(n % 53 < 21 ? 1 : -1, DT);
      expect(Math.abs(stroke.position)).toBeLessThanOrEqual(1);
      expect(Math.abs(stroke.velocity)).toBeLessThanOrEqual(12 / Math.E + 1e-12);
      expect(stroke.displacement).toBe(stroke.position - previous);
      for (const automatic of [-1, -0.5, 0, 0.5, 1])
        expect(Math.abs(stroke.pose(automatic))).toBeLessThanOrEqual(1);
    }
    for (let n = 0; n < 5 / DT; n++) stroke.step(n % 2 ? NaN : undefined, DT);
    expect(stroke.position).toBe(0);
    expect(stroke.velocity).toBe(0);
    expect(stroke.pose(-0)).toBe(-0);
    stroke.step(1, DT);
    stroke.reset();
    expect([stroke.position, stroke.velocity, stroke.displacement]).toEqual([0, 0, 0]);
  });

  it('gives the same stroke for the same timed command at 120, 240 and 480 Hz', () => {
    const sample = (hz: number) => {
      const stroke = new RiderWeight();
      for (const [target, seconds] of [
        [1, 0.4],
        [-1, 0.2],
        [0, 0.7],
      ])
        for (let n = 0; n < Math.round(seconds * hz); n++) stroke.step(target, 1 / hz);
      return stroke;
    };
    const reference = sample(480);
    for (const hz of [120, 240]) {
      const stroke = sample(hz);
      expect(stroke.position).toBeCloseTo(reference.position, 12);
      expect(stroke.velocity).toBeCloseTo(reference.velocity, 12);
    }
  });
});

describe('independent motocross rider weight', () => {
  it.each([MX_250, MX_450])(
    '%s shifts supported weight between the tyres without propulsion at rest',
    (definition) => {
      const track = rigTrack('valley-ridge-mx');
      const sample = (lean: number) => {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition);
        bike.place(track, 35);
        bike.input.riderLean = lean;
        for (let t = 0; t < 2; t += DT) bike.step(DT, track);
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(bike.dynamics.speed).toBe(0);
        expect(bike.s).toBe(35);
        expect(bike.forceFront + bike.forceRear).toBeCloseTo(bike.dynamics.mass * G, 0);
        return bike;
      };
      const neutral = sample(0),
        forward = sample(1),
        back = sample(-1);
      expect(forward.forceFront - neutral.forceFront).toBeGreaterThan(100);
      expect(neutral.forceFront - back.forceFront).toBeGreaterThan(100);
      expect(forward.compressionFront).toBeGreaterThan(neutral.compressionFront);
      expect(forward.compressionRear).toBeLessThan(neutral.compressionRear);
      expect(forward.pitch).toBeLessThan(neutral.pitch);
      expect(back.pitch).toBeGreaterThan(neutral.pitch);
    },
  );

  it.each([MX_250, MX_450])(
    '%s applies a finite air correction independent of trajectory and wheel rotation',
    (definition) => {
      const neutral = launch(definition),
        forward = launch(definition),
        back = launch(definition);
      const a = fly(neutral, 0.9, 0),
        b = fly(forward, 0.9, 1),
        c = fly(back, 0.9, -1);
      expect(a.airborne && b.airborne && c.airborne).toBe(true);
      expect(a.pitch - b.pitch).toBeGreaterThan(0.1);
      expect(a.pitch - b.pitch).toBeLessThan(0.13);
      expect(c.pitch - a.pitch).toBeCloseTo(a.pitch - b.pitch, 10);
      for (const bike of [b, c]) {
        expect(bike.dynamics.x).toBe(a.dynamics.x);
        expect(bike.dynamics.z).toBe(a.dynamics.z);
        expect(bike.cgY).toBe(a.cgY);
        expect(bike.vy).toBe(a.vy);
        expect(bike.frontSpin).toBe(a.frontSpin);
        expect(bike.rearSpin).toBe(a.rearSpin);
      }
      const block = new Float32Array(OFFROAD_STRIDE);
      writeOffroadBlock(block, 0, b, null);
      expect(block[O.BODY]).toBeCloseTo(b.riderBody, 6);
      expect(block[O.BODY]).toBeGreaterThan(0.95);
    },
  );

  it('returns an air stroke without a permanent torque or a wheel-speed correction', () => {
    const neutral = launch(),
      release = launch();
    fly(neutral, 0.9, 0);
    fly(release, 0.2, 1);
    expect(release.bike.riderBody).toBeGreaterThan(0.3);
    fly(release, 0.7, 0);
    const a = neutral.bike,
      b = release.bike;
    expect(a.airborne && b.airborne).toBe(true);
    expect(Math.abs(b.riderBody)).toBeLessThan(0.07);
    expect(Math.abs(b.pitch - a.pitch)).toBeLessThan(0.01);
    expect(Math.abs(b.pitchRate - a.pitchRate)).toBeLessThan(0.04);
    expect(b.cgY).toBe(a.cgY);
    expect(b.frontSpin).toBe(a.frontSpin);
    expect(b.rearSpin).toBe(a.rearSpin);
  });

  it.each(['sport', 'raw'] as const)(
    'settles a deliberate full body stroke on both MX bikes (%s)',
    (assist) => {
      for (const definition of [MX_250, MX_450]) {
        const run = launch(definition, assist),
          bike = run.bike;
        bike.input.riderLean = 1;
        while (bike.airborne && bike.airTime < 3) bike.step(DT, run.track);
        const landing = bike.lastLanding;
        expect(landing?.airTime).toBeGreaterThan(0.8);
        for (let t = 0; t < 0.3; t += DT) bike.step(DT, run.track);
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(bike.dynamics.crashes).toBe(0);
        expect(landing?.outcome).toBe('clean');
      }
    },
  );

  it('is unchanged for absent/neutral input, AI and the supermoto adapter', () => {
    for (const [definition, ai] of [
      [MX_450, false],
      [MX_450, true],
      [SM_450, false],
    ] as const) {
      const a = launch(definition, 'raw', DT, ai),
        b = launch(definition, 'raw', DT, ai);
      delete a.bike.input.riderLean;
      b.bike.input.riderLean = ai || definition === SM_450 ? 1 : 0;
      for (let n = 0; n < 1.4 / DT; n++) {
        a.bike.step(DT, a.track);
        b.bike.step(DT, b.track);
      }
      expect(observable(a.bike)).toEqual(observable(b.bike));
    }
  });

  it('clears an active stroke and its rate when a bike is placed for recovery', () => {
    const active = launch(),
      neutral = launch();
    fly(active, 0.3, 1);
    fly(neutral, 0.3, 0);
    active.bike.place(active.track, 35);
    neutral.bike.place(neutral.track, 35);
    Object.assign(active.bike.input, controls());
    Object.assign(neutral.bike.input, controls());
    expect(active.bike.riderBody).toBe(neutral.bike.riderBody);
    expect(active.bike.pitchRate).toBe(0);
    for (let n = 0; n < 0.5 / DT; n++) {
      active.bike.step(DT, active.track);
      neutral.bike.step(DT, neutral.track);
    }
    expect(active.bike.riderBody).toBe(neutral.bike.riderBody);
    expect(active.bike.pitch).toBe(neutral.bike.pitch);
  });

  it('recentres a player stroke on AI takeover even if the old body input stays held', () => {
    const stale = launch(),
      released = launch();
    fly(stale, 0.2, 1);
    fly(released, 0.2, 1);
    stale.bike.aiControlled(1e6);
    released.bike.aiControlled(1e6);
    released.bike.input.riderLean = 0;
    for (let n = 0; n < 1 / DT; n++) {
      stale.bike.step(DT, stale.track);
      released.bike.step(DT, released.track);
    }
    expect(observable(stale.bike)).toEqual(observable(released.bike));
    expect(stale.bike.dynamics.crashes).toBe(0);
  });

  it('converges through an actual body-controlled landing when the substep is halved', () => {
    const sample = (definition: VehicleDefinition, dt: number) => {
      const run = launch(definition, 'raw', dt),
        bike = run.bike;
      while (bike.airborne && bike.airTime < 3) {
        bike.input.riderLean = 1;
        bike.step(dt, run.track);
      }
      for (let n = 0; n < Math.round(0.3 / dt); n++) bike.step(dt, run.track);
      expect(bike.dynamics.crashes).toBe(0);
      return bike;
    };
    for (const definition of [MX_250, MX_450]) {
      const a = sample(definition, 1 / 240),
        b = sample(definition, 1 / 480);
      expect(Math.abs(a.lastLanding!.s - b.lastLanding!.s)).toBeLessThan(0.15);
      expect(Math.abs(a.lastLanding!.pitchError - b.lastLanding!.pitchError)).toBeLessThan(0.04);
      expect(Math.abs(a.dynamics.speed - b.dynamics.speed)).toBeLessThan(0.15);
      expect(a.lastLanding!.outcome).toBe(b.lastLanding!.outcome);
    }
  });

  it('reconstructs and resumes an active rider stroke from the real gate via the input journal', () => {
    const options = {
      ...DEFAULT_OPTIONS,
      circuit: 'valley-ridge-mx' as const,
      ruleset: 'motocross-moto' as const,
      mode: 'race' as const,
      opponents: 0,
      laps: 1,
      seed: 78312,
      vehicles: ['mx450'],
    };
    const sim = new Simulation(options),
      bike = sim.cars[0] as DirtBikeVehicle,
      log = new InputLog();
    sim.autoPlayer = true;
    log.autopilot(0, true);
    let manual = false,
      manualAt = 0,
      rewindTick = 0,
      touchdownTick = 0,
      savedFrame: Float32Array | null = null;
    for (let n = 0; n < 40 * 120; n++) {
      if (!manual && bike.airborne && bike.airTime > 0.2 && bike.lastTakeoff > 6.5) {
        manual = true;
        manualAt = sim.tick;
        sim.autoPlayer = false;
        log.autopilot(sim.tick, false);
      }
      if (manual) {
        const wanted =
          (bike.landingTarget + 0.1 - bike.pitch) / Math.max(0.12, bike.landingIn) - bike.pitchRate;
        const input = {
          ...controls(),
          throttle: bike.airborne ? clamp(wanted, 0, 1) : 0,
          clutch: bike.airborne ? clamp(-wanted, 0, 1) : 0,
          riderLean: sim.tick - manualAt < 42 ? 1 : 0,
        };
        sim.setInput(input);
        log.input(sim.tick, input);
      }
      const wasFlying = bike.airborne;
      sim.step(1 / 120);
      // The terrain-derived pitch aid may initially counter part of the
      // body pose. Capture the active stroke once that transient clears,
      // while the player still holds it, instead of tying it to one frame.
      if (
        manual &&
        !rewindTick &&
        sim.tick - manualAt >= 24 &&
        bike.input.riderLean === 1 &&
        bike.riderBody > 0.1
      ) {
        rewindTick = sim.tick;
        savedFrame = sim.makeFrame();
        expect(bike.riderBody).toBeGreaterThan(0.1);
      }
      if (manual && wasFlying && !bike.airborne) touchdownTick = sim.tick;
      if (touchdownTick && sim.tick >= touchdownTick + 36) break;
    }
    expect(manual && rewindTick > 0 && touchdownTick > 0).toBe(true);
    expect(bike.dynamics.crashes).toBe(0);
    const rewind = new Resimulation(options, log.entries, rewindTick);
    while (!rewind.run()) void 0;
    expect(rewind.simulation.makeFrame()).toEqual(savedFrame);
    // Continue that restored simulation through the remaining actual logged
    // input edges, including release, touchdown and suspension settlement.
    const resumed = rewind.simulation;
    let index = log.entries.findIndex((entry) => entry.tick >= rewindTick);
    while (resumed.tick < sim.tick) {
      while (index >= 0 && index < log.entries.length && log.entries[index].tick <= resumed.tick) {
        const entry = log.entries[index++];
        if (entry.kind === 'input') resumed.setInput(entry.input);
        else if (entry.kind === 'autopilot') resumed.autoPlayer = entry.value;
      }
      resumed.step(1 / 120);
    }
    expect(resumed.makeFrame()).toEqual(sim.makeFrame());
    expect(observable(resumed.cars[0] as DirtBikeVehicle)).toEqual(observable(bike));
  });
});
