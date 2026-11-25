import { clamp, lerp } from '../../core/math.ts';
import {
  B, BIKE_BASE, MX_FOOT, MX_FOOT_TRAJECTORY as S, R, RACE_BASE, hasMxFootControls,
} from '../../simulation/protocol.ts';
import {
  MX_GEAR_EVENT_MODULUS, sampleMxGearChannel, type MxGearChannel,
} from '../../simulation/offroad/mx-gear-stroke.ts';

const footFields = [MX_FOOT.ANGLE, MX_FOOT.COVER, MX_FOOT.CLEAR] as const;
const seedFields = [S.DIRECTION, S.ANGLE, S.COVER, S.CLEAR, S.ANGLE_RATE, S.COVER_RATE, S.CLEAR_RATE] as const;

function endpoint(frame: Float32Array, car: number, channel: MxGearChannel) {
  const value = frame[car + footFields[channel]];
  return hasMxFootControls(frame, car) && Number.isFinite(value)
    ? clamp(value, channel === 0 ? -.24 : 0, channel === 0 ? .22 : 1) : 0;
}

function recorded(frame: Float32Array, car: number, channel: MxGearChannel, age: number, velocity = false) {
  return sampleMxGearChannel(frame[car + S.DIRECTION], Math.max(0, age), channel,
    frame[car + S.ANGLE + channel], frame[car + S.ANGLE_RATE + channel],
    frame[car + S.COVER], frame[car + S.COVER_RATE], velocity);
}

function validTrajectory(frame: Float32Array, car: number) {
  if (frame[car + S.RECORDED] !== 1 || !hasMxFootControls(frame, car)) return false;
  const event = frame[car + S.EVENT], direction = frame[car + S.DIRECTION], age = frame[car + S.AGE];
  if (!Number.isInteger(event) || event < 0 || event >= MX_GEAR_EVENT_MODULUS ||
      (direction !== -1 && direction !== 0 && direction !== 1) || !Number.isFinite(age) || age < 0 ||
      !Number.isFinite(frame[car + S.CLOCK_HI]) || !Number.isFinite(frame[car + S.CLOCK_LO])) return false;
  for (let channel = 0; channel < 3; channel++) {
    const value = frame[car + S.ANGLE + channel], rate = frame[car + S.ANGLE_RATE + channel];
    if (!Number.isFinite(value) || !Number.isFinite(rate) || value < (channel === 0 ? -.24 : 0) ||
        value > (channel === 0 ? .22 : 1) || (!direction && (value !== 0 || rate !== 0 || age !== 0))) return false;
    // A partial/corrupt optional seed must not replace its measured endpoint.
    // This tolerance covers Float32 seed/age rounding, not mesh penetration.
    const position = frame[car + footFields[channel]];
    if (!Number.isFinite(position) ||
        Math.abs(recorded(frame, car, channel as MxGearChannel, age) - position) > 2e-5) return false;
  }
  return true;
}

function sameSeed(a: Float32Array, b: Float32Array, car: number) {
  for (const field of seedFields) if (a[car + field] !== b[car + field]) return false;
  return true;
}

function joinsPrevious(a: Float32Array, b: Float32Array, car: number, age: number) {
  for (let channel = 0; channel < 3; channel++) {
    const value = recorded(a, car, channel as MxGearChannel, age);
    const rate = recorded(a, car, channel as MxGearChannel, age, true);
    if (Math.abs(value - b[car + S.ANGLE + channel]) > 4e-5 ||
        Math.abs(rate - b[car + S.ANGLE_RATE + channel]) > 1e-3 + Math.abs(rate) * 2e-5) return false;
  }
  return true;
}

/** Reconstruct one channel of the accepted command's original trajectory.
 * Every channel uses the same event boundary and route, including an outward
 * waypoint hidden between 30/60 Hz endpoints. No render clock, history, spring
 * or allocation is involved. Legacy unmarked pairs keep their linear contract.
 * Missing events, resets and gaps over 125 ms select a complete measured pose;
 * joining their three positions would invent a potentially unsafe boot path. */
