import { describe, expect, it } from 'vitest';
import { DrivingCueDirector, validateDrivingAudio } from '../src/audio/driving-cues.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  carBase,
  snapshotIncompatibility,
} from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import {
  VEHICLES,
  VEHICLE_IDS,
  vehicleDefinition,
  vehicleIndex,
} from '../src/simulation/vehicles.ts';

const track = new Track('clear', true);
const o = carBase(0),
  vehicleSlot = o + RACE_BASE + R.VEHICLE;
const settings = validateDrivingAudio({
  enabled: true,
  brake: false,
  turns: false,
  trackLimits: false,
  wrongWay: false,
});

function frame(id = 'apx01', rpm = 12500, gear = 3) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    p = track.at(30, trackPoint());
  f[H.CARS] = 1;
  f[H.PHASE] = 2;
  f[H.TICK] = 1;
  f[o + F.S] = 30;
  f[o + F.SPEED] = 35;
  f[o + F.VX] = p.tx * 35;
  f[o + F.VZ] = p.tz * 35;
  f[o + F.RPM] = rpm;
  f[o + F.GEAR] = gear;
  f[o + F.THROTTLE] = 1;
  f[vehicleSlot] = vehicleIndex(id);
  return f;
}

function sample(f: Float32Array) {
  return new DrivingCueDirector(track).sample(f, true, 0, settings);
}

describe('driving cues follow the recorded powertrain', () => {
  it('warns the touring driver near its 8100 RPM limiter without modifying the snapshot', () => {
    const f = frame('tc1', 8090),
      before = f.slice();
    expect(snapshotIncompatibility(f, undefined, VEHICLE_IDS.length)).toBeNull();
    expect(sample(f)).toEqual({ kind: 'upshift', frequency: 1100, pan: 0, duration: 0.09 });
    expect(f).toEqual(before);
  });

  it('suppresses a GP motorcycle upshift in sixth but permits the same RPM in fifth', () => {
    const f = frame('gpr1', 18190, 6);
    expect(snapshotIncompatibility(f, undefined, VEHICLE_IDS.length)).toBeNull();
    expect(sample(f)).toBeNull();
    f[o + F.GEAR] = 5;
    expect(sample(f)?.kind).toBe('upshift');
  });

  it.each([3, 4, 5, 7, 8])(
    'respects an actual %i-speed gearbox at its final forward gear',
    (count) => {
      const vehicle = Object.values(VEHICLES).find((v) => v.spec.gearRatios.length - 2 === count)!;
      expect(vehicle).toBeDefined();
      const f = frame(vehicle.id, vehicle.spec.limiterRPM - 10, count);
      expect(sample(f)).toBeNull();
      f[o + F.GEAR] = count - 1;
      expect(sample(f)?.kind).toBe('upshift');
    },
  );

  it.each([
    [11800, 0, null],
    [11801, 0, 'upshift'],
    [4800, 0.5, null],
    [4799, 0.5, 'downshift'],
  ] as const)('preserves the Formula boundary at %i RPM and brake %s', (rpm, brake, kind) => {
    const f = frame('apx01', rpm);
    f[o + F.BRAKE] = brake;
    expect(sample(f)?.kind ?? null).toBe(kind);
  });

  it("places the upshift warning before each vehicle's own shift point", () => {
    for (const [id, below, above] of [
      ['tc1', 7000, 7500],
      ['gpr1', 16000, 17000],
    ] as const) {
      expect(sample(frame(id, below)), id).toBeNull();
      expect(sample(frame(id, above))?.kind, id).toBe('upshift');
    }
  });

  it('uses the existing downshift calibration for both low- and high-revving engines', () => {
    for (const [id, low, high] of [
      ['tc1', 2500, 4000],
      ['gpr1', 7000, 9000],
    ] as const) {
      const f = frame(id, high);
      f[o + F.BRAKE] = 0.5;
      expect(sample(f), id).toBeNull();
      f[o + F.RPM] = low;
      expect(sample(f), id).toEqual({
        kind: 'downshift',
        frequency: 440,
        pan: 0,
        duration: 0.09,
      });
      f[o + F.GEAR] = 1;
      expect(sample(f), id).toBeNull();
    }
  });

  it('never suggests a shift for a single-speed electric drive', () => {
    const vehicle = vehicleDefinition('eh3');
    expect(vehicle.powertrain).toBe('electric');
    expect(vehicle.spec.gearRatios.length - 2).toBe(1);
    const f = frame(vehicle.id, vehicle.spec.limiterRPM - 10, 1);
    expect(sample(f)).toBeNull();
    f[o + F.RPM] = vehicle.spec.idleRPM;
    f[o + F.BRAKE] = 1;
    expect(sample(f)).toBeNull();
  });
});

