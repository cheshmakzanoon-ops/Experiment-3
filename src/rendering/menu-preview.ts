import { Track, trackPoint } from '../simulation/track.ts';
import { DEFAULT_SETUP, VEHICLE } from '../simulation/config.ts';
import { vehicleDefinition, vehicleIndex } from '../simulation/vehicles.ts';
import { B, BIKE_BASE, R, RACE_BASE } from '../simulation/protocol.ts';
import {
  F,
  H,
  W,
  HEADER,
  CAR_STRIDE,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../simulation/protocol.ts';

/** Front-end showroom camera (D29, AB-B §4.2): a low 1.2 m eye, a 32 degree
 * lens and a slow orbit, the car framed right of the menu with the background
 * softly out of focus (the D09 depth-of-field pass, focused on the car). */
export const SHOWROOM = Object.freeze({
  height: 1.2,
  fov: 32,
  radius: 9.4,
  /** Orbit: base angle (rad, car frame), sway amplitude and rate (rad/s). */
  angle: 0.72,
  sway: 0.16,
  rate: 0.035,
  /** Aim this far left of the car (m, across the view) so it sits right of the menu. */
  shift: 1.35,
  /** Eye and aim heights above the road (m). */
  aim: 0.55,
  aperture: 0.0011,
  maxblur: 0.012,
});
/** Showroom lens for a four-wheel machine. The fixed 9.4 m orbit was authored for
 * a 4.2-5.7 m car: a 2.1 m kart filled a sixth of the frame, a 6.8 m pickup left
 * it on both edges. Inside that band the original SHOWROOM is returned unchanged;
 * smaller or larger machines scale radius, aim offset, eye and aim heights with
 * their length (collision-box length, m) so every machine fills the free
 * right-hand part of the frame about equally. */
const SHOWROOM_BAND = Object.freeze({ min: 4.2, max: 5.7, floor: 0.55, ceiling: 1.3 });
export function showroomFit(length: number) {
  if (!Number.isFinite(length) || length <= 0) return 1;
  const { min, max, floor, ceiling } = SHOWROOM_BAND;
  return length < min
    ? Math.max(floor, length / min)
    : length > max
      ? Math.min(ceiling, length / max)
      : 1;
}
export function showroomFor(length: number) {
  const fit = showroomFit(length);
  if (fit === 1) return SHOWROOM;
  return Object.freeze({
    ...SHOWROOM,
    radius: SHOWROOM.radius * fit,
    shift: SHOWROOM.shift * fit,
    height: SHOWROOM.height * (0.6 + 0.4 * fit),
    aim: SHOWROOM.aim * (0.7 + 0.3 * fit),
  });
}
/** The same three-quarter showroom composition scaled to a 2 m motorcycle. */
export const BIKE_SHOWROOM = Object.freeze({
  ...SHOWROOM,
  height: 1.12,
  fov: 34,
  radius: 4.8,
  shift: 0.76,
  aim: 0.72,
});

/** The preview car's origin above the road (FormulaCar hub anchor datum). */
export const MENU_CAR_DATUM = VEHICLE.restLength + VEHICLE.wheelRadius - 0.05;

/** Match the snapshot's Float32 value exactly when warming the showroom sky.
 * A zero-cover warmup leaves its cloud panorama and upper PMREM bin cold;
 * an unquantized 0.12 still forces a new atlas blend on the first draw. */
export const MENU_CLOUD_COVER = Math.fround(0.12);

/** An optional photo pose for a motorcycle's static presentation (vehicle art 3, the GP-R1
 * hero frame): lean, rider hang-off, front braking, speed and rotor temperature. Everything
 * else stays the plain showroom pose. Null for a car. */
export interface MenuPose {
  /** Chassis lean (rad, + left). */
  lean?: number;
  /** Rider hang-off from the centreline (m, + left). */
  riderOffset?: number;
  brake?: number;
  /** Speed (m/s) and carbon-rotor temperature (C): the disc glows from about 620 C. */
  speed?: number;
  discTemp?: number;
  /** Presented time (s): the knee-slider sparks are a function of it. */
  time?: number;
}
/** The corner hero frame of a GP prototype: 57 degrees of lean, the rider hung off by 25 cm,
 * a hand on the front brake, rotors glowing. Knee slider on the asphalt, sparks flying. */
export const GP_CORNER_PRESET: Readonly<MenuPose> = Object.freeze({
  lean: 1.0,
  riderOffset: 0.25,
  brake: 0.6,
  speed: 38,
  discTemp: 900,
  time: 3.3,
});

/** Static menu presentation, not a simulated or award-eligible driving session.
 * Keep the track coordinate, world pose and wheel dimensions consistent: the
 * studio/HQ floor samples F.S, not the position of an unrelated grid-start cell.
 * A bike carries its static suspension loads; no pose advances race time,
 * consumes fuel, or invents a simulated contact-work sample. */
export function menuPreview(
  track: Track,
  distance = track.length - 32,
  machine = 'apx01',
  pose?: MenuPose,
): Float32Array {
  if (!Number.isFinite(distance)) throw new Error('Invalid menu preview position');
  const frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  const definition = vehicleDefinition(machine),
    spec = definition.spec,
    bike = definition.bike;
  // Quantize the coordinate once, then derive world height from that same value.
  frame[o + F.S] = track.at(distance, trackPoint()).s;
  const p = track.at(frame[o + F.S], trackPoint()),
    yaw = Math.atan2(p.tx, p.tz);
  frame[H.CARS] = 1;
  frame[H.LENGTH] = track.length;
  frame[H.AMBIENT] = 24;
  frame[H.CLOUD] = MENU_CLOUD_COVER;
  frame[o + F.X] = p.x;
  // FormulaCar's actual hub anchor is +0.05 m; the wheel extends down by
  // restLength + radius. Previously the preview was a further 19 mm too low.
  frame[o + F.Y] = p.y + (bike ? bike.cgHeight : spec.restLength + spec.wheelRadius - 0.05);
  frame[o + F.Z] = p.z;
  frame[o + F.QY] = Math.sin(yaw / 2);
  frame[o + F.QW] = Math.cos(yaw / 2);
  frame[o + F.GEAR] = 1;
  frame[o + F.RPM] = spec.idleRPM;
  frame[o + F.FUEL] = bike?.fuel ?? 24;
  frame[o + F.BATTERY] = Math.min(3.2e6, spec.maxBatteryJ);
  frame[o + RACE_BASE + R.VEHICLE] = vehicleIndex(definition.id);
  if (bike) {
    // Match BikeModel's static sprung datum. This is an explicit showroom pose,
    // not a driveable session, and does not synthesize any lap or contact work.
    const mass = spec.dryMass + bike.fuel;
    const frontLoad = (mass * 9.81 * bike.cgToRear) / spec.wheelbase;
    const rearLoad = (mass * 9.81 * bike.cgToFront) / spec.wheelbase;
    frame[o + BIKE_BASE + B.FORK] = frontLoad / bike.forkRate;
    frame[o + BIKE_BASE + B.SHOCK] = rearLoad / bike.shockRate;
    frame[o + BIKE_BASE + B.FRONT_LOAD] = frontLoad;
    frame[o + BIKE_BASE + B.REAR_LOAD] = rearLoad;
    if (pose) {
      const lean = Number.isFinite(pose.lean) ? Math.max(-1.3, Math.min(1.3, pose.lean!)) : 0;
      frame[o + BIKE_BASE + B.LEAN] = lean;
      if (Number.isFinite(pose.riderOffset))
        frame[o + BIKE_BASE + B.RIDER_OFFSET] = pose.riderOffset!;
      if (Number.isFinite(pose.brake)) frame[o + F.BRAKE] = Math.max(0, Math.min(1, pose.brake!));
      if (Number.isFinite(pose.speed)) frame[o + F.SPEED] = pose.speed!;
      if (Number.isFinite(pose.time)) frame[H.TIME] = pose.time!;
      if (Number.isFinite(pose.discTemp))
        for (let i = 0; i < 4; i++)
          frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.DISC_TEMP] = pose.discTemp!;
      // The chassis pivots about its contact patch: roll the quaternion about the machine's own
      // forward axis (yaw first, then -lean about z) and swing the centre of gravity inboard.
      const sy = Math.sin(yaw / 2),
        cy = Math.cos(yaw / 2),
        sz = Math.sin(-lean / 2),
        cz = Math.cos(-lean / 2);
      frame[o + F.QX] = sy * sz;
      frame[o + F.QY] = sy * cz;
      frame[o + F.QZ] = cy * sz;
      frame[o + F.QW] = cy * cz;
      const cg = bike.cgHeight;
      frame[o + F.Y] = p.y + cg * Math.cos(lean);
      frame[o + F.X] = p.x + cg * Math.sin(lean) * Math.cos(yaw);
      frame[o + F.Z] = p.z - cg * Math.sin(lean) * Math.sin(yaw);
    }
  }
  frame[o + F.FRONT_HEALTH] = frame[o + F.REAR_HEALTH] = frame[o + F.FLOOR_HEALTH] = 1;
  frame[o + F.COMPOUND] = 1;
  for (let i = 0; i < 4; i++) {
    const w = o + WHEEL_BASE + i * WHEEL_STRIDE;
    frame[w + W.LENGTH] = spec.restLength;
    frame[w + W.RADIUS] = bike
      ? i < 2
        ? bike.frontWheelRadius
        : bike.rearWheelRadius
      : spec.wheelRadius;
    frame[w + W.PRESSURE] = i < 2 ? DEFAULT_SETUP.frontPressure : DEFAULT_SETUP.rearPressure;
  }
  return frame;
}

/** Editors freeze immediately. An Academy control or a real viewport resize
 * may request one invalidated frame; a generic editor action may not. Settings
 * ownership overrides both requests. The caller consumes the resize only after
 * a real submission, so GPU backpressure cannot discard a pending redraw. */
export function shouldDrawMenu(state: {
  covered: boolean;
  preview: boolean;
  invalidated: boolean;
  resizePending: boolean;
  settingsBusy: boolean;
}): boolean {
  return (
    !state.settingsBusy &&
    (!state.covered || (state.invalidated && (state.preview || state.resizePending)))
  );
}
