import * as T from 'three';
import { F, carBase } from '../../simulation/protocol.ts';
import { STUDIO_CAR_HALF_EXTENTS, STUDIO_MAX_CARS, studioUniforms } from './studio-frame.ts';

/**
 * Screen-space velocity for the camera motion blur (post-motion, D05).
 *
 * The velocity of a pixel is the screen displacement of its surface across the
 * shutter interval, reconstructed from the depth buffer: no velocity render, no
 * extra draw call. A pixel inside a car's oriented box moves rigidly with that
 * car; every other pixel is static world, so only the camera moves it.
 *
 * Motion is the *instantaneous* presented motion, not a frame difference: each
 * car's pose at shutter-open is its presented pose moved back along its own
 * presented linear and angular velocity (world frame) by the shutter time. The
 * streak length is therefore the same at 20 or 144 frames per second, held and
 * paused frames reproduce exactly (they present the same snapshot), and nothing
 * accumulates across frames, so there is no history to invalidate on a cut.
 *
 * Camera models:
 *  - attached (cockpit, chase, T-cam): the camera rides the followed car, so
 *    the world streaks against the car's motion and the car itself is still.
 *  - pan (trackside and broadcast): the camera stays put and turns to hold the
 *    followed car; the background streaks as in a panned photograph.
 *  - still (menu, photo, held replay): no motion at all.
 * The followed car is always locked to the camera (zero velocity): the player
 * car stays sharp while the track streaks, which is the F1 broadcast look.
 *
 * Spinning wheels (GP motorcycles, `MotionField.wheels`): a pixel inside a
 * wheel disc (its chassis-frame centre, axle along chassis X, radius and half
 * width) also turns back about the axle by its presented spin over the
 * shutter, so tread, sidewall, rim and disc streak along their arc while the
 * chassis, fork and swingarm stay as sharp as their car. Up to
 * `MOTION_MAX_WHEELS` discs; Formula wheels keep their material-level blur.
 */
export const MOTION_BLUR = Object.freeze({
  /** Gather taps along the streak (PRODUCTION_PLAN P10). */
  taps: 12,
  /** Longest streak as a fraction of the render width (about 45 px at 1280). */
  maxWidth: 0.035,
  /** Shutter strength is a fraction of one frame at this rate (0.35 → 1/171 s). */
  referenceRate: 60,
  /** Settings slider bound; also the largest accepted strength. */
  maxStrength: 0.6,
  /** Car box: margin around the studio footprint and the height band above the
   * tyre contacts (metres). The road under a car stays static world. */
  boxMargin: 0.06,
  boxFloor: 0.015,
  boxTop: 1.33,
});

export type MotionCamera = 'attached' | 'pan' | 'still';

/** Spinning wheel discs the field can carry (three motorcycles). */
export const MOTION_MAX_WHEELS = 6;
/** Largest wheel turn gathered over the shutter, radians. The streak is a
 * straight gather between the shutter-open and current points; at racing
 * speed a wheel turns ~160 degrees in 1/100 s, whose chord would cut through
 * the hub. 0.6 rad keeps the streak on the tangent, and its length at the
 * rim is still beyond the streak cap (`maxWidth`) in close views. */
export const MOTION_MAX_WHEEL_TURN = 0.6;
/** A spinning wheel of car `car`, in that car's chassis frame (axle along X). */
export interface MotionWheel {
  car: number;
  centre: T.Vector3;
  radius: number;
  halfWidth: number;
  /** Spin about the axle, rad/s (the streak is symmetric: its sign is free). */
  omega: number;
}

/** Camera rig → motion model. Anything not a live driving view is still. */
export function motionCameraFor(mode: string): MotionCamera {
  if (mode === 'cockpit' || mode === 'chase' || mode === 'pod') return 'attached';
  if (mode === 'trackside') return 'pan';
  return 'still';
}

/** Shutter time in seconds for a settings strength (fraction of a 60 Hz frame). */
export function shutterSeconds(strength: number) {
  return Number.isFinite(strength) && strength > 0
    ? Math.min(strength, MOTION_BLUR.maxStrength) / MOTION_BLUR.referenceRate
    : 0;
}

