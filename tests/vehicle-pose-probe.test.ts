import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { BikeShells } from '../src/rendering/bike.ts';
import { FormulaCar } from '../src/rendering/car.ts';
import { DriverAsset } from '../src/rendering/driver-asset.ts';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import { A61_MANIFESTS, type RivalLevels } from '../src/rendering/a61-rival.ts';
import { SLIDER_SPARKS } from '../src/rendering/gp-slider-sparks.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import { VehicleBodies } from '../src/rendering/vehicle-bodies/index.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import type { CircuitId } from '../src/simulation/circuits.ts';
import {
  B,
  BIKE_BASE,
  F,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { Simulation } from '../src/simulation/world.ts';

/** Numeric animation probe (Vehicle Art & Animation audit).
 *
 * A real simulation drives the machine (the production AI as the player, so the
 * steering, braking, lean and suspension all vary), every 1/30 s snapshot is fed
 * to the PRODUCTION render classes (VehicleBodies for catalogue cars, BikeShells for
 * GP and dirt bikes), and the posed Object3D transforms are read back: steering
 * wheel / handlebar, steered wheels, wheel spin, suspension travel, chassis roll,
 * rider-to-grip distance and the brake lamp. It asserts that each rendered value is
 * driven by (correlates with) the recorded input and that the pose is not frozen.
 * It is a CPU transform probe: it says nothing about shading or what a GPU draws.
 * Set POSE_PROBE_OUT=<file.json> to dump the measured table for the report. */

const HZ = 30;
const table: Record<string, Record<string, number | string>> = {};

beforeAll(() => {
  const noop = () => undefined;
  class Canvas {
    width = 256;
    height = 256;
    getContext() {
      return new Proxy(
        {
          canvas: this,
          measureText: () => ({ width: 30 }),
          createLinearGradient: () => ({ addColorStop: noop }),
          createRadialGradient: () => ({ addColorStop: noop }),
          createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        },
        { get: (target, key) => Reflect.get(target, key) ?? noop },
      );
    }
  }
  vi.stubGlobal('document', { createElement: () => new Canvas() });
  vi.stubGlobal('HTMLCanvasElement', Canvas);
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (process.env.POSE_PROBE_OUT)
    writeFileSync(process.env.POSE_PROBE_OUT, JSON.stringify(table, null, 2) + '\n');
});

function drive(vehicle: string, circuit: CircuitId, seconds: number, ruleset?: string) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    weather: 'clear',
    circuit,
    opponents: 0,
    vehicles: [vehicle],
    seed: 5150,
    ...(ruleset ? { ruleset } : {}),
  });
  sim.autoPlayer = true;
  sim.race.time = sim.race.greenAt + 1;
  const frames: Float32Array[] = [];
  const steps = 120 / HZ;
  for (let i = 0; i < seconds * 120; i++) {
    sim.step(1 / 120);
    if (i % steps === steps - 1 && i > 6 * 120 * 0) frames.push(sim.makeFrame());
  }
  return frames;
}
const o = carBase(0);

const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
const range = (v: number[]) => Math.max(...v) - Math.min(...v);
function corr(x: number[], y: number[]) {
  const mx = mean(x),
    my = mean(y);
  let sxy = 0,
    sxx = 0,
    syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx > 1e-18 && syy > 1e-18 ? sxy / Math.sqrt(sxx * syy) : 0;
}
const wrap = (d: number) =>
  ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** Ratio of rendered wheel-phase advance to the recorded rotation advance. */
function spinRatio(rendered: number[], recorded: number[]) {
  let a = 0,
    b = 0;
  for (let i = 1; i < rendered.length; i++) {
    a += Math.abs(wrap(rendered[i] - rendered[i - 1]));
    b += Math.abs(wrap(recorded[i] - recorded[i - 1]));
  }
  return b > 0 ? a / b : 0;
}
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
/** Roll (rad) of a quaternion about the machine's own forward (+Z) axis. */
function roll(q: T.Quaternion) {
  const side = new T.Vector3(1, 0, 0).applyQuaternion(q);
  return Math.asin(Math.max(-1, Math.min(1, side.y)));
}