describe('driving cue frame compatibility and state', () => {
  it.each([o + F.CAUTION_SPEED + 1, vehicleSlot])(
    'keeps Formula cues for a %i-float legacy sample without a vehicle identity',
    (length) => {
      const f = frame().slice(0, length),
        before = f.slice();
      expect(sample(f)?.kind).toBe('upshift');
      expect(f).toEqual(before);
    },
  );

  it.each([0, 2, o + F.RETIRED + 1, o + F.CAUTION_SPEED])(
    'rejects a %i-float sample missing required chassis fields',
    (length) => {
      const director = new DrivingCueDirector(track),
        valid = frame('tc1', 8090);
      expect(director.sample(valid, true, 0, settings)?.kind).toBe('upshift');
      expect(director.sample(valid.slice(0, length), true, 0.1, settings)).toBeNull();
      expect(director.lastKind).toBeNull();
      expect(director.sample(valid, true, 0.11, settings)?.kind).toBe('upshift');
    },
  );

  it.each([
    ['non-finite identity', vehicleSlot, NaN],
    ['infinite identity', vehicleSlot, Infinity],
    ['negative identity', vehicleSlot, -1],
    ['fractional identity', vehicleSlot, 0.5],
    ['unknown identity', vehicleSlot, VEHICLE_IDS.length],
    ['non-finite gear', o + F.GEAR, NaN],
    ['fractional gear', o + F.GEAR, 2.5],
    ['gear above final ratio', o + F.GEAR, 7],
    ['gear below reverse', o + F.GEAR, -2],
    ['non-finite RPM', o + F.RPM, Infinity],
    ['non-finite car count', H.CARS, NaN],
    ['fractional car count', H.CARS, 1.5],
  ] as const)('rejects %s and resets the previous cooldown', (_name, index, value) => {
    const director = new DrivingCueDirector(track),
      valid = frame('tc1', 8090),
      invalid = valid.slice();
    expect(director.sample(valid, true, 0, settings)?.kind).toBe('upshift');
    invalid[index] = value;
    const before = invalid.slice();
    expect(director.sample(invalid, true, 0.1, settings)).toBeNull();
    expect(invalid).toEqual(before);
    expect(director.lastKind).toBeNull();
    expect(director.sample(valid, true, 0.11, settings)?.kind).toBe('upshift');
  });

  it('keeps gear cooldown, stale-tick suppression, and live-owner resets', () => {
    const director = new DrivingCueDirector(track),
      f = frame('tc1', 8090);
    expect(director.sample(f, true, 0, settings)?.kind).toBe('upshift');
    expect(director.sample(f, true, 0.1, settings)).toBeNull();
    f[H.TICK]++;
    expect(director.sample(f, true, 0.45, settings)?.kind).toBe('upshift');
    expect(director.sample(f, true, 0.8, settings)).toBeNull();
    expect(director.sample(f, true, 0.96, settings)).toBeNull();
    f[H.TICK]++;
    expect(director.sample(f, true, 1, settings)?.kind).toBe('upshift');
    expect(director.sample(f, false, 1.1, settings)).toBeNull();
    expect(director.sample(f, true, 1.11, settings)?.kind).toBe('upshift');
  });

  it('still gives caution braking priority over a touring upshift', () => {
    const f = frame('tc1', 8090);
    f[o + F.LOCAL_FLAG] = FLAG.YELLOW;
    f[o + F.CAUTION_SPEED] = 10;
    expect(
      new DrivingCueDirector(track).sample(f, true, 0, { ...settings, brake: true })?.kind,
    ).toBe('brake');
  });
});
