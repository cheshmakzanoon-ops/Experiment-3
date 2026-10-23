import { describe, expect, it } from 'vitest';
import * as T from 'three';
import {
  GP_PHOTOGRAPHIC,
  applyGpDaylight,
  gpGradeProfile,
  gpPhotographicActive,
} from '../src/rendering/gp-photographic-light.ts';
import {
  GP_CHASE,
  GP_SHUTTER,
  GP_TRACKSIDE_DOF_BELOW,
  GP_TRACKSIDE_LENS,
  GpChaseDynamics,
  gpChase,
  gpSubjectLens,
  type ChaseRig,
} from '../src/rendering/gp-photographic-camera.ts';
import { motorcycleChase } from '../src/rendering/motorcycle-camera.ts';
import { BroadcastGradePass, GRADE_PROFILES } from '../src/rendering/broadcast-grade.ts';
import { circuitLightState } from '../src/rendering/daylight.ts';
import { specularIBLGain } from '../src/rendering/studio/ibl-energy.ts';
import { DepthOfFieldPass } from '../src/rendering/studio/dof-pass.ts';
import { BROADCAST_LENS, focusOnSubject } from '../src/rendering/studio/subject-focus.ts';
import { MOTION_BLUR } from '../src/rendering/studio/velocity.ts';
import { graphicsPreset } from '../src/rendering/options.ts';
import {
  GP_CLEAR_SKY,
  GP_CLEAR_SKYLINE,
  SKY_RAMPS,
  skyBlend,
  withClearSky,
} from '../src/rendering/assets/sky-catalogue.ts';
import { PhotoSky } from '../src/rendering/assets/photo-sky.ts';
import { TELEPHOTO, tracksideFraming } from '../src/rendering/trackside.ts';
import { GP_TELEPHOTO, gpMotionWheels } from '../src/rendering/gp-photographic-camera.ts';
import { MotionField, shutterSeconds } from '../src/rendering/studio/velocity.ts';
import { createStudioUniforms, StudioFrame } from '../src/rendering/studio/studio-frame.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';

