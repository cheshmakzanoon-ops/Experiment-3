import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeShells, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { sampleMxFootField } from '../src/rendering/offroad/mx-foot-pose.ts';
import {
  MX_BOOT_PEDAL, MX_BOOT_PEG, motocrossBootFrame,
} from '../src/rendering/offroad/motocross-rider-contact.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MxGearStroke, MX_GEAR_EVENT_MODULUS } from '../src/simulation/offroad/mx-gear-stroke.ts';
import {
  B, BIKE_BASE, CAR_STRIDE, F, H, MX_FOOT, MX_FOOT_TRAJECTORY as S, MX_POSTURE,
  O, OFFROAD_BASE, PROTOCOL_VERSION, R, RACE_BASE, WHEEL_CONTACT_BASE, WHEEL_CONTACT_SIZE,
  carBase, snapshotIncompatibility,
} from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { writeWheelContact } from '../src/simulation/wheel-contact-state.ts';
import { Simulation } from '../src/simulation/world.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';

beforeAll(() => {
  const context = new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 10 }) : () => undefined,
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
});
afterAll(() => vi.unstubAllGlobals());

const car = carBase(0), fields = [MX_FOOT.ANGLE, MX_FOOT.COVER, MX_FOOT.CLEAR] as const;
const positions = (stroke: MxGearStroke) => [stroke.angle, stroke.cover, stroke.clear];
const sample = (a: Float32Array, b: Float32Array, t: number) => fields.map(field => sampleMxFootField(a, b, car, field, t));
const fromFrame = (frame: Float32Array) => fields.map(field => frame[car + field]);

function fixture(id: 'mx250' | 'mx450' = 'mx250') {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, circuit: 'arena-nord-sx', vehicles: [id],
    opponents: 0, ruleset: 'motocross-moto', mode: 'practice' });
  const bike = sim.cars[0] as DirtBikeVehicle, base = sim.makeFrame(), sag = staticSag(VEHICLES[id]);
  base[car + F.X] = base[car + F.Y] = base[car + F.Z] = 0;
  base[car + F.QX] = base[car + F.QY] = base[car + F.QZ] = 0;
  base[car + F.QW] = 1;
  base[car + BIKE_BASE + B.FORK] = sag.fork;
  base[car + BIKE_BASE + B.SHOCK] = sag.shock;
  base[car + BIKE_BASE + B.REAR_BRAKE] = .75;
  base[car + OFFROAD_BASE + O.STANDING] = .24;
  const frame = (clock: number, raceTime = clock) => {
    bike.clock = clock;
    const out = base.slice();
    out[H.TIME] = raceTime;
    writeWheelContact(out, car, bike);
    return out;
  };
  return { bike, frame, stroke: bike.gearStroke };
}

function interrupt(
  source: ReturnType<typeof fixture>, first: number, next: number, at: number,
  interval: number, phase: number, origin = 0,
) {
  const { stroke, frame } = source, previous = new MxGearStroke();
  stroke.reset();
  stroke.engage(first, origin);
  previous.engage(first, origin);
  const leftTime = origin + at - phase * interval;
  let a = frame(leftTime, leftTime - origin);
  stroke.engage(next, origin + at);
  if (phase === 0) a = frame(leftTime, leftTime - origin);
  const b = frame(leftTime + interval, leftTime + interval - origin);
  const c = frame(leftTime + interval * 2, leftTime + interval * 2 - origin);
  return { a, b, c, leftTime, truth: (clock: number) => positions(
    (clock < origin + at ? previous : stroke).sample(clock)),
  };
}

