import { clamp, smooth } from '../core/math.ts';
import type { SubjectLens } from './studio/subject-focus.ts';

/**
 * GP photographic camera (W1 hyperrealism): the chase rig, its bounded
 * response to the bike's longitudinal load, a fine high-speed vibration and
 * the trackside broadcast lens, for a followed GP prototype only. Road bikes
 * keep motorcycle-camera.ts, motocross its own rig, cars the CHASE rig.
 *
 * Composition (REF_019/020/021 game chase, REF_055/077/089 broadcast chase):
 * the camera sits lower and closer behind the bike than the shared bike rig
 * (eye about 1.1 m above the road instead of 1.5 m) behind a longer lens
 * (43 degrees vertical instead of 51), so the rider and machine fill the lower
 * centre of the frame and the road compresses toward a horizon a little above
 * mid-frame. Distances are relative to the bike's centre of gravity.
 *
 * Dynamics (felt mass, REF_049/059/071): longitudinal load, filtered with a
 * fixed time constant in presented camera time, pulls the camera back under
 * drive (the bike surges away, then the rig catches up) and in under braking,
 * where the gaze also pitches forward toward the braking point. Both are
 * bounded, zero in reduced motion, and a pure function of presented state
 * plus the filter (reset on every camera cut), so replays reproduce them.
 */
export const GP_CHASE = Object.freeze({
  /** Eye height above the CG at rest, metres (shared bike rig: 0.88). */
  height: 0.6,
  heightPerMS: 0.0012,
  /** Rise of the eye under full brake, metres. */
  brakeRise: 0.06,
  /** Distance behind the CG at rest, metres (shared bike rig: 3.2). */
  distance: 2.95,
  distancePerMS: 0.003,
  lookAhead: 10,
  lookAheadPerMS: 0.06,
  lookAheadMax: 4.5,
  /** Gaze lift above the CG, metres: negative sets the bike lower in frame. */
  lookLift: -0.02,
  /** Vertical field of view, degrees, and its speed widening (cap). */
  fov: 43,
  fovGain: 4,
  /** Partial horizon roll with lean (shared bike rig: 0.35). */
  roll: 0.35,
  /** Low-pass time constant of the longitudinal load, seconds. */
  loadSeconds: 0.32,
  /** Pull-back per g of drive, and its bound (metres). */
  driveBack: 0.42,
  driveBackMax: 0.5,
  /** Close-in per g of braking, and its bound (metres). */
  brakeIn: 0.16,
  brakeInMax: 0.26,
  /** Forward gaze pitch per g of braking, and its bound (radians). */
  brakePitch: 0.022,
  brakePitchMax: 0.035,
  /** Fine vibration: speed where it starts / is full (m/s), amplitude of the
   * eye (metres) and of the gaze (metres at the look-ahead point) at full
   * camera-vibration setting, and its two incommensurate frequencies (Hz). */
  vibrationFrom: 30,
  vibrationFull: 85,
  vibrationEye: 0.004,
  vibrationGaze: 0.018,
  vibrationHz: Object.freeze([13.7, 21.9] as const),
});

/** Shutter multiplier on the motion-blur setting for GP views (clamped by
 * MOTION_BLUR.maxStrength): Medium 0.35 -> 0.56 (1/107 s), High 0.5 -> 0.6
 * (1/100 s), the 180-degree shutter of 50 Hz broadcast. REF_049/059/071
 * streak the background and wheels at speed. */
export const GP_SHUTTER = 1.6;

/** The GP chase rig for this frame (same shape as motorcycleChase). */
export function gpChase(speed: number, brake: number, lean: number, reducedMotion = false) {
  const v = Number.isFinite(speed) ? clamp(Math.abs(speed), 0, 110) : 0;
  const braking = Number.isFinite(brake) ? clamp(brake, 0, 1) : 0;
  const angle = Number.isFinite(lean) ? clamp(lean, -1.12, 1.12) : 0;
  const c = GP_CHASE;
  return {
    height: c.height + (reducedMotion ? 0 : c.brakeRise * braking),
    heightPerMS: reducedMotion ? 0 : c.heightPerMS,
    distance: c.distance,
    distancePerMS: reducedMotion ? 0 : c.distancePerMS,
    lookAhead: c.lookAhead + Math.min(c.lookAheadMax, v * c.lookAheadPerMS),
    lookLift: c.lookLift,
    fov: c.fov,
    fovGain: reducedMotion ? 0 : c.fovGain,
    // As motorcycleChase: ~0.22 s preview of the steady-turn rate, capped.
    yaw: reducedMotion
      ? 0
      : clamp((9.81 * Math.tan(angle) * 0.22) / Math.max(12, v), -0.11, 0.11) * Math.min(1, v / 8),
  };
}