export interface MotionUniforms {
  /** 1 while a motion model applies this frame; 0 skips all velocity work. */
  motionActive: T.IUniform<number>;
  motionCars: T.IUniform<number>;
  /** View space → unit box space of each car (inside when every |coord| < 1). */
  motionBox: T.IUniform<T.Matrix4[]>;
  /** View space → clip space at shutter-open for a point on each car. */
  motionPrev: T.IUniform<T.Matrix4[]>;
  /** View space → clip space at shutter-open for static world. */
  motionWorldPrev: T.IUniform<T.Matrix4>;
  /** The current (unjittered) projection. */
  motionProjection: T.IUniform<T.Matrix4>;
  /** Streak length limit in pixels. */
  motionMaxPixels: T.IUniform<number>;
  motionWheels: T.IUniform<number>;
  /** View space → unit disc space of each wheel (inside: |x| < 1, y² + z² < 1). */
  motionWheelBox: T.IUniform<T.Matrix4[]>;
  /** View space → clip space at shutter-open for a point on each wheel. */
  motionWheelPrev: T.IUniform<T.Matrix4[]>;
}

export function createMotionUniforms(): MotionUniforms {
  return {
    motionActive: { value: 0 },
    motionCars: { value: 0 },
    motionBox: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4()) },
    motionPrev: { value: Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4()) },
    motionWorldPrev: { value: new T.Matrix4() },
    motionProjection: { value: new T.Matrix4() },
    motionMaxPixels: { value: 0 },
    motionWheels: { value: 0 },
    motionWheelBox: { value: Array.from({ length: MOTION_MAX_WHEELS }, () => new T.Matrix4()) },
    motionWheelPrev: { value: Array.from({ length: MOTION_MAX_WHEELS }, () => new T.Matrix4()) },
  };
}

/**
 * GLSL: `vec2 motionPixels(vec3 viewPosition, vec2 resolution)` returns the
 * pixel displacement of a view-space surface point from shutter-open to now
 * (unclamped). Requires the `MotionUniforms` declarations below.
 */
export const MOTION_VELOCITY_GLSL = /* glsl */ `
  #define MOTION_MAX_CARS ${STUDIO_MAX_CARS}
  uniform float motionActive;
  uniform int motionCars;
  uniform mat4 motionBox[MOTION_MAX_CARS];
  uniform mat4 motionPrev[MOTION_MAX_CARS];
  uniform mat4 motionWorldPrev;
  uniform mat4 motionProjection;
  uniform float motionMaxPixels;
  #define MOTION_MAX_WHEELS ${MOTION_MAX_WHEELS}
  uniform int motionWheels;
  uniform mat4 motionWheelBox[MOTION_MAX_WHEELS];
  uniform mat4 motionWheelPrev[MOTION_MAX_WHEELS];
  vec2 motionPixels(vec3 p, vec2 resolution) {
    vec4 position = vec4(p, 1.0);
    mat4 previous = motionWorldPrev;
    bool wheel = false;
    for (int i = 0; i < MOTION_MAX_WHEELS; i++) {
      if (i >= motionWheels) break;
      vec3 disc = (motionWheelBox[i] * position).xyz;
      if (abs(disc.x) < 1.0 && dot(disc.yz, disc.yz) < 1.0) {
        previous = motionWheelPrev[i];
        wheel = true;
        break;
      }
    }
    for (int i = 0; i < MOTION_MAX_CARS; i++) {
      if (wheel || i >= motionCars) break;
      vec3 box = abs((motionBox[i] * position).xyz);
      if (max(box.x, max(box.y, box.z)) < 1.0) { previous = motionPrev[i]; break; }
    }
    vec4 now = motionProjection * position;
    vec4 before = previous * position;
    if (now.w < 1e-4 || before.w < 1e-4) return vec2(0.0);
    return (now.xy / now.w - before.xy / before.w) * 0.5 * resolution;
  }
`;

const UNIT = new T.Vector3(1, 1, 1);

/**
 * CPU half: builds the per-frame matrices from the presented snapshot. Car
 * chassis matrices come from render-core's StudioFrame (`studioCarNow`,
 * `studioCarPose`), which the renderer updates earlier in the same frame.
 */
