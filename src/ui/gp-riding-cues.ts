import { clamp, mod } from '../core/math.ts';
import { GP_MAX_TOW_DRAG_REDUCTION } from '../simulation/bike-slipstream.ts';
import { FLAG, yellowFlag } from '../simulation/marshal.ts';
import { B, BIKE_BASE, F, H, R, RACE_BASE, carBase } from '../simulation/protocol.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { vehicleAt } from '../simulation/vehicles.ts';
import { gpControlFeedback } from './gp-control-feedback.ts';
import { nearbyTraffic } from './proximity.ts';
import {
  gpCornerPhase,
  gpCornerShapes,
  type GPCornerPhase,
  type GPCornerShape,
} from './gp-corner-phases.ts';

export interface GPRidingCue {
  corner: string;
  direction: 'left' | 'right' | 'straight' | 'none';
  distance: string;
  action: string;
  detail: string;
  tone: 'neutral' | 'brake' | 'flow' | 'caution';
  tow: number;
  phase: GPCornerPhase;
  progress: number;
}

/** Recover the applied tow from the recorded drag, not the different dirty-air
 * WAKE channel. Project velocity along the bike heading to remove contact
 * slide: F.SPEED includes that slide but the longitudinal drag solver does not.
 * This is only a readout; it neither grants acceleration nor changes grip. */
export function gpTowFraction(frame: Float32Array) {
  const o = carBase(0),
    b = o + BIKE_BASE;
  if (frame.length <= b + B.STATE || frame[b + B.STATE] !== 0) return 0;
  const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
  if (definition.classId !== 'gp-bike' || !definition.bike) return 0;
  const qx = frame[o + F.QX],
    qy = frame[o + F.QY],
    qz = frame[o + F.QZ],
    qw = frame[o + F.QW];
  const fx = 2 * (qx * qz + qw * qy),
    fz = 1 - 2 * (qx * qx + qy * qy);
  const length = Math.hypot(fx, fz);
  if (!Number.isFinite(length) || length < 0.2) return 0;
  const forwardSpeed = (frame[o + F.VX] * fx + frame[o + F.VZ] * fz) / length;
  const drag = frame[o + F.DRAG],
    tuck = frame[b + B.TUCK];
  if (![forwardSpeed, drag, tuck].every(Number.isFinite) || forwardSpeed < 20 || drag <= 0)
    return 0;
  const soloDrag =
    definition.bike.drag * forwardSpeed ** 2 * (1 - clamp(tuck, 0, 1) * definition.bike.tuckDrag);
  return clamp((1 - drag / soloDrag) / GP_MAX_TOW_DRAG_REDUCTION, 0, 1);
}

/** Compact road-riding advice from the presented snapshot and named apexes.
 * Corner distances are explicitly to the apex, never claimed braking points.
 * No ideal-speed estimate, AI command, hidden score or wall clock is involved;
 * pause and replay seek reproduce the same cue immediately. */
export class GPRidingCues {
  private readonly road = trackPoint();
  private shapeTrack: Track | null = null;
  private shapes: readonly GPCornerShape[] = [];

