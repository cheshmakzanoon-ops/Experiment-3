import { describe, it, expect } from 'vitest';
import { FixedStepper, Quat, Random, Vec3 } from '../src/core/math.ts';
import { Track, trackPoint, surfaceSample } from '../src/simulation/track.ts';
import {
  DEFAULT_OPTIONS,
  DEFAULT_SETUP,
  validateOptions,
  validateSetup,
} from '../src/simulation/config.ts';
import { Simulation } from '../src/simulation/world.ts';
import { LapTracker, updatePit } from '../src/simulation/race.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { F, H, carBase } from '../src/simulation/protocol.ts';
describe('mathematical invariants', () => {
  it('rotates and inverse rotates without changing vector length', () => {
    const q = new Quat().yaw(0.77),
      v = new Vec3(1, 2, 3),
      a = new Vec3(),
      b = new Vec3();
    q.rotate(v, a);
    q.inverseRotate(a, b);
    expect(a.length()).toBeCloseTo(v.length(), 12);
    expect(b.x).toBeCloseTo(v.x, 12);
    expect(b.z).toBeCloseTo(v.z, 12);
  });
  it('keeps quaternion unit length after 100,000 integrations', () => {
    const q = new Quat(),
      w = new Vec3(0.01, 0.7, -0.03);
    for (let i = 0; i < 100000; i++) q.integrateWorld(w, 1 / 240);
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
  });
  it('seeds isolated PRNG streams deterministically', () => {
    const a = new Random(33),
      b = new Random(33);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it.each([24, 30, 60, 90, 120, 144])('executes the same 1200 ticks at %i display FPS', (fps) => {
    const clock = new FixedStepper();
    let x = 0;
    for (let i = 0; i < fps * 10; i++) clock.advance(1 / fps, (dt) => (x += dt));
    expect(clock.ticks).toBe(1200);
    expect(x).toBeCloseTo(10, 9);
    expect(clock.droppedSeconds).toBe(0);
  });
  it('bounds catch-up and exposes discarded wall-clock time', () => {
    const clock = new FixedStepper();
    clock.advance(2, () => {});
    expect(clock.ticks).toBe(24);
    expect(clock.droppedSeconds).toBeCloseTo(1.8);
    expect(() => clock.advance(NaN, () => {})).toThrow();
  });
});
describe('track and surface', () => {
  const track = new Track();
  it('closes the ribbon and supports negative distances', () => {
    const a = track.at(0, trackPoint()),
      b = track.at(track.length, trackPoint()),
      c = track.at(-10, trackPoint()),
      d = track.at(track.length - 10, trackPoint());
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(c.z).toBeCloseTo(d.z, 9);
    expect(track.length).toBeGreaterThan(2800);
    expect(track.length).toBeLessThan(3200);
  });
  it('projects known world-space positions back to distance and lateral offset', () => {
    for (let s = 10; s < track.length; s += 137) {
      const p = track.at(s, trackPoint()),
        q = trackPoint();
      const lateral = track.nearest(p.x + p.nx * 3, p.z + p.nz * 3, q);
      expect(Math.abs(lateral - 3)).toBeLessThan(0.025);
      expect(Math.abs(q.s - s)).toBeLessThan(0.4);
    }
  });
  it('uses distinct kerb, paint and grass properties', () => {
    const p = track.at(450, trackPoint()),
      sample = (l: number) => track.sample(p.x + p.nx * l, p.z + p.nz * l, surfaceSample());
    expect(sample(0).surface).toBe(0);
    expect(sample(p.width + 0.5).surface).toBe(2);
    expect(sample(p.width + 2).surface).toBe(1);
    expect([3, 4]).toContain(sample(p.width + 5).surface);
  });
  it('rain accumulation varies spatially, while tires remove local water', () => {
    const rain = new Track('rain');
    rain.evolve(1, 100);
    expect(rain.water[0]).not.toBe(rain.water[1]);
    const old = rain.water[10];
    rain.interact(10, 2000, 1000, 50, 1);
    expect(rain.water[10]).toBeLessThan(old);
  });
  it('clear-to-rain transition has no negative water', () => {
    const t = new Track('changeable');
    for (let i = 0; i < 400; i++) t.evolve(0.5, i * 0.5);
    expect(t.rain).toBeGreaterThan(30);
    expect(t.meanWater()).toBeGreaterThan(0.4);
    expect(Array.from(t.water).every((v) => v >= 0)).toBe(true);
  });
});
describe('validated persistence and messages', () => {
  it('clamps legitimate setup values but rejects non-finite data', () => {
    expect(validateSetup({ ...DEFAULT_SETUP, frontWing: 7 }).frontWing).toBe(1);
    expect(() => validateSetup({ frontWing: NaN })).toThrow();
    expect(() => validateSetup({ frontSpring: '100000' })).toThrow();
  });
  it('rejects inherited compound keys and caps the grid', () => {
    const o = validateOptions({ ...DEFAULT_OPTIONS, compound: 'toString', opponents: 999 });
    expect(o.compound).toBe('medium');
    expect(o.opponents).toBe(11);
  });
  it('rejects future settings versions and sanitizes mappings', () => {
    expect(() => validateSettings({ version: 42 })).toThrow();
    const s = validateSettings({
      ...DEFAULT_SETTINGS,
      mapping: { ...DEFAULT_SETTINGS.mapping, deadzone: 9, steerAxis: -4 },
      volume: -1,
    });
    expect(s.volume).toBe(0);
    expect(s.mapping.deadzone).toBe(0.35);
    expect(s.mapping.steerAxis).toBe(0);
  });
  it('does not admit NaN or unbounded controls to the simulation', () => {
    const s = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 });
    s.setInput({
      clutch: NaN,
      manualClutch: false,
      throttle: NaN,
      brake: Infinity,
      steer: 40,
      shift: NaN,
      ers: 1,
      pit: false,
      reverse: false,
    });
    expect(s.cars[0].input.throttle).toBe(0);
    expect(s.cars[0].input.steer).toBe(1);
  });
});
describe('race integrity', () => {
  it('requires every forward gate before counting another lap', () => {
    const lap = new LapTracker(1000, 900);
    let time = 0;
    for (let i = 901; i <= 2001; i++) {
      lap.update(i % 1000, (time += 0.01), false);
    }
    expect(lap.completed).toBe(1);
    expect(lap.best).toBeCloseTo(10, 2);
  });
  it('cannot farm laps by oscillating around the finish line', () => {
    const lap = new LapTracker(1000, 995);
    for (let i = 0; i < 100; i++) {
      lap.update(2, i, false);
      lap.update(998, i + 0.5, false);
    }
    expect(lap.completed).toBe(0);
  });
  it('does not count a teleport past missing sectors', () => {
    const lap = new LapTracker(1000, 995);
    lap.update(1, 0, false);
    lap.update(980, 1, false);
    lap.update(1, 2, false);
    expect(lap.completed).toBe(0);
  });
  it('invalidates off-track laps and counts one warning per excursion', () => {
    const lap = new LapTracker(1000, 900);
    for (let i = 0; i < 120; i++) lap.limits(true, 1 / 120);
    expect(lap.warnings).toBe(1);
    expect(lap.valid).toBe(false);
    for (let j = 0; j < 3; j++) {
      lap.limits(false, 0.1);
      lap.limits(true, 0.5);
    }
    expect(lap.penalty).toBe(5);
  });
  it('requires an actual stopped car in its service box', () => {
    const track = new Track(),
      car = new Vehicle(0);
    car.inPit = true;
    car.pitPhase = 1;
    car.s = 102;
    car.lateral = 24.1;
    car.speed = 8;
    car.nextCompound = 'wet';
    updatePit(car, track, 0.1);
    expect(car.pitPhase).toBe(1);
    car.speed = 0;
    for (let i = 0; i < 540; i++) updatePit(car, track, 0.01);
    expect(car.pitStops).toBe(1);
    expect(car.tires[0].compound).toBe('wet');
    expect(car.pitPhase).toBe(6);
  });
});
describe('bounded replay', () => {
  it('wraps its ring and interpolates only within available history', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0 }),
      replay = new ReplayRecorder(1, 2),
      frame = sim.makeFrame();
    for (let i = 0; i < 80; i++) {
      frame[H.TIME] = i * 0.1;
      frame[carBase(0) + F.X] = i;
      replay.append(frame);
    }
    expect(replay.count).toBe(30);
    const a = replay.makeFrame(),
      b = replay.makeFrame();
    expect(replay.sample(-99, a, b)).toBe(0);
    expect(a[carBase(0) + F.X]).toBe(50);
    replay.sample(99, a, b);
    expect(b[carBase(0) + F.X]).toBe(79);
  });
});