export class MotionField {
  readonly uniforms = createMotionUniforms();
  /** Last applied model, for diagnostics. */
  camera: MotionCamera = 'still';
  private readonly prevCars = Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4());
  private readonly relative = Array.from({ length: STUDIO_MAX_CARS }, () => new T.Matrix4());
  private readonly position = new T.Vector3();
  private readonly quaternion = new T.Quaternion();
  private readonly spin = new T.Quaternion();
  private readonly axis = new T.Vector3();
  private readonly inverse = new T.Matrix4();
  private readonly prevCamera = new T.Matrix4();
  private readonly prevView = new T.Matrix4();
  private readonly scratch = new T.Matrix4();
  private readonly from = new T.Vector3();
  private readonly to = new T.Vector3();
  private readonly eye = new T.Vector3();
  private readonly spinMatrix = new T.Matrix4();
  private readonly spinOffset = new T.Matrix4();
  private readonly cameraInverse = new T.Matrix4();
  /** Spinning wheel discs for the next `update` (the first `wheelCount`);
   * the renderer fills them from the presented snapshot each frame. */
  readonly wheels: MotionWheel[] = Array.from({ length: MOTION_MAX_WHEELS }, () => ({
    car: -1,
    centre: new T.Vector3(),
    radius: 0,
    halfWidth: 0,
    omega: 0,
  }));
  wheelCount = 0;

  /** No motion this frame: velocity is exactly zero everywhere. */
  still() {
    this.camera = 'still';
    this.uniforms.motionActive.value = 0;
  }

  /**
   * @param presented presented snapshot (positions, quaternions, VX..VZ, WX..WZ)
   * @param camera main camera with current world and projection matrices
   * @param follow followed car id (locked to the camera)
   * @param model camera model for this view
   * @param shutter shutter time in seconds (0 → still)
   */
  update(
    presented: Float32Array,
    camera: T.Camera,
    follow: number,
    model: MotionCamera,
    shutter: number,
    carNow: readonly T.Matrix4[] = studioUniforms.studioCarNow.value,
    poses: readonly T.Vector4[] = studioUniforms.studioCarPose.value,
    count: number = studioUniforms.studioCarCount.value,
  ) {
    const u = this.uniforms;
    const cars = Math.max(0, Math.min(STUDIO_MAX_CARS, Math.floor(count)));
    if (model === 'still' || !(shutter > 0) || !Number.isFinite(shutter)) return this.still();
    this.camera = model;
    const cameraWorld = camera.matrixWorld;
    // Each car's chassis at shutter-open, and the rigid map now → shutter-open.
    for (let id = 0; id < cars; id++) {
      const o = carBase(id);
      const now = carNow[id];
      this.position.setFromMatrixPosition(now);
      this.quaternion.setFromRotationMatrix(now);
      const vx = presented[o + F.VX] || 0,
        vy = presented[o + F.VY] || 0,
        vz = presented[o + F.VZ] || 0;
      this.position.x -= vx * shutter;
      this.position.y -= vy * shutter;
      this.position.z -= vz * shutter;
      // World-frame angular velocity: q(t - s) = rot(-ω s) · q(t).
      this.axis.set(presented[o + F.WX] || 0, presented[o + F.WY] || 0, presented[o + F.WZ] || 0);
      const rate = this.axis.length();
      if (rate > 1e-6 && Number.isFinite(rate)) {
        this.spin.setFromAxisAngle(this.axis.divideScalar(rate), -rate * shutter);
        this.quaternion.premultiply(this.spin);
      }
      this.prevCars[id].compose(this.position, this.quaternion, UNIT);
      this.relative[id].copy(this.prevCars[id]).multiply(this.inverse.copy(now).invert());
    }
    const locked = follow >= 0 && follow < cars;
    // Camera at shutter-open.
    this.prevCamera.copy(cameraWorld);
    if (locked && model === 'attached') this.prevCamera.premultiply(this.relative[follow]);
    else if (locked && model === 'pan') {
      // Turn about the eye from the followed car's shutter-open position to its
      // current one: the car holds its place on screen, the world streaks.
      this.eye.setFromMatrixPosition(cameraWorld);
      this.from.setFromMatrixPosition(carNow[follow]).sub(this.eye);
      this.to.setFromMatrixPosition(this.prevCars[follow]).sub(this.eye);
      if (this.from.lengthSq() > 1e-6 && this.to.lengthSq() > 1e-6) {
        this.spin.setFromUnitVectors(this.from.normalize(), this.to.normalize());
        this.scratch.makeRotationFromQuaternion(this.spin);
        this.prevCamera
          .premultiply(this.inverse.makeTranslation(-this.eye.x, -this.eye.y, -this.eye.z))
          .premultiply(this.scratch)
          .premultiply(this.inverse.makeTranslation(this.eye.x, this.eye.y, this.eye.z));
      }
    }
    this.prevView.copy(this.prevCamera).invert();
    const projection = u.motionProjection.value.copy(camera.projectionMatrix);
    // Static world: view → world → shutter-open view → clip.
    u.motionWorldPrev.value.multiplyMatrices(projection, this.prevView).multiply(cameraWorld);
    const { length, width } = STUDIO_CAR_HALF_EXTENTS;
    const halfLength = length + MOTION_BLUR.boxMargin,
      halfWidth = width + MOTION_BLUR.boxMargin,
      halfHeight = (MOTION_BLUR.boxTop - MOTION_BLUR.boxFloor) / 2;
    for (let id = 0; id < cars; id++) {
      const now = carNow[id];
      // Box centre height in chassis space: tyre contacts (groundY) + band middle.
      const centre = poses[id].w - now.elements[13] + MOTION_BLUR.boxFloor + halfHeight;
      u.motionBox.value[id]
        .makeScale(1 / halfWidth, 1 / halfHeight, 1 / halfLength)
        .multiply(this.inverse.makeTranslation(0, -centre, 0))
        .multiply(this.scratch.copy(now).invert())
        .multiply(cameraWorld);
      const prev = u.motionPrev.value[id];
      if (locked && id === follow) prev.copy(projection);
      else
        prev
          .multiplyMatrices(projection, this.prevView)
          .multiply(this.relative[id])
          .multiply(cameraWorld);
    }
    u.motionCars.value = cars;
    // Wheels: view → chassis → about the axle back by ω·shutter → the car's
    // own shutter-open map. Discs of cars outside this frame are skipped.
    let wheels = 0;
    this.cameraInverse.copy(cameraWorld).invert();
    for (let i = 0; i < Math.min(this.wheelCount, MOTION_MAX_WHEELS); i++) {
      const w = this.wheels[i];
      if (!(w.car >= 0 && w.car < cars) || !(w.radius > 0) || !(w.halfWidth > 0)) continue;
      if (![w.centre.x, w.centre.y, w.centre.z, w.omega].every(Number.isFinite)) continue;
      const now = carNow[w.car];
      const toChassis = this.inverse.copy(now).invert().multiply(cameraWorld);
      u.motionWheelBox.value[wheels]
        .makeScale(1 / w.halfWidth, 1 / w.radius, 1 / w.radius)
        .multiply(this.scratch.makeTranslation(-w.centre.x, -w.centre.y, -w.centre.z))
        .multiply(toChassis);
      // Spin in view space: camera⁻¹ · now · T(c) · Rx(-ω s) · T(-c) · now⁻¹ · camera.
      this.spinMatrix
        .makeTranslation(w.centre.x, w.centre.y, w.centre.z)
        .multiply(
          this.scratch.makeRotationX(
            -Math.max(-MOTION_MAX_WHEEL_TURN, Math.min(MOTION_MAX_WHEEL_TURN, w.omega * shutter)),
          ),
        )
        .multiply(this.spinOffset.makeTranslation(-w.centre.x, -w.centre.y, -w.centre.z));
      u.motionWheelPrev.value[wheels]
        .copy(u.motionPrev.value[w.car])
        .multiply(this.cameraInverse)
        .multiply(now)
        .multiply(this.spinMatrix)
        .multiply(toChassis);
      wheels++;
    }
    u.motionWheels.value = wheels;
    u.motionActive.value = 1;
  }

  /** CPU reference of `motionPixels` for a world point (tests and diagnostics). */
  pixels(world: T.Vector3, camera: T.Camera, resolution: T.Vector2, out = new T.Vector2()) {
    const u = this.uniforms;
    if (!u.motionActive.value) return out.set(0, 0);
    const p = new T.Vector4(world.x, world.y, world.z, 1).applyMatrix4(camera.matrixWorldInverse);
    let previous = u.motionWorldPrev.value,
      wheel = false;
    for (let i = 0; i < u.motionWheels.value; i++) {
      const disc = p.clone().applyMatrix4(u.motionWheelBox.value[i]);
      if (Math.abs(disc.x) < 1 && disc.y * disc.y + disc.z * disc.z < 1) {
        previous = u.motionWheelPrev.value[i];
        wheel = true;
        break;
      }
    }
    for (let id = 0; id < u.motionCars.value && !wheel; id++) {
      const box = p.clone().applyMatrix4(u.motionBox.value[id]);
      if (Math.max(Math.abs(box.x), Math.abs(box.y), Math.abs(box.z)) < 1) {
        previous = u.motionPrev.value[id];
        break;
      }
    }
    const now = p.clone().applyMatrix4(u.motionProjection.value);
    const before = p.clone().applyMatrix4(previous);
    if (now.w < 1e-4 || before.w < 1e-4) return out.set(0, 0);
    return out.set(
      (now.x / now.w - before.x / before.w) * 0.5 * resolution.x,
      (now.y / now.w - before.y / before.w) * 0.5 * resolution.y,
    );
  }
}