  read(frame: Float32Array, track: Track): GPRidingCue | null {
    const o = carBase(0),
      b = o + BIKE_BASE;
    if (frame.length <= b + B.INTERVENTION || frame[H.CARS] < 1 || frame[H.PHASE] !== 2)
      return null;
    const definition = vehicleAt(Math.round(frame[o + RACE_BASE + R.VEHICLE]));
    if (
      definition.classId !== 'gp-bike' ||
      frame[o + F.RETIRED] ||
      frame[o + F.FINISH] ||
      frame[o + F.IN_PIT] ||
      frame[b + B.STATE] !== 0
    )
      return null;
    const station = frame[o + F.S],
      speed = frame[o + F.SPEED],
      lateral = frame[o + F.LATERAL],
      lean = Math.abs(frame[b + B.LEAN]),
      brake = frame[o + F.BRAKE],
      rearBrake = frame[b + B.REAR_BRAKE],
      throttle = frame[o + F.THROTTLE];
    if (
      ![station, speed, lateral, lean, brake, rearBrake, throttle].every(Number.isFinite) ||
      speed < 4
    )
      return null;
    track.at(station, this.road);
    const forward = frame[o + F.VX] * this.road.tx + frame[o + F.VZ] * this.road.tz;
    if (!Number.isFinite(forward)) return null;
    const onRoute = forward >= 2 && Math.abs(lateral) <= this.road.width + 0.3,
      control = gpControlFeedback(frame);
    // Corner and tow advice require progress along the circuit. Recovery,
    // puncture and brake warnings remain useful beyond the paved track edge.
    if (!onRoute && !control) return null;

    if (this.shapeTrack !== track) {
      this.shapes = gpCornerShapes(track);
      this.shapeTrack = track;
    }
    let cornerIndex = -1,
      distance = Infinity;
    // Retain the current corner through its sampled exit. A fixed 24 m
    // expiry used to announce a straight midway through long GP bends.
    // Each road-shaped window also wraps across the start/finish line.
    for (let i = 0; onRoute && i < track.circuit.corners.length; i++) {
      const exit = this.shapes[i].exit,
        d = mod(track.circuit.corners[i].s - station + exit, track.length) - exit;
      if (d < distance) {
        cornerIndex = i;
        distance = d;
      }
    }
    const close = cornerIndex >= 0 && distance < clamp(speed * 5 + 50, 180, 450);
    const cue: GPRidingCue = {
      corner: onRoute ? 'STRAIGHT' : 'BIKE CONTROL',
      direction: onRoute ? 'straight' : 'none',
      distance: '',
      action: 'BUILD YOUR RUN',
      detail: 'Build speed with smooth inputs',
      tone: 'neutral',
      tow: onRoute ? gpTowFraction(frame) : 0,
      phase: 'none',
      progress: 0,
    };
    if (close) {
      const corner = track.circuit.corners[cornerIndex],
        shape = this.shapes[cornerIndex],
        phase = gpCornerPhase(shape, distance);
      cue.corner = `T${cornerIndex + 1} · ${corner.name}`;
      cue.direction = shape.direction;
      cue.distance = distance < 0 ? 'EXIT' : `${Math.round(distance / 5) * 5} M TO APEX`;
      cue.phase = phase.phase;
      cue.progress = phase.progress;
      cue.action = 'LOOK THROUGH THE TURN';
      cue.detail = 'Set your entry speed';
      if (brake > 0.12) {
        // Braking remains braking after the named apex as well. The previous
        // distance-only exit branch encouraged power with the lever held.
        cue.action = lean > 0.22 ? 'TRAIL BRAKING' : 'BRAKING';
        cue.detail = lean > 0.22 ? 'Ease the brake as lean builds' : 'Set speed before turn-in';
        cue.tone = 'brake';
      } else if (distance < 0) {
        cue.action = 'CORNER EXIT';
        cue.detail = 'Pick up the bike · feed in power';
        cue.tone = 'flow';
        // The bend can continue well beyond its apex. An upright rider can
        // drive out; a deeply leaned rider still needs measured throttle.
        if (lean > 0.5) {
          cue.action = 'HOLD YOUR LINE';
          cue.detail = 'Unwind lean · add power gently';
        } else if (lean < 0.25 && throttle > 0.2) {
          cue.action = 'DRIVE OUT';
          cue.detail = 'Bike coming upright · build your run';
        }
        const nextShape = this.shapes[shape.next],
          toNextEntry = shape.nextGap + distance - nextShape.entry;
        if (
          shape.next !== cornerIndex &&
          toNextEntry < clamp(speed * 2, 60, 130) &&
          shape.nextGap + distance < 200
        ) {
          cue.action = 'LINK THE TURNS';
          cue.detail = `T${shape.next + 1} ${nextShape.direction} next · ${
            shape.direction === nextShape.direction ? 'hold your rhythm' : 'balance the change'
          }`;
        }
      } else if (lean > 0.35 && distance < Math.max(65, speed * 1.5)) {
        cue.action = 'HOLD YOUR LINE';
        cue.detail = 'Keep the throttle smooth';
        cue.tone = 'flow';
      }
    } else if (cue.tow > 0.08 && brake < 0.12 && rearBrake < 0.12 && lean < 0.35) {
      cue.action = 'SLIPSTREAM';
      cue.detail =
        frame[b + B.TUCK] < 0.65
          ? 'Hold a steady line · build the run'
          : 'Tow active · plan your pass';
      cue.tone = 'flow';
    }
    // The independent GP pedal is a different technique from front-lever
    // trail braking. Read the actual pedal channel, including during replay;
    // do not label rear-only braking as a front-brake action or a passing run.
    if (rearBrake > 0.12 && brake <= 0.12) {
      cue.action = 'REAR BRAKE';
      cue.detail =
        lean > 0.25 ? 'Light pedal · keep steering smooth' : 'Use front brake for a strong stop';
      cue.tone = 'brake';
      cue.tow = 0;
    }
    // The existing side arrows and this advice share one physical overlap
    // query. Never invite a passing move through an occupied corridor.
    // REF077/090: independent rider space in close racing. The original
    // warning thresholds are gameplay tuning; reference stills do not
    // establish safe numerical racing distances.
    const traffic = onRoute ? nearbyTraffic(frame) : null,
      left = traffic?.left === 'overlap',
      right = traffic?.right === 'overlap';
    if (left || right) {
      cue.tow = 0;
      if (brake > 0.12) {
        cue.action = lean > 0.22 ? 'TRAIL BRAKING' : 'BRAKING';
        cue.detail =
          lean > 0.22
            ? 'Ease brake as lean builds · leave racing room'
            : 'Brake in your lane · leave racing room';
        cue.tone = 'brake';
      } else if (rearBrake > 0.12) {
        cue.detail = 'Light pedal · leave racing room';
      } else {
        cue.action = left && right ? 'RIDERS BOTH SIDES' : left ? 'RIDER LEFT' : 'RIDER RIGHT';
        cue.detail = 'Hold your line · leave racing room';
        cue.tone = 'caution';
      }
    }
    if (control) {
      cue.action = control.action;
      cue.detail = control.detail;
      cue.tone = control.tone;
      cue.tow = 0;
    }
    // Marshal instructions retain priority over grip, thermal and tow advice.
    if (yellowFlag(frame[o + F.LOCAL_FLAG]) || frame[H.SC_PHASE] > 0) {
      cue.action = 'CAUTION';
      cue.detail = 'Slow down · hold position';
      cue.tone = 'caution';
      cue.tow = 0;
    } else if (frame[o + F.LOCAL_FLAG] === FLAG.BLUE) {
      cue.action = 'BLUE FLAG';
      cue.detail = 'Let the faster rider through';
      cue.tone = 'caution';
      cue.tow = 0;
    }
    return cue;
  }
}