/** Bounded, filtered chase response to longitudinal load plus vibration.
 * Allocation-free; `reset` on camera cuts, seeks and follow changes. */
export class GpChaseDynamics {
  /** Filtered longitudinal load, g (positive: drive). */
  load = 0;
  private primed = false;
  /** Outputs of the last `update`. */
  readonly out = { distance: 0, pitch: 0, eyeX: 0, eyeY: 0, gazeX: 0, gazeY: 0 };
  reset() {
    this.load = 0;
    this.primed = false;
    const o = this.out;
    o.distance = o.pitch = o.eyeX = o.eyeY = o.gazeX = o.gazeY = 0;
  }
  /**
   * `dt` presented camera seconds; `longG` the bike's longitudinal load (g);
   * `time` presented simulation time (vibration phase); `vibration` the
   * camera-vibration setting 0..1. Offsets are in the chase frame: distance
   * along the rig's back axis, pitch about its right axis, eye/gaze lateral
   * and vertical metres.
   */
  update(
    dt: number,
    longG: number,
    speed: number,
    time: number,
    vibration: number,
    reducedMotion: boolean,
  ) {
    const o = this.out,
      c = GP_CHASE;
    const g = Number.isFinite(longG) ? clamp(longG, -2.5, 2.5) : 0;
    if (!this.primed || !(dt >= 0) || !Number.isFinite(dt)) {
      this.load = g;
      this.primed = true;
    } else this.load += (g - this.load) * -Math.expm1(-Math.min(dt, 0.25) / c.loadSeconds);
    if (reducedMotion) {
      o.distance = o.pitch = o.eyeX = o.eyeY = o.gazeX = o.gazeY = 0;
      return o;
    }
    const drive = Math.max(0, this.load),
      braking = Math.max(0, -this.load);
    o.distance =
      Math.min(c.driveBackMax, drive * c.driveBack) - Math.min(c.brakeInMax, braking * c.brakeIn);
    o.pitch = Math.min(c.brakePitchMax, braking * c.brakePitch);
    const v = Number.isFinite(speed) ? Math.abs(speed) : 0;
    const amount =
      clamp(Number.isFinite(vibration) ? vibration : 0, 0, 1) *
      smooth(c.vibrationFrom, c.vibrationFull, v);
    if (amount > 0 && Number.isFinite(time)) {
      const [f1, f2] = c.vibrationHz,
        a = Math.sin(2 * Math.PI * f1 * time),
        b = Math.sin(2 * Math.PI * f2 * time + 1.3),
        d = Math.sin(2 * Math.PI * f2 * time * 0.71 + 2.1);
      o.eyeX = c.vibrationEye * amount * (0.6 * b + 0.4 * d);
      o.eyeY = c.vibrationEye * amount * (0.7 * a + 0.3 * b);
      o.gazeX = c.vibrationGaze * amount * (0.5 * a - 0.5 * d);
      o.gazeY = c.vibrationGaze * amount * (0.6 * d + 0.4 * a);
    } else o.eyeX = o.eyeY = o.gazeX = o.gazeY = 0;
    return o;
  }
}

/**
 * Trackside GP lens. The shared broadcast lens (a physical f/4 on a 2/3-inch
 * gate, below 20 degrees) leaves a 40 m trackside shot sharp to the horizon
 * (far circle about 0.3 px at 720p); so would any physical lens at the game's
 * camera distances (f/2.8 Super 35: about 0.7 px). The MotoGP references
 * (REF_008/022/027/030/035/042/046) separate the followed bike from the
 * stands, fence and verge behind it and soften near blockers. The GP lens
 * keeps the thin lens's distance-ratio response c(d) = K (1 - s/d), so blur
 * grows with depth RATIO (photographic, not the tilt-shift miniature of a
 * depth-difference blur), with a fixed far-field circle K: at twice the
 * focus distance 0.5 K, toward the horizon K (4 px at 720p), a blocker at
 * half the focus distance -K, all capped at `maxblur`. Reuses the scene
 * pass depth and the existing gather (no scene re-render; in-focus pixels
 * exit after one depth fetch).
 */
export const GP_TRACKSIDE_LENS: SubjectLens = Object.freeze({
  aperture: 0,
  maxblur: 0.008,
  thinLens: Object.freeze({ fNumber: 2.8, sensorHeight: 0.014, fixedK: 0.0055 }),
});
/** Widest trackside lens (vertical degrees) that still gets the GP lens. */
export const GP_TRACKSIDE_DOF_BELOW = 30;

/** The GP subject lens for a live camera (null: no depth of field). */
export function gpSubjectLens(camera: string, fov: number): SubjectLens | null {
  return camera === 'trackside' && Number.isFinite(fov) && fov < GP_TRACKSIDE_DOF_BELOW
    ? GP_TRACKSIDE_LENS
    : null;
}