describe('GP photographic light', () => {
  it('applies only to a followed GP prototype on a live circuit view by day or golden hour', () => {
    expect(gpPhotographicActive('gp-bike', false, 'day')).toBe(true);
    expect(gpPhotographicActive('gp-bike', false, 'sunset')).toBe(true);
    expect(gpPhotographicActive('gp-bike', false, 'night')).toBe(false);
    expect(gpPhotographicActive('gp-bike', true, 'day')).toBe(false);
    for (const other of [
      'formula',
      'motocross',
      'superbike',
      'road-bike',
      'classic-bike',
      undefined,
    ])
      expect(gpPhotographicActive(other, false, 'day')).toBe(false);
  });

  it('trades diffuse sky fill for a dominant key while specular sky keeps the dome', () => {
    const shared = circuitLightState(0, 0, 'day');
    const gp = applyGpDaylight(circuitLightState(0, 0, 'day'));
    expect(gp.sun).toBeCloseTo(shared.sun * GP_PHOTOGRAPHIC.sun, 12);
    expect(gp.environment).toBeLessThan(shared.environment);
    expect(gp.fill).toBeLessThan(shared.fill);
    expect(gp.haze).toBeGreaterThan(shared.haze);
    // Key-to-fill: the sun against the diffuse sky share rises by 1 / skyFill.
    expect(gp.sun / gp.environment).toBeCloseTo(
      shared.sun / shared.environment / GP_PHOTOGRAPHIC.skyFill,
      9,
    );
    // The IBL split keeps reflections at the dome's on-screen radiance.
    expect(gp.environment * specularIBLGain(gp.environment)).toBeCloseTo(1, 9);
    expect(gp.exposure).toBeCloseTo(shared.exposure * 2 ** GP_PHOTOGRAPHIC.exposureEV, 12);
    // Degenerate looks stay finite and positive.
    const odd = applyGpDaylight(circuitLightState(0.4, 3, 'sunset'), {
      ...GP_PHOTOGRAPHIC,
      skyFill: NaN,
      hemisphereFill: -1,
      sun: Infinity,
      exposureEV: NaN,
      haze: -2,
    });
    for (const v of [odd.sun, odd.fill, odd.environment, odd.exposure, odd.haze]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('grades GP frames warm in the key and cool in the shade, over a deeper curve', () => {
    for (const mode of ['day', 'sunset'] as const) {
      const gp = gpGradeProfile(mode)!,
        shared = GRADE_PROFILES[mode];
      expect(gp.contrast).toBeGreaterThan(shared.contrast);
      expect(gp.highlightTint[0] / gp.highlightTint[2]).toBeGreaterThan(
        shared.highlightTint[0] / shared.highlightTint[2],
      );
      expect(gp.shadowTint[2] / gp.shadowTint[0]).toBeGreaterThan(
        shared.shadowTint[2] / shared.shadowTint[0],
      );
      // A subtle optical vignette and a grain below one code value at mid grey.
      expect(gp.vignette).toBeGreaterThan(shared.vignette);
      expect(gp.vignette).toBeLessThanOrEqual(0.25);
      expect(gp.grain * 0.5 * (1 - 0.5 * 0.7) * 255).toBeLessThan(1);
      expect(gp.fringe).toBe(0);
      expect(gp.sharpen).toBe(0);
    }
    expect(gpGradeProfile('night')).toBeNull();
    expect(gpGradeProfile('studio')).toBeNull();
  });

  it('uses the session grade over the profile and lets the photo look win', () => {
    const grade = new BroadcastGradePass();
    const u = (grade as unknown as { material: T.ShaderMaterial }).material.uniforms;
    grade.apply('day');
    expect(u.contrast.value).toBe(GRADE_PROFILES.day.contrast);
    grade.sessionOverride = gpGradeProfile('day');
    grade.apply('day');
    expect(u.contrast.value).toBe(GP_PHOTOGRAPHIC.grade.day.contrast);
    expect(u.grain.value).toBe(GP_PHOTOGRAPHIC.grade.day.grain);
    grade.photoOverride = { ...GRADE_PROFILES.studio, contrast: 0.03 };
    grade.apply('day');
    expect(u.contrast.value).toBe(0.03);
    grade.photoOverride = null;
    grade.sessionOverride = null;
    grade.apply('day');
    expect(u.contrast.value).toBe(GRADE_PROFILES.day.contrast);
    expect(u.grain.value).toBe(0);
    grade.dispose();
  });
});

describe('GP photographic camera', () => {
  it('frames the bike lower and larger through a longer lens, contact patch in frame', () => {
    // GP-R1 geometry: CG 0.62 m above the road, 0.75 m ahead of the rear axle.
    const view = (r: ChaseRig, speed: number) => {
      const h = r.height + speed * r.heightPerMS,
        d = r.distance + speed * r.distancePerMS,
        fov = r.fov + Math.min(r.fovGain, speed * 0.06),
        pitch = Math.atan((h - r.lookLift) / (d + r.lookAhead)),
        half = (fov * Math.PI) / 360;
      return {
        // Rear contact patch below the view centre, as a share of the half fov.
        contact: (Math.atan((h + 0.62) / (d - 0.75)) - pitch) / half,
        // Subject scale ~ 1 / (distance tan(fov / 2)).
        scale: 1 / (d * Math.tan(half)),
        pitchDeg: (pitch * 180) / Math.PI,
      };
    };
    for (const speed of [0, 12, 30, 80]) {
      const gp = gpChase(speed, 0, 0),
        shared = motorcycleChase(speed, 0, 0);
      expect(gp.height).toBeLessThan(shared.height);
      expect(gp.distance).toBeLessThanOrEqual(shared.distance);
      expect(gp.fov).toBeLessThan(shared.fov);
      const g = view(gp, speed),
        s = view(shared, speed);
      expect(g.scale / s.scale).toBeGreaterThan(1.15);
      // The shared rig crops the contact patch at the bottom edge; GP keeps it.
      expect(s.contact).toBeGreaterThan(0.98);
      expect(g.contact).toBeGreaterThan(0.72);
      expect(g.contact).toBeLessThan(0.9);
      expect(g.pitchDeg).toBeCloseTo(GP_CHASE.pitchDeg, 6);
    }
    const left = gpChase(45, 0.4, 0.8),
      right = gpChase(45, 0.4, -0.8);
    expect(left.yaw).toBeGreaterThan(0);
    expect(left.yaw).toBeCloseTo(-right.yaw, 12);
    for (const speed of [NaN, -500, 0, 110, Infinity])
      expect(Object.values(gpChase(speed, NaN, Infinity)).every(Number.isFinite)).toBe(true);
    const still = gpChase(0, 0, 0, true),
      fast = gpChase(95, 1, 1, true);
    expect(fast.height).toBe(still.height);
    expect(fast.yaw).toBe(0);
    expect(fast.distancePerMS).toBe(0);
    expect(fast.fovGain).toBe(0);
  });

  it('pulls back on drive, closes in and pitches forward on braking, within bounds', () => {
    const run = (g: number, seconds = 2) => {
      const d = new GpChaseDynamics();
      let out = d.update(0, 0, 60, 0, 0, false);
      for (let t = 1 / 60; t <= seconds; t += 1 / 60) out = d.update(1 / 60, g, 60, t, 0, false);
      return { ...out };
    };
    const drive = run(1.1),
      braking = run(-1.6),
      cruise = run(0);
    expect(drive.distance).toBeGreaterThan(0.3);
    expect(drive.distance).toBeLessThanOrEqual(GP_CHASE.driveBackMax);
    expect(drive.pitch).toBe(0);
    expect(braking.distance).toBeLessThan(-0.15);
    expect(braking.distance).toBeGreaterThanOrEqual(-GP_CHASE.brakeInMax);
    expect(braking.pitch).toBeGreaterThan(0.02);
    expect(braking.pitch).toBeLessThanOrEqual(GP_CHASE.brakePitchMax);
    expect(cruise.distance).toBe(0);
    // Filtered: a sudden 2 g step moves the rig only part-way in 0.1 s.
    expect(Math.abs(run(-2, 0.1).distance)).toBeLessThan(Math.abs(run(-2, 2).distance) * 0.5);
    // Extreme or invalid loads stay bounded and finite.
    for (const g of [NaN, Infinity, -Infinity, 40, -40]) {
      const out = run(g, 0.5);
      for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true);
      expect(out.distance).toBeLessThanOrEqual(GP_CHASE.driveBackMax);
      expect(out.distance).toBeGreaterThanOrEqual(-GP_CHASE.brakeInMax);
    }
  });

  it('vibrates finely at speed only, deterministically, and never in reduced motion', () => {
    const at = (speed: number, time: number, vibration: number, reduced = false) => {
      const d = new GpChaseDynamics();
      return { ...d.update(1 / 60, 0, speed, time, vibration, reduced) };
    };
    const slow = at(20, 3.21, 1);
    expect([slow.eyeX, slow.eyeY, slow.gazeX, slow.gazeY]).toEqual([0, 0, 0, 0]);
    let peakEye = 0,
      peakGaze = 0,
      moved = false;
    for (let t = 0; t < 2; t += 0.0071) {
      const v = at(85, t, 1);
      peakEye = Math.max(peakEye, Math.hypot(v.eyeX, v.eyeY));
      peakGaze = Math.max(peakGaze, Math.hypot(v.gazeX, v.gazeY));
      moved ||= v.eyeY !== 0;
      expect(at(85, t, 1)).toEqual(v);
    }
    expect(moved).toBe(true);
    expect(peakEye).toBeLessThanOrEqual(GP_CHASE.vibrationEye * Math.SQRT2);
    expect(peakGaze).toBeLessThanOrEqual(GP_CHASE.vibrationGaze * Math.SQRT2);
    const reduced = at(85, 1.37, 1, true);
    expect(Object.values(reduced).every((v) => v === 0)).toBe(true);
    const off = at(85, 1.37, 0);
    expect([off.eyeX, off.eyeY, off.gazeX, off.gazeY]).toEqual([0, 0, 0, 0]);
  });

  it('opens a slower shutter for GP views within the motion-blur bound', () => {
    for (const preset of ['medium', 'high'] as const) {
      const shutter = Math.min(
        MOTION_BLUR.maxStrength,
        graphicsPreset(preset).motionBlur * GP_SHUTTER,
      );
      expect(shutter).toBeGreaterThan(graphicsPreset(preset).motionBlur);
      // About a 180-degree shutter at 50 Hz (1/100 s) or faster.
      expect(shutter / MOTION_BLUR.referenceRate).toBeLessThanOrEqual(1 / 99);
    }
    expect(graphicsPreset('low').motionBlur * GP_SHUTTER).toBe(0);
  });

  it('separates the followed bike on trackside telephoto shots with a ratio-response lens', () => {
    expect(gpSubjectLens('trackside', 18)).toBe(GP_TRACKSIDE_LENS);
    expect(gpSubjectLens('trackside', GP_TRACKSIDE_DOF_BELOW + 1)).toBeNull();
    expect(gpSubjectLens('chase', 18)).toBeNull();
    expect(gpSubjectLens('cockpit', 18)).toBeNull();
    expect(gpSubjectLens('trackside', NaN)).toBeNull();
    const camera = new T.PerspectiveCamera(18, 16 / 9, 0.1, 2000);
    camera.position.set(0, 4, 0);
    camera.lookAt(0, 4, -1);
    const pass = new DepthOfFieldPass(
      camera,
      { focus: 10, aperture: 0, maxblur: 0.004 },
      new T.DepthTexture(4, 4),
      { thinLens: true },
    );
    focusOnSubject(pass, camera, new T.Vector3(0, 4, -40), GP_TRACKSIDE_LENS, new T.Vector3());
    const u = pass.materialBokeh.uniforms;
    const k = GP_TRACKSIDE_LENS.thinLens!.fixedK!;
    expect(u.lensK.value).toBe(k);
    expect(u.maxblur.value).toBe(GP_TRACKSIDE_LENS.maxblur);
    // c(d) = K (1 - s/d): sharp at focus, half at twice the focus, K far away.
    const coc = (d: number) =>
      Math.min(GP_TRACKSIDE_LENS.maxblur, Math.abs(k * (1 - u.focus.value / d))) * 720;
    expect(coc(40)).toBe(0);
    expect(coc(80)).toBeCloseTo(k * 0.5 * 720, 9);
    expect(coc(2000)).toBeGreaterThan(3);
    expect(coc(2000)).toBeLessThan(GP_TRACKSIDE_LENS.maxblur * 720 + 1e-9);
    // Stronger than the shared broadcast lens, which this does not change.
    focusOnSubject(pass, camera, new T.Vector3(0, 4, -40), BROADCAST_LENS, new T.Vector3());
    expect(u.lensK.value).toBeLessThan(k / 5);
    pass.dispose();
  });

  it('frames a GP motorcycle on a long lens while cars keep the broadcast policy', () => {
    const aspect = 16 / 9;
    for (const distance of [40, 60, 90, 130]) {
      const car = tracksideFraming(distance, 40, aspect),
        legacy = tracksideFraming(distance, 40, aspect, 3.1, false, TELEPHOTO),
        bike = tracksideFraming(
          distance,
          40,
          aspect,
          GP_TELEPHOTO.subjectRadius,
          false,
          GP_TELEPHOTO,
        );
      expect(legacy).toEqual(car);
      expect(car.fov).toBeGreaterThanOrEqual(TELEPHOTO.minFov);
      expect(bike.fov).toBeLessThan(car.fov);
      expect(bike.fov).toBeGreaterThanOrEqual(GP_TELEPHOTO.minFov);
      expect(bike.fits).toBe(true);
      // A 1.15 m machine-and-rider height fills a third to a half of the frame
      // (REF_027/030/031) wherever the minimum lens does not bind.
      const share = 1.15 / (2 * distance * Math.tan((bike.fov * Math.PI) / 360));
      expect(share).toBeGreaterThan(distance <= 60 ? 0.3 : 0.15);
      expect(share).toBeLessThan(0.55);
    }
    // A car-sized subject is still rejected below the car sphere by the car lens.
    expect(() => tracksideFraming(60, 40, aspect, 1.2)).toThrow();
  });

  it('opens clear GP days under a clear sky only where the venue ramp opens with cloud', () => {
    const green = SKY_RAMPS.green.day;
    const ramp = withClearSky(green);
    expect(ramp[0]).toEqual({ id: GP_CLEAR_SKY, cover: 0.2, skyline: GP_CLEAR_SKYLINE });
    expect(ramp.slice(1)).toEqual([...green]);
    expect(withClearSky(green)).toBe(ramp);
    // The clear preset (0.12) shows it alone; changeable and rain keep the venue's.
    expect(skyBlend(ramp, 0.12)).toEqual({ a: GP_CLEAR_SKY, b: GP_CLEAR_SKY, weight: 0 });
    expect(skyBlend(ramp, 0.95)).toEqual(skyBlend(green, 0.95));
    expect(skyBlend(ramp, 0.6)).toEqual(skyBlend(green, 0.6));
    for (const palette of ['coast', 'arid', 'alpine', 'desert'] as const)
      expect(withClearSky(SKY_RAMPS[palette].day)).toBe(SKY_RAMPS[palette].day);
    const sky = new PhotoSky('green');
    const key = sky.key;
    sky.clearDay = GP_CLEAR_SKY;
    // Captures re-bin when the GP clear sky is switched on (skies enabled).
    if (key) expect(sky.key).not.toBe(key);
    else expect(sky.key).toBe('');
    sky.dispose();
  });

  it('spin-blurs GP wheel discs along their arc while chassis and fork stay locked', () => {
    // One followed GP-R1 heading +Z at 30 m/s, camera attached behind it.
    const frame = new Float32Array(HEADER + 3 * CAR_STRIDE);
    frame[H.TIME] = 10;
    frame[H.CARS] = 3;
    const spec = VEHICLES.gpr1.bike!;
    for (const [id, x, z, vehicle, lean] of [
      [0, 0, 0, 'gpr1', 0],
      [1, 3, 40, 'gpr2', 0],
      [2, -2, 8, 'gpr1', 1.4],
    ] as const) {
      const o = carBase(id);
      frame[o + F.X] = x;
      frame[o + F.Y] = spec.cgHeight;
      frame[o + F.Z] = z;
      frame[o + F.QW] = 1;
      frame[o + F.VZ] = 30;
      frame[o + F.SPEED] = 30;
      frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
      frame[o + BIKE_BASE + B.LEAN] = lean;
      frame[o + WHEEL_BASE + 0 * WHEEL_STRIDE + W.OMEGA] = 30 / spec.frontWheelRadius;
      frame[o + WHEEL_BASE + 2 * WHEEL_STRIDE + W.OMEGA] = 30 / spec.rearWheelRadius;
    }
    const size = new T.Vector2(1280, 720);
    const camera = new T.PerspectiveCamera(43, size.x / size.y, 0.05, 5000);
    camera.position.set(1.2, 1.1, -3.2);
    camera.lookAt(0, 0.4, 6);
    camera.updateMatrixWorld(true);
    const uniforms = createStudioUniforms();
    const sun = new T.DirectionalLight();
    sun.position.set(-140, 235, -115);
    sun.updateMatrixWorld(true);
    new StudioFrame(uniforms).update(frame, camera, sun, 'test');
    const field = new MotionField();
    const shutter = shutterSeconds(0.56);
    const run = (wheels: number) => {
      field.wheelCount = wheels;
      field.update(
        frame,
        camera,
        0,
        'attached',
        shutter,
        uniforms.studioCarNow.value,
        uniforms.studioCarPose.value,
        uniforms.studioCarCount.value,
      );
    };
    // The nearest standing bikes only: the fallen bike is skipped, the
    // followed bike comes first, the far rival second.
    const count = gpMotionWheels(frame, 1.2, 1.1, -3.2, field.wheels);
    expect(count).toBe(4);
    expect(field.wheels.slice(0, 4).map((w) => w.car)).toEqual([0, 0, 1, 1]);
    const rear = field.wheels[1];
    expect(rear.centre.toArray()).toEqual([...VEHICLES.gpr1.wheelPositions[2]]);
    expect(rear.radius).toBe(spec.rearWheelRadius);
    run(count);
    // Rear tyre crown (top of the wheel, chassis frame) streaks by ω r s.
    const centre = new T.Vector3(...VEHICLES.gpr1.wheelPositions[2]).add(
      new T.Vector3(0, spec.cgHeight, 0),
    );
    const top = centre.clone().add(new T.Vector3(0, spec.rearWheelRadius * 0.95, 0));
    const turned = top
      .clone()
      .sub(centre)
      .applyAxisAngle(new T.Vector3(1, 0, 0), -rear.omega * shutter)
      .add(centre);
    const now = top.clone().project(camera),
      before = turned.clone().project(camera);
    const expected = new T.Vector2(
      ((now.x - before.x) * size.x) / 2,
      ((now.y - before.y) * size.y) / 2,
    );
    const measured = field.pixels(top, camera, size);
    expect(expected.length()).toBeGreaterThan(3);
    expect(measured.x).toBeCloseTo(expected.x, 4);
    expect(measured.y).toBeCloseTo(expected.y, 4);
    // Chassis above the wheel, and the fork/swingarm plane beside the disc, stay locked.
    expect(field.pixels(new T.Vector3(0, spec.cgHeight + 0.3, 0), camera, size).length()).toBe(0);
    const beside = top.clone().add(new T.Vector3(0.13, 0, 0));
    expect(field.pixels(beside, camera, size).length()).toBeLessThan(1e-6);
    // Without discs the same tyre point is as still as its locked chassis.
    run(0);
    expect(field.pixels(top, camera, size).length()).toBeLessThan(1e-6);
    // Non-GP vehicles get no discs.
    frame[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    frame[carBase(0) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    expect(gpMotionWheels(frame, 1.2, 1.1, -3.2, field.wheels)).toBe(0);
  });
});