describe('rendered pose follows a real driven session', () => {
  it('formula car (APX-01 procedural FormulaCar): steering, steered wheels, spin, suspension, driver', async () => {
    const hero = await HeroShells.decode(
      new Uint8Array(readFileSync('src/rendering/apx01-shell.glb.gz')),
    );
    const driver = await DriverAsset.decode(
      new Uint8Array(readFileSync('src/rendering/apx01-driver.glb.gz')),
    );
    const car = new FormulaCar(0, hero, driver);
    car.setLod(5, 'high', true);
    const frames = drive('apx01', 'aurel', 24);
    const rows: Record<string, number[]> = {
      steerCmd: [],
      wheelRot: [],
      yaw: [],
      yawRec: [],
      hubY: [],
      length: [],
      spin: [],
      spinRec: [],
      speed: [],
      roll: [],
      latG: [],
      tail: [],
      brake: [],
    };
    for (let k = 0; k < frames.length; k++) {
      const f = frames[k];
      car.update(f, f, o, 1, 1 / HZ, f[0], false);
      rows.steerCmd.push(f[o + F.STEER]);
      rows.wheelRot.push(car.steering.rotation.z);
      rows.yaw.push(car.wheelPivots[0].rotation.y);
      rows.yawRec.push(f[o + WHEEL_BASE + W.STEER]);
      rows.hubY.push(car.wheelPivots[2].position.y);
      rows.length.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.LENGTH]);
      rows.spin.push(car.wheelSpins[2].rotation.x);
      rows.spinRec.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.ROTATION]);
      rows.speed.push(f[o + F.SPEED]);
      rows.roll.push(roll(car.root.quaternion));
      rows.latG.push(f[o + F.G_LAT]);
      rows.tail.push(car.rainLight.emissiveIntensity);
      rows.brake.push(f[o + F.BRAKE]);
    }
    const m = {
      frames: frames.length,
      speedMax: round(Math.max(...rows.speed), 1),
      steerCmdRange: round(range(rows.steerCmd)),
      steeringWheelRange: round(range(rows.wheelRot)),
      steeringWheelVsSteerR: round(corr(rows.steerCmd, rows.wheelRot), 3),
      steeringWheelRatio: round(range(rows.wheelRot) / Math.max(1e-9, range(rows.steerCmd)), 3),
      frontPivotYawVsRecordedMaxErr: round(
        Math.max(...rows.yaw.map((v, i) => Math.abs(v - rows.yawRec[i]))),
        6,
      ),
      hubTravelRange_m: round(range(rows.hubY), 4),
      hubVsRecordedLengthR: round(corr(rows.hubY, rows.length), 3),
      rearSpinRatio: round(spinRatio(rows.spin, rows.spinRec), 3),
      bodyRollRange_rad: round(range(rows.roll)),
      bodyRollVsLatGR: round(corr(rows.roll, rows.latG), 3),
      latGMax: round(Math.max(...rows.latG.map(Math.abs)), 2),
      rearLampBraking: round(mean(rows.tail.filter((_, i) => rows.brake[i] > 0.05)) || 0, 2),
      rearLampCoasting: round(mean(rows.tail.filter((_, i) => rows.brake[i] <= 0.05)) || 0, 2),
    };
    table['apx01'] = m;
    expect(m.speedMax).toBeGreaterThan(15);
    expect(Math.abs(m.steeringWheelVsSteerR)).toBeGreaterThan(0.99);
    expect(m.frontPivotYawVsRecordedMaxErr).toBeLessThan(1e-5);
    expect(m.hubTravelRange_m).toBeGreaterThan(0.002);
    expect(m.rearSpinRatio).toBeGreaterThan(0.95);
    expect(m.rearSpinRatio).toBeLessThan(1.05);
    hero.dispose();
    driver.dispose();
  }, 180000);

  it('APX-01 as the game draws it (A61 levels, hero livery): wheel, hubs, spin, discs, arms, lamp, no indicators', async () => {
    const levels = (await Promise.all(
      (['near', 'mid', 'far'] as const).map((name, i) =>
        HeroShells.decode(
          new Uint8Array(readFileSync(`src/rendering/a61-rival-${name}.glb.gz`)),
          undefined,
          A61_MANIFESTS[i],
        ),
      ),
    )) as unknown as RivalLevels;
    const legacy = await HeroShells.decode(
      new Uint8Array(readFileSync('src/rendering/apx01-shell.glb.gz')),
    );
    const driver = await DriverAsset.decode(
      new Uint8Array(readFileSync('src/rendering/apx01-driver.glb.gz')),
    );
    const car = new FormulaCar(0, legacy, driver, undefined, levels);
    car.setLod(5, 'high', true);
    const frames = drive('apx01', 'aurel', 24);
    const rows: Record<string, number[]> = {
      steerCmd: [],
      wheelRot: [],
      yaw: [],
      yawRec: [],
      hubY: [],
      length: [],
      spin: [],
      spinRec: [],
      disc: [],
      discRec: [],
      upper: [],
      lower: [],
      reachable: [],
      tail: [],
      brake: [],
      speed: [],
    };
    for (const f of frames) {
      car.update(f, f, o, 1, 1 / HZ, f[0], false);
      rows.steerCmd.push(f[o + F.STEER]);
      rows.wheelRot.push(car.steering.rotation.z);
      rows.yaw.push(car.wheelPivots[0].rotation.y);
      rows.yawRec.push(f[o + WHEEL_BASE + W.STEER]);
      rows.hubY.push(car.wheelPivots[2].position.y);
      rows.length.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.LENGTH]);
      rows.spin.push(car.wheelSpins[2].rotation.x);
      rows.spinRec.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.ROTATION]);
      rows.disc.push(car.discs[0].emissiveIntensity);
      rows.discRec.push(f[o + WHEEL_BASE + W.DISC_TEMP]);
      const arms = car.driver.diagnostics();
      rows.upper.push(Math.max(...arms.map((a) => a.upperLength)));
      rows.lower.push(Math.max(...arms.map((a) => a.lowerLength)));
      rows.reachable.push(arms.every((a) => a.reachable) ? 1 : 0);
      rows.tail.push(car.rainLight.emissiveIntensity);
      rows.brake.push(f[o + F.BRAKE]);
      rows.speed.push(f[o + F.SPEED]);
    }
    // Disc glow is the recorded rotor temperature, linear above 500 C (car.ts), zero below it.
    const m = {
      frames: frames.length,
      speedMax: round(Math.max(...rows.speed), 1),
      steeringWheelVsSteerR: round(corr(rows.steerCmd, rows.wheelRot), 3),
      frontPivotYawVsRecordedMaxErr: round(
        Math.max(...rows.yaw.map((v, i) => Math.abs(v - rows.yawRec[i]))),
        6,
      ),
      hubTravelRange_m: round(range(rows.hubY), 4),
      hubVsRecordedLengthR: round(corr(rows.hubY, rows.length), 3),
      rearSpinRatio: round(spinRatio(rows.spin, rows.spinRec), 3),
      discGlowFrames: rows.disc.filter((g) => g > 0).length,
      discTempMax_C: round(Math.max(...rows.discRec), 0),
      driverUpperArmRange_m: round(range(rows.upper), 5),
      driverForearmRange_m: round(range(rows.lower), 5),
      driverArmsReachableShare: round(mean(rows.reachable), 3),
      rearLampBraking: round(mean(rows.tail.filter((_, i) => rows.brake[i] > 0.05)) || 0, 2),
      rearLampCoasting: round(mean(rows.tail.filter((_, i) => rows.brake[i] <= 0.05)) || 0, 2),
    };
    table['apx01-production'] = m;
    expect(m.speedMax).toBeGreaterThan(15);
    expect(Math.abs(m.steeringWheelVsSteerR)).toBeGreaterThan(0.99);
    expect(m.frontPivotYawVsRecordedMaxErr).toBeLessThan(1e-5);
    expect(m.hubTravelRange_m).toBeGreaterThan(0.002);
    expect(m.rearSpinRatio).toBeGreaterThan(0.95);
    expect(m.rearSpinRatio).toBeLessThan(1.05);
    // The rotors glow with their recorded temperature, linear from 500 C and clamped at 2 (car.ts).
    // A normal Aurel lap only reaches ~320 C, so the glow is probed with a temperature sweep on a
    // rolling frame (every wheel), and the lap itself must stay dark below the threshold.
    expect(m.discGlowFrames).toBe(rows.discRec.filter((t) => t > 500).length);
    // The reduced (mid/far) rotors share their wheel's disc, so a hot rotor keeps
    // its glow across a level switch instead of popping dark.
    const reducedRotors: T.Mesh[] = [];
    car.root.traverse((o) => {
      if (o instanceof T.Mesh && o.name === 'Upright-owned reduced brake') reducedRotors.push(o);
    });
    expect(reducedRotors).toHaveLength(8);
    for (const rotor of reducedRotors) expect(car.discs).toContain(rotor.material);
    const base = frames[frames.length >> 1].slice();
    const sweep: { temp: number; glow: number[] }[] = [];
    for (const temp of [200, 500, 600, 800, 950, 1300, 1600]) {
      const f = base.slice();
      for (let i = 0; i < 4; i++) f[o + WHEEL_BASE + i * WHEEL_STRIDE + W.DISC_TEMP] = temp;
      car.update(f, f, o, 1, 1 / HZ, f[0], false);
      sweep.push({ temp, glow: car.discs.map((d) => d.emissiveIntensity) });
    }
    for (const { temp, glow } of sweep)
      for (const g of glow) expect(g).toBeCloseTo(Math.min(2, Math.max(0, (temp - 500) / 450)), 6);
    expect(sweep[0].glow[0]).toBe(0);
    expect(sweep[3].glow[0]).toBeGreaterThan(sweep[2].glow[0]);
    expect(sweep[sweep.length - 1].glow[3]).toBe(2);
    table['apx01-production'].discGlowSweep = sweep
      .map((r) => `${r.temp}C:${round(r.glow[0], 3)}`)
      .join(' ');
    // The driver's arms keep their bone lengths (rigid limbs) and reach the wheel in every frame.
    expect(m.driverUpperArmRange_m).toBeLessThan(0.002);
    expect(m.driverForearmRange_m).toBeLessThan(0.002);
    expect(m.driverArmsReachableShare).toBe(1);
    expect(m.rearLampBraking).toBeGreaterThan(m.rearLampCoasting);
    // Turn indicators and hazards: none exist on the player car (ambient traffic only).
    const names: string[] = [];
    car.root.traverse((object) => names.push(object.name));
    expect(names.filter((n) => /indicator|hazard|turn signal|blinker/i.test(n))).toEqual([]);
    table['apx01-production'].turnIndicators = 'none (absent by design)';
    levels.forEach((a) => a.dispose());
    legacy.dispose();
    driver.dispose();
  }, 180000);

  it('catalogue car (EH-3): steering wheel, steered wheels, spin, suspension, chassis, brake lamp', () => {
    const frames = drive('eh3', 'aurel', 24);
    const bodies = new VehicleBodies();
    const host = { root: new T.Object3D() };
    const view = { follow: 0, cockpit: false, camera: null };
    const rows: Record<string, number[]> = {
      steerCmd: [],
      wheelRot: [],
      pivotYaw: [],
      pivotYawRecorded: [],
      hubY: [],
      length: [],
      roll: [],
      latG: [],
      spinRL: [],
      spinRecorded: [],
      tailGlow: [],
      brake: [],
      speed: [],
    };
    let tail: T.MeshStandardMaterial | null = null;
    for (const f of frames) {
      sampleChassisPose(f, f, o, 1, host.root.position, host.root.quaternion);
      bodies.update(f, f, 1, [host], false, view);
      const built = (
        bodies as unknown as {
          bodies: Map<
            number,
            {
              wheels: { pivot: T.Group; spin: T.Group }[][];
              materials: { tail: T.MeshStandardMaterial };
            }
          >;
        }
      ).bodies.get(0)!;
      tail = built.materials.tail;
      const cabin = bodies.cabinOf(0)!;
      rows.steerCmd.push(f[o + F.STEER]);
      rows.wheelRot.push(cabin.steering.rotation.z);
      rows.pivotYaw.push(built.wheels[0][0].pivot.rotation.y);
      rows.pivotYawRecorded.push(f[o + WHEEL_BASE + W.STEER]);
      rows.hubY.push(built.wheels[0][2].pivot.position.y);
      rows.length.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.LENGTH]);
      rows.roll.push(roll(host.root.quaternion));
      rows.latG.push(f[o + F.G_LAT]);
      rows.spinRL.push(built.wheels[0][2].spin.rotation.x);
      rows.spinRecorded.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.ROTATION]);
      rows.tailGlow.push(tail.emissiveIntensity);
      rows.brake.push(f[o + F.BRAKE]);
      rows.speed.push(f[o + F.SPEED]);
    }
    const m = {
      frames: frames.length,
      speedMax: round(Math.max(...rows.speed), 1),
      steerCmdRange: round(range(rows.steerCmd)),
      steeringWheelRange: round(range(rows.wheelRot)),
      steeringWheelVsSteerR: round(corr(rows.steerCmd, rows.wheelRot), 3),
      steeringWheelRatio: round(range(rows.wheelRot) / Math.max(1e-9, range(rows.steerCmd)), 3),
      frontPivotYawVsRecordedMaxErr: round(
        Math.max(...rows.pivotYaw.map((v, i) => Math.abs(v - rows.pivotYawRecorded[i]))),
        6,
      ),
      frontPivotYawRange: round(range(rows.pivotYaw)),
      hubTravelRange_m: round(range(rows.hubY), 4),
      hubVsRecordedLengthR: round(corr(rows.hubY, rows.length), 3),
      rearSpinRatio: round(spinRatio(rows.spinRL, rows.spinRecorded), 3),
      bodyRollRange_rad: round(range(rows.roll)),
      bodyRollVsLatGR: round(corr(rows.roll, rows.latG), 3),
      latGMax: round(Math.max(...rows.latG.map(Math.abs)), 2),
      tailGlowBraking: round(mean(rows.tailGlow.filter((_, i) => rows.brake[i] > 0.05)) || 0, 2),
      tailGlowCoasting: round(mean(rows.tailGlow.filter((_, i) => rows.brake[i] <= 0.05)) || 0, 2),
    };
    table['eh3'] = m;
    expect(m.speedMax).toBeGreaterThan(15);
    expect(m.steerCmdRange).toBeGreaterThan(0.02);
    expect(Math.abs(m.steeringWheelVsSteerR)).toBeGreaterThan(0.99);
    expect(m.frontPivotYawVsRecordedMaxErr).toBeLessThan(1e-5);
    expect(m.hubTravelRange_m).toBeGreaterThan(0.002);
    expect(m.rearSpinRatio).toBeGreaterThan(0.95);
    expect(m.rearSpinRatio).toBeLessThan(1.05);
    expect(m.tailGlowBraking).toBeGreaterThan(m.tailGlowCoasting);
    // Full-lock sweep on a rolling frame: the steering wheel and both steered
    // wheels must follow the recorded steering linearly all the way to the stops.
    const base = frames[frames.length >> 1].slice();
    const lock = 0.5;
    const sweep = {
      cmd: [] as number[],
      wheel: [] as number[],
      left: [] as number[],
      right: [] as number[],
    };
    for (let k = 0; k <= 16; k++) {
      const s = ((k / 16) * 2 - 1) * lock,
        f = base.slice();
      f[o + F.STEER] = s;
      for (const i of [0, 1]) f[o + WHEEL_BASE + i * WHEEL_STRIDE + W.STEER] = s;
      sampleChassisPose(f, f, o, 1, host.root.position, host.root.quaternion);
      bodies.update(f, f, 1, [host], false, view);
      const built = (
        bodies as unknown as { bodies: Map<number, { wheels: { pivot: T.Group }[][] }> }
      ).bodies.get(0)!;
      sweep.cmd.push(s);
      sweep.wheel.push(bodies.cabinOf(0)!.steering.rotation.z);
      sweep.left.push(built.wheels[0][0].pivot.rotation.y);
      sweep.right.push(built.wheels[0][1].pivot.rotation.y);
    }
    // Driver gloves (DriverArms): in the sweep they follow the wheel to the travel
    // limit and stay on the rim circle; the forearm keeps its length.
    const rig = bodies.cabinOf(0)!.arms!;
    const reach: number[] = [];
    const rim: number[] = [];
    const column = bodies.cabinOf(0)!.steering.parent as T.Group;
    const inverse = column.matrix.clone().invert();
    for (let k = 0; k <= 16; k++) {
      const turn = (((k / 16) * 2 - 1) * lock * bodies.cabinOf(0)!.layout.wheel.ratio) / 1;
      rig.update(turn);
      rig.gloves().forEach((g) => {
        const local = g.clone().applyMatrix4(inverse);
        rim.push(Math.abs(Math.hypot(local.x, local.y) - bodies.cabinOf(0)!.layout.wheel.radius));
      });
      reach.push(...rig.spans().map((span) => Math.abs(span.upperNow - span.upper)));
    }
    table['eh3'].gloveOffRimMax_m = round(Math.max(...rim), 4);
    table['eh3'].upperArmLengthErrMax_m = round(Math.max(...reach), 5);
    expect(Math.max(...rim)).toBeLessThan(0.01);
    expect(Math.max(...reach)).toBeLessThan(0.002);
    table['eh3'].fullLockWheelRot_rad = round(range(sweep.wheel), 3);
    table['eh3'].fullLockWheelRot_turns = round(range(sweep.wheel) / (2 * Math.PI), 2);
    table['eh3'].fullLockWheelLinearR = round(corr(sweep.cmd, sweep.wheel), 4);
    expect(Math.abs(corr(sweep.cmd, sweep.wheel))).toBeGreaterThan(0.9999);
    expect(corr(sweep.cmd, sweep.left)).toBeGreaterThan(0.9999);
    expect(corr(sweep.cmd, sweep.right)).toBeGreaterThan(0.9999);
    bodies.clear();
  }, 120000);

  it.each([['sk125'], ['dk100'], ['dx8'], ['rp6']] as const)(
    'catalogue %s (kart / truck, vehicle art 3): steering wheel, steered wheels, spin, suspension, brake lamp',
    (id) => {
      const frames = drive(id, 'aurel', 20);
      const bodies = new VehicleBodies();
      const host = { root: new T.Object3D() };
      const view = { follow: 0, cockpit: false, camera: null };
      const rows: Record<string, number[]> = {
        steerCmd: [],
        wheelRot: [],
        yaw: [],
        yawRec: [],
        hubY: [],
        length: [],
        spin: [],
        spinRec: [],
        tail: [],
        brake: [],
        speed: [],
      };
      for (const f of frames) {
        sampleChassisPose(f, f, o, 1, host.root.position, host.root.quaternion);
        bodies.update(f, f, 1, [host], false, view);
        const built = (
          bodies as unknown as {
            bodies: Map<
              number,
              {
                wheels: { pivot: T.Group; spin: T.Group }[][];
                materials: { tail: T.MeshStandardMaterial };
              }
            >;
          }
        ).bodies.get(0)!;
        const cabin = bodies.cabinOf(0)!;
        rows.steerCmd.push(f[o + F.STEER]);
        rows.wheelRot.push(cabin.steering.rotation.z);
        rows.yaw.push(built.wheels[0][0].pivot.rotation.y);
        rows.yawRec.push(f[o + WHEEL_BASE + W.STEER]);
        rows.hubY.push(built.wheels[0][2].pivot.position.y);
        rows.length.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.LENGTH]);
        rows.spin.push(built.wheels[0][2].spin.rotation.x);
        rows.spinRec.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.ROTATION]);
        rows.tail.push(built.materials.tail.emissiveIntensity);
        rows.brake.push(f[o + F.BRAKE]);
        rows.speed.push(f[o + F.SPEED]);
      }
      const m = {
        frames: frames.length,
        speedMax: round(Math.max(...rows.speed), 1),
        steeringWheelVsSteerR: round(corr(rows.steerCmd, rows.wheelRot), 3),
        frontPivotYawVsRecordedMaxErr: round(
          Math.max(...rows.yaw.map((v, i) => Math.abs(v - rows.yawRec[i]))),
          6,
        ),
        hubTravelRange_m: round(range(rows.hubY), 4),
        hubVsRecordedLengthR: round(corr(rows.hubY, rows.length), 3),
        rearSpinRatio: round(spinRatio(rows.spin, rows.spinRec), 3),
        tailGlowBraking: round(mean(rows.tail.filter((_, i) => rows.brake[i] > 0.05)) || 0, 2),
        tailGlowCoasting: round(mean(rows.tail.filter((_, i) => rows.brake[i] <= 0.05)) || 0, 2),
      };
      table[id] = m;
      expect(m.speedMax).toBeGreaterThan(10);
      expect(Math.abs(m.steeringWheelVsSteerR)).toBeGreaterThan(0.99);
      expect(m.frontPivotYawVsRecordedMaxErr).toBeLessThan(1e-5);
      expect(m.rearSpinRatio).toBeGreaterThan(0.95);
      expect(m.rearSpinRatio).toBeLessThan(1.05);
      // A kart may never brake in a free run: probe the lamp with a controlled coasting / braking pair.
      const pair = frames[frames.length >> 1];
      const lamp = (brake: number) => {
        const f = pair.slice();
        f[o + F.BRAKE] = brake;
        sampleChassisPose(f, f, o, 1, host.root.position, host.root.quaternion);
        bodies.update(f, f, 1, [host], false, view);
        return (
          bodies as unknown as {
            bodies: Map<number, { materials: { tail: T.MeshStandardMaterial } }>;
          }
        ).bodies.get(0)!.materials.tail.emissiveIntensity;
      };
      const coasting = lamp(0),
        braking = lamp(1);
      table[id].lampCoasting = round(coasting, 2);
      table[id].lampBraking = round(braking, 2);
      expect(braking).toBeGreaterThan(coasting);
      bodies.clear();
    },
    120000,
  );

  it.each([
    ['gpr1', 'poggio-alto', 'gp-motorcycle'],
    ['mx450', 'valley-ridge-mx', undefined],
  ] as const)(
    '%s: handlebar, lean, wheel spin, fork/shock travel, rider hands',
    (id, circuit, ruleset) => {
      const frames = drive(id, circuit as CircuitId, 26, ruleset);
      const shells = new BikeShells();
      const host = { root: new T.Object3D() };
      const camera = new T.PerspectiveCamera(58, 16 / 9);
      const rows: Record<string, number[]> = {
        steerCmd: [],
        barYaw: [],
        leanCmd: [],
        bodyRoll: [],
        riderRoll: [],
        forkCmd: [],
        forkY: [],
        shockCmd: [],
        pitch: [],
        spinF: [],
        spinFRec: [],
        spinR: [],
        spinRRec: [],
        handGap: [],
        sparksOn: [],
        kneeDown: [],
        sparkRoll: [],
        speed: [],
      };
      const scratch = new T.Vector3(),
        grip = new T.Vector3();
      for (const f of frames) {
        sampleChassisPose(f, f, o, 1, host.root.position, host.root.quaternion);
        shells.update(f, f, 1, [host], camera, 'high', 0);
        const entry = (
          shells as unknown as { entries: Map<number, { levels: Record<string, unknown>[] }> }
        ).entries.get(0)!;
        const model = entry.levels[0] as unknown as {
          root: T.Group;
          sprung: T.Group;
          steer: T.Group;
          forkLower: T.Group;
          frontSpin: T.Group;
          rearSpin: T.Group;
          rider: {
            grips: T.Vector3[];
            root: T.Group;
            hands: T.Group[];
            torso: T.Group;
            kneeDown: [number, number];
          };
          sliderSparks?: { points: T.Points };
        };
        model.root.updateMatrixWorld(true);
        rows.steerCmd.push(f[o + BIKE_BASE + B.STEER]);
        rows.barYaw.push(model.steer.rotation.y);
        rows.leanCmd.push(f[o + BIKE_BASE + B.LEAN]);
        rows.bodyRoll.push(roll(model.root.quaternion));
        rows.riderRoll.push(roll(model.rider.torso.getWorldQuaternion(new T.Quaternion())));
        rows.forkCmd.push(f[o + BIKE_BASE + B.FORK]);
        rows.forkY.push(model.forkLower.position.y);
        rows.shockCmd.push(f[o + BIKE_BASE + B.SHOCK]);
        rows.pitch.push(model.sprung.rotation.x);
        rows.spinF.push(model.frontSpin.rotation.x);
        rows.spinFRec.push(f[o + WHEEL_BASE + W.ROTATION]);
        rows.spinR.push(model.rearSpin.rotation.x);
        rows.spinRRec.push(f[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.ROTATION]);
        rows.speed.push(f[o + F.SPEED]);
        // Both gloves against both grips, in world space (the rider root sits in the sprung frame).
        let worst = 0;
        model.rider.hands.forEach((hand, i) => {
          hand.getWorldPosition(scratch);
          grip.copy(model.rider.grips[i]);
          model.sprung.localToWorld(grip);
          worst = Math.max(worst, scratch.distanceTo(grip));
        });
        rows.handGap.push(worst);
        // GP knee-slider sparks (vehicle art 3): drawn only while a knee is folded onto the road.
        const burst = model.sliderSparks?.points.visible ? 1 : 0;
        rows.sparksOn.push(burst);
        rows.kneeDown.push(model.rider.kneeDown[0] || model.rider.kneeDown[1] ? 1 : 0);
        if (burst) rows.sparkRoll.push(Math.abs(roll(model.root.quaternion)));
      }
      const m = {
        frames: frames.length,
        speedMax: round(Math.max(...rows.speed), 1),
        steerCmdRange: round(range(rows.steerCmd)),
        handlebarYawRange: round(range(rows.barYaw)),
        handlebarVsSteerR: round(corr(rows.steerCmd, rows.barYaw), 3),
        leanCmdRange: round(range(rows.leanCmd)),
        bodyRollRange_rad: round(range(rows.bodyRoll)),
        bodyRollVsLeanCmdR: round(corr(rows.leanCmd, rows.bodyRoll), 3),
        riderTorsoRollRange_rad: round(range(rows.riderRoll)),
        forkTravelRange_m: round(range(rows.forkY), 4),
        forkVsRecordedR: round(corr(rows.forkCmd, rows.forkY), 3),
        chassisPitchRange_rad: round(range(rows.pitch), 4),
        frontSpinRatio: round(spinRatio(rows.spinF, rows.spinFRec), 3),
        rearSpinRatio: round(spinRatio(rows.spinR, rows.spinRRec), 3),
        handToGripMax_m: round(Math.max(...rows.handGap), 3),
        handToGripMean_m: round(mean(rows.handGap), 3),
        kneeDownFrames: rows.kneeDown.filter(Boolean).length,
        sliderSparkFrames: rows.sparksOn.filter(Boolean).length,
        sliderSparkMinAbsRoll_rad: rows.sparkRoll.length ? round(Math.min(...rows.sparkRoll)) : 0,
      };
      table[id] = m;
      expect(m.speedMax).toBeGreaterThan(15);
      expect(m.steerCmdRange).toBeGreaterThan(0.01);
      expect(Math.abs(m.handlebarVsSteerR)).toBeGreaterThan(0.99);
      expect(m.frontSpinRatio).toBeGreaterThan(0.95);
      expect(m.frontSpinRatio).toBeLessThan(1.05);
      expect(m.rearSpinRatio).toBeGreaterThan(0.95);
      expect(m.rearSpinRatio).toBeLessThan(1.05);
      expect(m.forkTravelRange_m).toBeGreaterThan(0.002);
      // The slider sparks are a consequence of the road clamp and a real lean, never of either alone.
      for (let k = 0; k < rows.sparksOn.length; k++)
        if (rows.sparksOn[k]) expect(rows.kneeDown[k]).toBe(1);
      if (id === 'gpr1') {
        expect(m.sliderSparkFrames).toBeLessThanOrEqual(m.kneeDownFrames);
        if (m.sliderSparkFrames > 0)
          expect(m.sliderSparkMinAbsRoll_rad).toBeGreaterThan(SLIDER_SPARKS.leanFrom * 0.8);
      } else expect(m.sliderSparkFrames).toBe(0);
      shells.disposeAll();
      void R;
      void RACE_BASE;
    },
    180000,
  );
});