export function sampleMxFootField(a: Float32Array, b: Float32Array, car: number, field: number, t: number) {
  if (field !== MX_FOOT.ANGLE && field !== MX_FOOT.COVER && field !== MX_FOOT.CLEAR) return 0;
  const channel = (field - MX_FOOT.ANGLE) as MxGearChannel;
  const start = endpoint(a, car, channel), end = endpoint(b, car, channel);
  if (!Number.isFinite(t) || t <= 0 || a === b) return start;
  if (t >= 1) return end;
  const markedA = a[car + S.RECORDED] !== 0, markedB = b[car + S.RECORDED] !== 0;
  // Older recordings release/reapply controls linearly across rider states.
  // An inactive endpoint is neutral, even though it has no active controls.
  if (!markedA && !markedB) return lerp(start, end, t);
  const fallback = t < .5 ? start : end;
  if (!hasMxFootControls(a, car) || !hasMxFootControls(b, car)) return fallback;
  const validA = validTrajectory(a, car), validB = validTrajectory(b, car);
  if ((markedA && !validA) || (markedB && !validB)) return fallback;
  if (!validA || !validB) return lerp(start, end, t);
  const dt = (b[car + S.CLOCK_HI] - a[car + S.CLOCK_HI]) + (b[car + S.CLOCK_LO] - a[car + S.CLOCK_LO]);
  if (!(dt > 0 && dt <= .125 + 1e-9) ||
      a[car + RACE_BASE + R.VEHICLE] !== b[car + RACE_BASE + R.VEHICLE] ||
      a[car + BIKE_BASE + B.CRASHES] !== b[car + BIKE_BASE + B.CRASHES] ||
      b[car + BIKE_BASE + B.STATE_CLOCK] < a[car + BIKE_BASE + B.STATE_CLOCK]) return fallback;
  const ageA = a[car + S.AGE], ageB = b[car + S.AGE];
  const events = (b[car + S.EVENT] - a[car + S.EVENT] + MX_GEAR_EVENT_MODULUS) % MX_GEAR_EVENT_MODULUS;
  const ageTolerance = Math.max(2e-7, 2 ** -22 * Math.max(ageA, ageB));
  if (events === 0) {
    if (!sameSeed(a, b, car)) return fallback;
    if (a[car + S.DIRECTION] === 0) return 0;
    if (Math.abs(ageB - ageA - dt) > ageTolerance) return fallback;
    return recorded(a, car, channel, lerp(ageA, ageB, t));
  }
  if (events !== 1 || b[car + S.DIRECTION] === 0 || ageB > dt + ageTolerance) return fallback;
  const atEvent = ageA + dt - ageB;
  if (!joinsPrevious(a, b, car, atEvent)) return fallback;
  const afterEvent = ageB - (1 - t) * dt;
  return afterEvent >= 0 ? recorded(b, car, channel, afterEvent)
    : recorded(a, car, channel, ageA + t * dt);
}

export function sanitizeMxFootPose(frame: Float32Array, car: number) {
  if (!hasMxFootControls(frame, car)) return;
  for (let channel = 0; channel < 3; channel++)
    frame[car + footFields[channel]] = endpoint(frame, car, channel as MxGearChannel);
  if (frame[car + S.RECORDED] !== 0 && !validTrajectory(frame, car))
    frame.fill(0, car + S.RECORDED, car + S.CLOCK_LO + 1);
}

export function writeMxFootPose(out: Float32Array, a: Float32Array, b: Float32Array, car: number, t: number) {
  for (const field of footFields) out[car + field] = sampleMxFootField(a, b, car, field, t);
  // A display sample has moved away from the original measured seed age.
  // Do not expose that copied metadata as another authoritative snapshot.
  if (t > 0 && t < 1 && a !== b) out.fill(0, car + S.RECORDED, car + S.CLOCK_LO + 1);
}
