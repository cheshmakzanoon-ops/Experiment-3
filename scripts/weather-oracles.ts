import { K as SKID, SKID_BASE } from '../src/simulation/protocol.ts';
import assert from 'node:assert/strict';
import { WeatherTimeline, weatherKeyframes, advanceWater } from '../src/simulation/weather.ts';
import { Track, surfaceSample } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DEFAULT_OPTIONS, VEHICLE } from '../src/simulation/config.ts';
import { CAR_STRIDE, HEADER, H, F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { CHANNELS, TELEMETRY_STRIDE, packTelemetry } from '../src/storage/telemetry-schema.ts';
import { Effects, PARTICLE_KIND as K } from '../src/rendering/effects.ts';

function near(a: number, b: number, tolerance = 1e-9) {
  assert(Math.abs(a - b) <= tolerance, `${a} differs from ${b} by more than ${tolerance}`);
}
const state = () => ({ cloud: 0, rain: 0, ambient: 0, windX: 0, windZ: 0 });
const conditions = () => [
  { timeSec: 0, cloudCover01: 0, rainRateMmHr: 0, ambientTempC: 30, windSpeedMS: 4, windDirection: -Math.PI / 18 },
  { timeSec: 10, cloudCover01: 1, rainRateMmHr: 20, ambientTempC: 10, windSpeedMS: 4, windDirection: Math.PI / 18 },
];
function snapshot() {
  const frame = new Float32Array(HEADER + CAR_STRIDE); frame[H.CARS] = 1;
  frame[carBase(0) + F.QW] = 1; frame[carBase(0) + F.SPEED] = 30;
  return frame;
}
function dispose(effects: Effects) {
  effects.group.traverse((object) => {
    const mesh = object as { geometry?: { dispose(): void }; material?: { dispose(): void } };
    mesh.geometry?.dispose(); mesh.material?.dispose();
  });
}
/** Shared executable oracles: Vitest and the native Node entry run these same
 * production paths, not a parallel imitation of the simulator. */
export const weatherOracles: Record<string, () => void> = {
  'validates immutable weather input and rejects ambiguous ordering': () => {
    const input = conditions(), timeline = new WeatherTimeline(input);
    input[0].rainRateMmHr = 99;
    near(timeline.sample(0, state()).rain, 0);
    assert(Object.isFrozen(timeline.keyframes) && Object.isFrozen(timeline.keyframes[0]));
    for (const bad of [[], [conditions()[1]], [conditions()[0], conditions()[0]],
      [{ ...conditions()[0], ambientTempC: NaN }], [{ ...conditions()[0], windSpeedMS: -1 }],
      [{ ...conditions()[0], rainRateMmHr: 101 }]]) assert.throws(() => new WeatherTimeline(bad));
    const out = state(); assert.throws(() => timeline.sample(Infinity, out)); assert.deepEqual(out, state());
  },
  'samples endpoints, short-arc wind and seekable bounded interpolation': () => {
    const t = new WeatherTimeline(conditions()), out = state();
    assert.equal(t.sample(5, out), out); near(out.rain, 10); near(out.cloud, 0.5);
    near(out.ambient, 20); near(out.windX, 0); near(out.windZ, 4);
    const midpoint = { ...out }; t.sample(1000, out); near(out.rain, 20);
    t.sample(-2, out); near(out.rain, 0); t.sample(5, out); assert.deepEqual(out, midpoint);
    for (let time = -1; time < 12; time += 0.01) {
      t.sample(time, out); assert(out.rain >= 0 && out.rain <= 20);
      near(Math.hypot(out.windX, out.windZ), 4);
    }
  },
  'preserves static presets and supplies a storm which actually retreats': () => {
    for (const preset of ['clear', 'rain'] as const) {
      const timeline = new WeatherTimeline(weatherKeyframes(preset));
      assert.deepEqual(timeline.sample(0, state()), timeline.sample(100000, state()));
    }
    const timeline = new WeatherTimeline(weatherKeyframes('changeable'));
    assert.equal(timeline.sample(0, state()).rain, 0);
    assert.equal(timeline.sample(180, state()).rain, 36);
    assert.equal(timeline.sample(900, state()).rain, 0);
    assert(timeline.sample(180, state()).windX !== timeline.sample(900, state()).windX);
  },
  'integrates drainage without negative water or timestep-induced instability': () => {
    let many = 1.2;
    for (let i = 0; i < 100; i++) many = advanceWater(many, 0.004, 0.003, 0.5);
    near(many, advanceWater(1.2, 0.004, 0.003, 50));
    near(advanceWater(1, 0, 0, 50), 1);
    assert.equal(advanceWater(0.001, -1, 0.002, 50), 0);
    assert.throws(() => advanceWater(1, 1, -1, 0.5));
  },
  'evolves spatial wetting, drainage, temperature and contact sampling': () => {
    const track = new Track('changeable');
    for (let t = 0.5; t <= 420; t += 0.5) track.evolve(0.5, t);
    const peak = track.meanWater(); assert(peak > 0.5);
    const range = Math.max(...track.water) - Math.min(...track.water); assert(range > 0.1);
    for (let t = 420.5; t <= 1800; t += 0.5) track.evolve(0.5, t);
    assert(track.meanWater() < peak * 0.3);
    assert(track.temperature.every((t) => Number.isFinite(t) && t >= 19 && t <= 38));
    const point = track.points[30], sample = surfaceSample();
    track.sample(point.x, point.z, sample); assert.equal(sample.water, track.water[sample.cell]);
    assert.throws(() => track.evolve(NaN, 1800));
  },
  'wind changes actual aerodynamic force rather than only particle direction': () => {
    const track = new Track('clear', true), car = new Vehicle(0);
    car.place(track, 200, 0); car.body.velocity.copy(car.forward).scale(50);
    for (const tire of car.tires) tire.omega = 50 / VEHICLE.wheelRadius;
    track.windX = car.forward.x * 15; track.windZ = car.forward.z * 15;
    car.step(1 / 240, track); const tailwindDrag = car.aero.drag;
    const headwindCar = new Vehicle(0); headwindCar.place(track, 200, 0);
    headwindCar.body.velocity.copy(headwindCar.forward).scale(50);
    for (const tire of headwindCar.tires) tire.omega = 50 / VEHICLE.wheelRadius;
    track.windX = -headwindCar.forward.x * 15; track.windZ = -headwindCar.forward.z * 15;
    headwindCar.step(1 / 240, track);
    assert(headwindCar.aero.drag > tailwindDrag * 2);
  },
  'serializes actual timeline wind into the snapshot and exported telemetry': () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice', weather: 'changeable' });
    sim.track.evolve(0.5, 180);
    const frame = new Float32Array(HEADER + CAR_STRIDE), telemetry = new Float32Array(TELEMETRY_STRIDE);
    sim.writeFrame(frame); packTelemetry(frame, telemetry, 0);
    near(frame[H.WIND_X], sim.track.windX, 1e-6); near(frame[H.WIND_Z], sim.track.windZ, 1e-6);
    assert.equal(telemetry[CHANNELS.indexOf('wind_x_mps')], frame[H.WIND_X]);
    assert.equal(telemetry[CHANNELS.indexOf('wind_z_mps')], frame[H.WIND_Z]);
  },
  'retains fractional light-rain emission across render rates and transports wind': () => {
    for (const hz of [24, 30, 60, 120, 144]) {
      const e = new Effects(), frame = snapshot(); frame[H.RAIN] = 0.25;
      frame[H.WIND_X] = 4; frame[H.WIND_Z] = -2;
      try {
        for (let i = 0; i < hz; i++) e.update(frame, 1 / hz);
        const d = e.diagnostics(); assert.equal(d.spawned[K.RAIN], 10);
        near(d.velocityX[K.RAIN], 4); near(d.velocityZ[K.RAIN], -2);
      } finally { dispose(e); }
    }
  },
  'airborne contact channels and clean braking cannot manufacture smoke or spray': () => {
    const e = new Effects(), frame = snapshot(), o = carBase(0);
    try {
      frame[o + F.BRAKE] = 1;
      for (let wheel = 0; wheel < 4; wheel++) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        frame[p + W.WATER] = 2; frame[p + W.SLIP_POWER] = 100000; frame[p + W.SLIP] = -1;
      }
      e.update(frame, 0.1); assert.equal(e.diagnostics().spawned.reduce((a, b) => a + b), 0);
      for (let wheel = 0; wheel < 4; wheel++) {
        const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
        frame[p + W.LOAD] = 2000; frame[p + W.WATER] = 0; frame[p + W.SLIP_POWER] = 0;
      }
      e.update(frame, 0.1); assert.equal(e.diagnostics().spawned[K.SMOKE], 0);
    } finally { dispose(e); }
  },
  'lateral slip work, actual water pickup and hard-contact work drive distinct emitters': () => {
    const e = new Effects(), frame = snapshot(), o = carBase(0), p = o + WHEEL_BASE;
    try {
      frame[p + W.LOAD] = 2000; frame[p + W.SLIP_POWER] = 57800;
      e.update(frame, 0.1); assert(e.diagnostics().spawned[K.SMOKE] > 0);
      frame[p + W.WATER] = 1; frame[o + F.COMPOUND] = 4;
      frame[o + F.BOTTOM_ENERGY] = 8300;
      frame[H.TIME] += 0.1;
      frame[o + SKID_BASE + SKID.SPARK_WORK] = 830;
      frame[o + SKID_BASE + SKID.NORMAL_Y] = 1;
      e.update(frame, 0.1); const d = e.diagnostics();
      assert(d.spawned[K.SPRAY] > 0); assert(d.spawned[K.SPARK] > 0);
      assert(d.active.reduce((a, b) => a + b) <= d.capacity);
      e.clear(); assert.equal(e.diagnostics().active.reduce((a, b) => a + b), 0);
      assert.throws(() => e.update(frame, NaN));
    } finally { dispose(e); }
  },
};
