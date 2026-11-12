import { describe, expect, it } from 'vitest';
import { BIKE, Bike, NOVICE, type BikeInput } from '../src/simulation/bike.ts';
import { controls, DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { PHASE } from '../src/simulation/race.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;
const input = (p: Partial<BikeInput> = {}): BikeInput => ({
  lean: 0,
  throttle: 0,
  frontBrake: 0,
  rearBrake: 0,
  rider: 0,
  ...p,
});

/** Hold a speed on the level start straight and a stick position for
 * `seconds`; production vehicle, terrain and controls only. */
function holdStick(speed: number, steer: number, seconds: number, ai: boolean) {
  const track = rigTrack('valley-ridge-mx'),
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
  bike.place(track, 20, 0);
  bike.dynamics.speed = speed;
  bike.gear = speed < 6 ? 1 : speed < 11 ? 2 : 3;
  Object.assign(bike.input, controls());
  const heading = bike.dynamics.heading;
  let wrongWay = 0;
  for (let i = 0; i < seconds / DT; i++) {
    if (ai) bike.aiControlled(2);
    bike.input.throttle = Math.max(0, Math.min(1, (speed - bike.dynamics.speed) * 0.5 + 0.15));
    bike.input.steer = steer;
    bike.step(DT, track);
    // Counter-steer into a lean is brief and small; a held wrong turn is not.
    wrongWay = Math.max(wrongWay, -(bike.dynamics.heading - heading) * Math.sign(steer));
  }
  return { bike, turned: (bike.dynamics.heading - heading) * Math.sign(steer), wrongWay };
}

describe('motocross low-speed balance', () => {
  for (const ai of [false, true])
    for (const speed of [2, 2.6, 3, 3.5, 4, 4.5, 5, 8, 14])
      it(`${ai ? 'AI' : 'player'} at ${speed} m/s turns and leans toward a held stick`, () => {
        for (const steer of [0.6, -1]) {
          const { bike, turned, wrongWay } = holdStick(speed, steer, 1.5, ai);
          expect(bike.riding).toBe(true);
          expect(turned).toBeGreaterThan(0.25);
          expect(bike.dynamics.lean * Math.sign(steer)).toBeGreaterThan(0.08);
          expect(wrongWay).toBeLessThan(0.2);
        }
      });

  it('holds a tight feet-up turn at walking pace without falling or running wide', () => {
    const { bike, turned } = holdStick(3, 1, 4, false);
    expect(bike.riding).toBe(true);
    // More than a half turn in four seconds: a hairpin is rideable at 3 m/s.
    expect(turned).toBeGreaterThan(Math.PI);
    expect(Math.abs(bike.dynamics.lean)).toBeLessThan(0.7);
  });

  it('is opt-in: the shared road core keeps its original walking-pace blend', () => {
    expect(BIKE.lowSpeedBalance).toBeUndefined();
    expect(BIKE.gripFallGrace).toBeUndefined();
    const plain = new Bike(NOVICE),
      explicit = new Bike(NOVICE, { ...BIKE, lowSpeedBalance: false, gripFallGrace: 0 });
    plain.speed = explicit.speed = 3;
    for (let i = 0; i < 2 / DT; i++) {
      plain.step(input({ lean: 0.6, throttle: 0.05 }), DT);
      explicit.step(input({ lean: 0.6, throttle: 0.05 }), DT);
    }
    expect(explicit.heading).toBe(plain.heading);
    expect(explicit.lean).toBe(plain.lean);
    expect(explicit.speed).toBe(plain.speed);
  });
});

describe('motocross grip-loss allowance', () => {
  /** Lean a bike into a steady corner, then take most of the front tyre's
   * grip away for `seconds` (a patch of sand under that wheel, as the
   * motocross adapter samples it) and give it back. */
  function patch(grace: number | undefined, seconds: number) {
    const bike = new Bike(NOVICE, { ...BIKE, gripFallGrace: grace });
    bike.speed = 22;
    for (let i = 0; i < 3 / DT; i++) bike.step(input({ lean: 1, throttle: 0.2 }), DT);
    expect(bike.state).toBe('riding');
    bike.frontGrip = 0.45;
    for (let i = 0; i < seconds / DT && bike.state === 'riding'; i++)
      bike.step(input({ lean: 1, throttle: 0.2 }), DT);
    const during = bike.state;
    bike.frontGrip = undefined;
    for (let i = 0; i < 1 / DT; i++) bike.step(input({ lean: 0, throttle: 0.2 }), DT);
    return { during, after: bike.state, bike };
  }

  it('without the allowance an overloaded front is an immediate lowside (unchanged)', () => {
    expect(patch(undefined, 0.1).during).toBe('lowside');
  });

  it('rides through a brief patch and recovers the allowance afterwards', () => {
    const run = patch(0.4, 0.1);
    expect(run.during).toBe('riding');
    expect(run.after).toBe('riding');
    expect(run.bike.gripOver).toBe(0);
  });

  it('still goes down when the overload is held', () => {
    expect(patch(0.4, 1.5).during).not.toBe('riding');
  });

  it('spends the allowance faster the further past the limit the tyre is', () => {
    const fallAfter = (grip: number) => {
      const bike = new Bike(NOVICE, { ...BIKE, gripFallGrace: 0.4 });
      bike.speed = 22;
      for (let i = 0; i < 3 / DT; i++) bike.step(input({ lean: 1, throttle: 0.2 }), DT);
      bike.frontGrip = grip;
      let t = 0;
      for (; t < 3 && bike.state === 'riding'; t += DT)
        bike.step(input({ lean: 1, throttle: 0.2 }), DT);
      return t;
    };
    const mild = fallAfter(0.55),
      gross = fallAfter(0.25);
    expect(gross).toBeLessThan(mild);
    expect(gross).toBeLessThan(0.15);
    expect(mild).toBeGreaterThan(0.15);
  });
});

describe('motocross ridden lap', () => {
  /** The course AI's inputs integrated by the player's own solver: the AI
   * mark is withheld from the machine, nothing else differs from a race. */
  function lap(circuit: 'valley-ridge-mx' | 'arena-nord-sx') {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      circuit,
      mode: 'race',
      weather: 'clear',
      ruleset: 'motocross-moto',
      laps: 2,
      opponents: 0,
      vehicles: ['mx450'],
      seed: 61007,
    });
    sim.autoPlayer = true;
    const bike = sim.cars[0] as DirtBikeVehicle;
    bike.aiControlled = () => {};
    let stalled = 0,
      longestStall = 0,
      t = 0;
    for (; t < 260 && sim.race.phase !== PHASE.FINISHED && sim.race.laps[0].completed < 2; t += 1 / 120) {
      sim.step(1 / 120);
      if (sim.race.phase !== PHASE.RACING) continue;
      stalled = bike.riding && bike.dynamics.speed < 1 ? stalled + 1 / 120 : 0;
      longestStall = Math.max(longestStall, stalled);
    }
    return { bike, completed: sim.race.laps[0].completed, longestStall, seconds: t };
  }

  for (const circuit of ['valley-ridge-mx', 'arena-nord-sx'] as const)
    it(`${circuit}: the player solver completes a flying lap without a fall or a stall`, () => {
      const run = lap(circuit);
      expect(run.completed).toBe(2);
      expect(run.bike.crashCauses).toEqual([]);
      expect(run.bike.dynamics.crashes).toBe(0);
      expect(run.longestStall).toBeLessThan(1);
    });
});