describe('recorded motocross foot trajectory', () => {
  it('reconstructs every legal interruption phase from the accepted seed at 60 and 30 Hz', () => {
    const source = fixture(), display = new PresentedFrame();
    let maximumError = 0, checked = 0;
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    for (const hz of [60, 30]) for (const first of [-1, 1]) for (const next of [-1, 1]) {
      for (let millisecond = 60; millisecond < 260; millisecond++) for (const phase of [0, .2, .5, .9]) {
        const interval = 1 / hz, test = interrupt(source, first, next, millisecond / 1000, interval, phase);
        for (const [a, b, start] of [[test.a, test.b, test.leftTime],
          [test.b, test.c, test.leftTime + interval]] as const) {
          for (const alpha of [0, .1, .4, .7, 1]) {
            const shown = sample(a, b, alpha), truth = test.truth(start + alpha * interval);
            shown.forEach((value, channel) => {
              maximumError = Math.max(maximumError, Math.abs(value - truth[channel]));
              minimum[channel] = Math.min(minimum[channel], value);
              maximum[channel] = Math.max(maximum[channel], value);
            });
            expect(shown.every(Number.isFinite)).toBe(true);
            if (alpha === 0 || alpha === 1) expect(shown).toEqual(fromFrame(alpha === 0 ? a : b));
            checked++;
          }
        }
        // PresentedFrame publishes the identical values; it does not retain
        // a stale authoritative event age on a synthetic display snapshot.
        const shown = display.sample(test.a, test.b, .4);
        expect(fromFrame(shown)).toEqual(sample(test.a, test.b, .4).map(Math.fround));
        expect(shown[car + S.RECORDED]).toBe(0);
      }
    }
    expect(checked).toBe(64000);
    expect(maximumError).toBeLessThan(2e-5);
    minimum.forEach((value, channel) => expect(value).toBeGreaterThanOrEqual(channel === 0 ? -.24 : 0));
    maximum.forEach((value, channel) => expect(value).toBeLessThanOrEqual(channel === 0 ? .22 : 1));
    if (process.env.MX_FOOT_METRICS) console.info({ checked, maximumError });
  });

  it('keeps sub-frame event timing precise after long runs and independently of the race clock', () => {
    const source = fixture();
    let maximumError = 0, worst = '';
    for (const origin of [0, 3600, 86400, 1048576]) for (const hz of [60, 30]) {
      for (const phase of [0, .25, .75]) {
        const { a, b, leftTime, truth } = interrupt(source, -1, 1, .115, 1 / hz, phase, origin);
        // Header precision can be coarse or repeat after long races. The
        // trajectory itself uses the recorded adapter clock and relative age.
        a[H.TIME] = b[H.TIME] = origin;
        for (const alpha of [.1, .2, .4, .8]) {
          const expected = truth(leftTime + alpha / hz);
          sample(a, b, alpha).forEach((value, channel) => {
            const error = Math.abs(value - expected[channel]);
            if (error > maximumError) {
              maximumError = error;
              worst = JSON.stringify({ origin, hz, phase, alpha, channel, value, expected,
                a: Array.from(a.subarray(car + S.RECORDED, car + S.CLOCK_LO + 1)),
                b: Array.from(b.subarray(car + S.RECORDED, car + S.CLOCK_LO + 1)) });
            }
          });
        }
      }
    }
    expect(maximumError, worst).toBeLessThan(2e-5);
  });

  it('keeps complete endpoints through pause, seeks, reset, missed events and malformed optional data', () => {
    const source = fixture(), display = new PresentedFrame();
    const { a, b } = interrupt(source, -1, 1, .115, 1 / 60, .4);
    const expected = [.1, .4, .8].map(alpha => sample(a, b, alpha));
    for (let round = 0; round < 4; round++) {
      for (const index of [2, 0, 1]) {
        const alpha = [.1, .4, .8][index];
        expect(sample(a, b, alpha)).toEqual(expected[index]);
        expect(fromFrame(display.sample(a, b, alpha))).toEqual(expected[index].map(Math.fround));
      }
    }
    expect(sample(a, a, .4)).toEqual(fromFrame(a));
    expect(sample(a, b, NaN)).toEqual(fromFrame(a));
    expect(sample(a, b, -1)).toEqual(fromFrame(a));
    expect(sample(a, b, 2)).toEqual(fromFrame(b));
    expect(fromFrame(display.sample(a, b, 0))).toEqual(fromFrame(a));
    expect(fromFrame(display.sample(a, b, 1))).toEqual(fromFrame(b));
    const assertHold = (left: Float32Array, right: Float32Array) => {
      expect(sample(left, right, .25)).toEqual(fromFrame(left));
      expect(sample(left, right, .75)).toEqual(fromFrame(right));
    };
    const sameTime = b.slice();
    sameTime[car + S.CLOCK_HI] = a[car + S.CLOCK_HI];
    sameTime[car + S.CLOCK_LO] = a[car + S.CLOCK_LO];
    assertHold(a, sameTime);
    assertHold(b, a);
    const gap = b.slice();
    gap[car + S.CLOCK_HI] += 1;
    assertHold(a, gap);
    const missed = b.slice();
    missed[car + S.EVENT] += 1;
    assertHold(a, missed);
    source.stroke.reset();
    const beforeTwo = source.frame(0);
    source.stroke.engage(-1, .001);
    source.stroke.engage(1, .061);
    const afterTwo = source.frame(1 / 15);
    expect(afterTwo[car + S.EVENT] - beforeTwo[car + S.EVENT]).toBe(2);
    assertHold(beforeTwo, afterTwo);
    const changed = b.slice();
    changed[car + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
    assertHold(a, changed);
    source.stroke.reset();
    const reset = source.frame(source.bike.clock + 1 / 60);
    assertHold(b, reset);
    expect(fromFrame(reset)).toEqual([0, 0, 0]);
    source.stroke.engage(-1, source.bike.clock + .005);
    const active = source.frame(source.bike.clock + 1 / 60);
    for (const alpha of [.1, .5, .9]) {
      const time = reset[car + S.CLOCK_HI] + reset[car + S.CLOCK_LO] + alpha / 60;
      const truth = positions(source.stroke.sample(time));
      sample(reset, active, alpha).forEach((value, channel) => expect(value).toBeCloseTo(truth[channel], 5));
    }
    for (const [field, value] of [[S.RECORDED, 2], [S.EVENT, .5], [S.AGE, -1], [S.DIRECTION, 3],
      [S.ANGLE, NaN], [S.COVER, 1.5], [S.CLEAR, Infinity], [S.ANGLE_RATE, Infinity],
      [S.COVER_RATE, NaN], [S.CLEAR_RATE, -Infinity], [S.CLOCK_HI, NaN], [S.CLOCK_LO, Infinity]]) {
      const invalid = b.slice();
      invalid[car + field] = value;
      assertHold(a, invalid);
      const endpoint = display.sample(a, invalid, 1);
      expect(fromFrame(endpoint)).toEqual(fromFrame(b));
      expect(endpoint[car + S.RECORDED]).toBe(0);
    }
    const broken = b.slice();
    broken[car + MX_FOOT.ANGLE] = NaN;
    broken[car + MX_FOOT.COVER] = Infinity;
    broken[car + MX_FOOT.CLEAR] = -100;
    expect(sample(a, broken, .75)).toEqual([0, 0, 0]);
    expect(fromFrame(display.sample(broken, broken, 0))).toEqual([0, 0, 0]);
  });

  it('retains unmarked replay interpolation and disambiguates event-counter rollover', () => {
    const source = fixture(), { a, b } = interrupt(source, -1, 1, .115, 1 / 30, .4);
    const legacyA = a.slice(), legacyB = b.slice();
    legacyA.fill(0, car + S.RECORDED, car + S.CLOCK_LO + 1);
    legacyB.fill(0, car + S.RECORDED, car + S.CLOCK_LO + 1);
    for (const alpha of [0, .2, .7, 1]) expect(sample(legacyA, legacyB, alpha)).toEqual(
      fromFrame(legacyA).map((value, channel) => value + (fromFrame(legacyB)[channel] - value) * alpha),
    );
    const expected = sample(a, b, .6);
    a[car + S.EVENT] = MX_GEAR_EVENT_MODULUS - 1;
    b[car + S.EVENT] = 0;
    expect(sample(a, b, .6)).toEqual(expected);
    expect(PROTOCOL_VERSION).toBe(17);
    expect(CAR_STRIDE).toBe(331);
    expect(S.RECORDED).toBe(MX_POSTURE.BODY_RATE + 1);
    expect(S.CLOCK_LO).toBe(WHEEL_CONTACT_BASE + WHEEL_CONTACT_SIZE - 1);
    expect(snapshotIncompatibility(a)).toBeNull();
    expect(snapshotIncompatibility(b)).toBeNull();
  });

  it('preserves complete trajectory metadata through compact replay and clears it off the ridden MX adapter', () => {
    const source = fixture(), display = new PresentedFrame();
    source.stroke.engage(-1, 0);
    const a = source.frame(.1);
    source.stroke.engage(1, .115);
    const b = source.frame(.1 + 1 / 15), store = new ReplayRecorder(1, 2);
    store.append(a);
    store.append(b);
    const left = store.makeFrame(), right = store.makeFrame();
    const alpha = store.sample(store.duration * .4, left, right);
    for (const [original, replayed] of [[a, left], [b, right]])
      expect(Array.from(replayed.subarray(car + S.RECORDED, car + S.CLOCK_LO + 1)))
        .toEqual(Array.from(original.subarray(car + S.RECORDED, car + S.CLOCK_LO + 1)));
    expect(sample(left, right, alpha)).toEqual(sample(a, b, alpha));
    expect(fromFrame(display.sample(left, right, alpha))).toEqual(sample(a, b, alpha).map(Math.fround));
    source.bike.dynamics.state = 'remount';
    const inactive = source.frame(.2);
    expect(Array.from(inactive.subarray(car + S.RECORDED, car + S.CLOCK_LO + 1))).toEqual(Array(12).fill(0));
    expect(fromFrame(inactive)).toEqual([0, 0, 0]);
    for (const [vehicle, circuit] of [['sm450', 'arena-nord-sx'], ['gpr1', 'aurel']] as const) {
      const sim = new Simulation({ ...DEFAULT_OPTIONS, vehicles: [vehicle], circuit, opponents: 0, mode: 'practice' });
      const frame = sim.makeFrame();
      if (vehicle === 'sm450')
        expect(Array.from(frame.subarray(car + S.RECORDED, car + S.CLOCK_LO + 1))).toEqual(Array(12).fill(0));
      expect(sample(frame, frame, .5)).toEqual([0, 0, 0]);
    }
  });
});

/** Same three actual authored sleeve stations and vertical surface intervals
 * as motocross-interrupted-shift-contact.test.ts, with its unchanged 3 mm bound. */
function contact(root: T.Object3D) {
  const selector = root.getObjectByName('Motocross gear selector')!;
  const boot = root.getObjectByName('Motocross left boot')!;
  const toe = new T.Vector3(...MX_BOOT_PEDAL).sub(new T.Vector3(...MX_BOOT_PEG))
    .applyQuaternion(motocrossBootFrame(new T.Quaternion()));
  const sleeve = new T.Vector3(), origin = new T.Vector3(), axis = new T.Vector3(), ray = new T.Raycaster();
  const surface = (object: T.Object3D, up: number) => {
    ray.set(origin.copy(sleeve).addScaledVector(axis.set(0, up, 0), -.14), axis);
    return ray.intersectObject(object, true)[0]?.point.y;
  };
  return () => {
    root.updateMatrixWorld(true);
    let gap = Infinity;
    for (const x of [.014, .031, .043]) {
      selector.localToWorld(sleeve.set(x, toe.y + .072, toe.z + .016));
      const bottom = surface(boot, 1), top = surface(boot, -1);
      const low = surface(selector, 1)!, high = surface(selector, -1)!;
      expect(Number.isFinite(low) && Number.isFinite(high)).toBe(true);
      if (bottom !== undefined && top !== undefined) gap = Math.min(gap, Math.max(bottom - high, low - top));
    }
    return gap;
  };
}

const configurations = (['mx250', 'mx450'] as const)
  .flatMap(id => (['mid', 'high'] as const).map(detail => [id, detail] as const));

it.each(configurations)('%s/%s keeps the reconstructed boot clear at 60/30 Hz across event phases', async (id, detail) => {
  const source = fixture(id), display = new PresentedFrame(), materials = new BikeMaterials(0);
  const definition = VEHICLES[id], model = new DirtBikeModel(definition, 0, detail, materials, mudUniforms());
  const gap = contact(model.root);
  const pose: BikePoseValues = { ...staticSag(definition), steer: 0, frontRotation: 0, rearRotation: 0,
    chassisLean: 0, riderOffset: 0, tuck: 0, brake: 0, rearBrake: .75,
    discTemp: 0, compoundColour: 0xffffff, riding: true, standing: .24 };
  const measure = (channels: number[]) => {
    [pose.shiftAngle, pose.shiftCover, pose.shiftClear] = channels;
    model.pose(pose);
    return gap();
  };
  let minimum = Infinity, checked = 0, worst = '';
  const check = (a: Float32Array, b: Float32Array, alpha: number, label: string) => {
    const values = fromFrame(display.sample(a, b, alpha)), distance = measure(values);
    if (distance < minimum) { minimum = distance; worst = `${label}, alpha=${alpha}, values=${values}`; }
    checked++;
  };
  try {
    // Positive controls still touch both the top and sole of the boot.
    for (const [direction, at] of [[1, .045], [-1, .115]]) {
      source.stroke.reset();
      source.stroke.engage(direction, 0);
      const distance = measure(fromFrame(source.frame(at)));
      expect(distance).toBeGreaterThan(-.003);
      expect(distance).toBeLessThan(.006);
    }
    const regression: { hz: number; linear: number; reconstructed: number }[] = [];
    for (const [hz, alpha] of [[60, .4], [30, .2]]) {
      const { a, b } = interrupt(source, -1, 1, .115, 1 / hz, 0);
      const linear = fromFrame(a).map((value, channel) => value + (fromFrame(b)[channel] - value) * alpha);
      const linearGap = measure(linear), reconstructed = measure(sample(a, b, alpha));
      expect(linearGap).toBeLessThan(-.003);
      regression.push({ hz, linear: linearGap, reconstructed });
    }
    for (const hz of [60, 30]) for (const first of [-1, 1]) for (const next of [-1, 1]) {
      for (const at of [.060, .063, .115, .174, .220, .236]) for (const phase of [0, .35, .8]) {
        const test = interrupt(source, first, next, at, 1 / hz, phase);
        for (const alpha of [.2, .4, .7]) {
          check(test.a, test.b, alpha, `${hz} Hz, ${first}->${next}@${at}, phase=${phase}`);
          check(test.b, test.c, alpha, `${hz} Hz continuation, ${first}->${next}@${at}, phase=${phase}`);
        }
      }
    }
    // A real sequence of repeated directions and reversals spans snapshot
    // boundaries; each frame records only the most recent accepted event.
    const commands = [[-1, 0], [-1, .060], [1, .123], [-1, .238], [1, .298],
      [1, .529], [-1, .619], [1, .679], [-1, .853]];
    for (const hz of [60, 30]) {
      source.stroke.reset();
      let command = 0;
      const frame = (time: number) => {
        while (command < commands.length && commands[command][1] <= time) {
          source.stroke.engage(commands[command][0], commands[command][1]);
          command++;
        }
        return source.frame(time);
      };
      let a = frame(0);
      for (let tick = 1; tick <= Math.ceil(1.12 * hz); tick++) {
        const b = frame(tick / hz);
        for (const alpha of [.2, .5, .8]) check(a, b, alpha, `${hz} Hz repeated command ${command}`);
        a = b;
      }
    }
    expect(minimum, worst).toBeGreaterThan(-.003);
    regression.forEach(({ reconstructed }) => expect(reconstructed).toBeGreaterThan(-.003));
    expect(fromFrame(source.frame(1.2))).toEqual([0, 0, 0]);
    if (process.env.MX_FOOT_METRICS) console.info({ id, detail, checked, minimum, regression, worst });
  } finally {
    model.dispose();
    materials.dispose();
  }
  // Let the worker publish results between these deliberately dense mesh
  // probes, including on a machine running other physics test assignments.
  await new Promise<void>(resolve => setImmediate(resolve));
});

it.each(['mx250', 'mx450'] as const)('%s draws the same reconstructed feet as PresentedFrame through LOD cuts and seeks', id => {
  const source = fixture(id), shells = new BikeShells(), display = new PresentedFrame();
  const host = { root: new T.Object3D() }, camera = new T.PerspectiveCamera(58, 16 / 9);
  const { a, b } = interrupt(source, -1, 1, .115, 1 / 30, 0);
  const pose = (alpha: number, distance: number) => {
    camera.position.set(0, 0, -distance);
    shells.update(a, b, alpha, [host], camera, 'high', -1);
    const model = shells.motocrossPresentation(0)!;
    const shown = display.sample(a, b, alpha), values = fromFrame(shown);
    const selector = model.root.getObjectByName('Motocross gear selector')!;
    expect(selector.rotation.x).toBeCloseTo(values[0], 7);
    const renderedGap = contact(model.root)();
    expect(renderedGap).toBeGreaterThan(-.003);
    const boot = model.root.getObjectByName('Motocross left boot')!;
    const matrix = Array.from(boot.matrixWorld.elements);
    // Reposing the same existing model from the PresentedFrame values proves
    // the reader consumes all three channels, not just the visible selector.
    model.pose({ ...staticSag(VEHICLES[id]), steer: 0, frontRotation: 0, rearRotation: 0,
      chassisLean: 0, riderOffset: 0, tuck: 0, brake: 0, rearBrake: .75,
      discTemp: 0, compoundColour: 0xffffff, riding: true, standing: .24,
      shiftAngle: values[0], shiftCover: values[1], shiftClear: values[2] });
    model.root.updateMatrixWorld(true);
    Array.from(boot.matrixWorld.elements).forEach((value, index) => expect(value).toBeCloseTo(matrix[index], 6));
    return { detail: model.detail, values, matrix };
  };
  try {
    const high = pose(.2, 2), mid = pose(.2, 65);
    expect(high.detail).toBe('high');
    expect(mid.detail).toBe('mid');
    pose(.8, 2);
    expect(pose(.2, 2)).toEqual(high);
    expect(pose(.2, 65)).toEqual(mid);
    expect(pose(.2, 65)).toEqual(mid);
  } finally {
    shells.disposeAll();
  }
});
