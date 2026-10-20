import { describe, expect, it } from 'vitest';
import { Quat } from '../src/core/math.ts';
import { menuPreview } from '../src/rendering/menu-preview.ts';
import { bikeOrientation } from '../src/simulation/bike-vehicle.ts';
import { bikeSlipstreamDragScale } from '../src/simulation/bike-slipstream.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { FLAG } from '../src/simulation/marshal.ts';
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
  carBase,
} from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VEHICLES, vehicleIndex } from '../src/simulation/vehicles.ts';
import { GPRidingCues } from '../src/ui/gp-riding-cues.ts';
import { nearbyTraffic } from '../src/ui/proximity.ts';

const track = new Track('clear', false, undefined, circuitDefinition('poggio-alto')),
  player = carBase(0),
  bike = player + BIKE_BASE;

function pose(
  frame: Float32Array,
  id: number,
  heading: number,
  lean = 0,
  pitch = 0,
) {
  // Use the real bike orientation writer, including its nose-up and lean signs.
  const q = bikeOrientation(new Quat(), heading, pitch, lean),
    o = carBase(id);
  frame[o + F.QX] = q.x;
  frame[o + F.QY] = q.y;
  frame[o + F.QZ] = q.z;
  frame[o + F.QW] = q.w;
  frame[o + BIKE_BASE + B.LEAN] = lean;
  frame[o + BIKE_BASE + B.PITCH] = pitch;
  frame[o + F.SPEED] = 55;
  frame[o + F.VX] = 55 * Math.sin(heading);
  frame[o + F.VZ] = 55 * Math.cos(heading);
}

function pack(station = 0, machine = 'gpr1') {
  const seed = menuPreview(track, station, machine),
    frame = new Float32Array(HEADER + 3 * CAR_STRIDE),
    road = track.at(station, trackPoint()),
    heading = Math.atan2(road.tx, road.tz);
  frame.set(seed);
  frame[H.PHASE] = 2;
  frame[H.CARS] = 3;
  for (let id = 0; id < 3; id++) {
    if (id > 0) frame.set(seed.subarray(HEADER), carBase(id));
    pose(frame, id, heading);
    if (id > 0) frame[carBase(id) + F.Z] += id * 100;
  }
  return { frame, heading };
}

/** The production coordinate contract: +X is the rider's left at heading 0.
 * Turn the entire scene about Y, independently of the proximity projection. */
function rival(frame: Float32Array, id: number, heading: number, left: number, ahead: number) {
  const o = carBase(id);
  frame[o + F.X] =
    frame[player + F.X] + Math.cos(heading) * left + Math.sin(heading) * ahead;
  frame[o + F.Z] =
    frame[player + F.Z] - Math.sin(heading) * left + Math.cos(heading) * ahead;
  frame[o + F.Y] = frame[player + F.Y];
}

function applyTow(frame: Float32Array, amount = 0.8) {
  const spec = VEHICLES.gpr1.bike!;
  frame[bike + B.TUCK] = 0.8;
  frame[player + F.DRAG] =
    spec.drag * 55 ** 2 * bikeSlipstreamDragScale(0.8, spec.tuckDrag, amount);
}

describe('GP proximity uses the ground heading and motorcycle space', () => {
  it.each(['gpr1', 'gpr2'])(
    '%s keeps the correct side through mirrored deep lean, pitch and heading',
    (machine) => {
      for (const heading of [0, Math.PI / 2, -0.72]) {
        for (const lean of [-Math.PI / 3, Math.PI / 3]) {
          for (const pitch of [-0.15, 0, 0.15]) {
            const { frame } = pack(0, machine);
            pose(frame, 0, heading, lean, pitch);
            rival(frame, 1, heading, 1.4, 1.2);
            expect(nearbyTraffic(frame)).toEqual({ left: 'overlap', right: 'clear' });
            rival(frame, 1, heading, -1.4, -1.2);
            expect(nearbyTraffic(frame)).toEqual({ left: 'clear', right: 'overlap' });
          }
        }
      }
    },
  );

  it('distinguishes an alongside motorcycle from one still several metres ahead', () => {
    const { frame, heading } = pack();
    rival(frame, 1, heading, 2, 4.4);
    expect(nearbyTraffic(frame)).toEqual({ left: 'near', right: 'clear' });
    rival(frame, 1, heading, 2, 1);
    expect(nearbyTraffic(frame)).toEqual({ left: 'overlap', right: 'clear' });
    // A larger vehicle beside the GP rider keeps the established larger envelope.
    rival(frame, 1, heading, 2, 4.4);
    frame[carBase(1) + RACE_BASE + R.VEHICLE] = vehicleIndex('apx01');
    expect(nearbyTraffic(frame)).toEqual({ left: 'overlap', right: 'clear' });
  });

  it('reserves more room while either rider leans without reversing either side', () => {
    const { frame, heading } = pack();
    rival(frame, 1, heading, 3, 0);
    expect(nearbyTraffic(frame).left).toBe('near');
    pose(frame, 1, heading, -Math.PI / 3);
    expect(nearbyTraffic(frame).left).toBe('overlap');
    pose(frame, 1, heading, 0);
    pose(frame, 0, heading, Math.PI / 3);
    expect(nearbyTraffic(frame)).toEqual({ left: 'overlap', right: 'clear' });
  });

  it('does not lose overlap when a second rider is merely near on the same side', () => {
    const { frame, heading } = pack();
    rival(frame, 1, heading, -1.5, 1);
    rival(frame, 2, heading, -2, -9);
    expect(nearbyTraffic(frame)).toEqual({ left: 'clear', right: 'overlap' });
  });

  it.each([
    'bridge',
    'pit-rival',
    'pit-player',
    'retired',
    'finished',
    'player-down',
    'grid',
    'malformed-position',
    'malformed-heading',
    'same-lane',
  ] as const)('rejects irrelevant or invalid GP warnings: %s', (why) => {
    const { frame, heading } = pack(),
      other = carBase(1);
    rival(frame, 1, heading, 1.5, 1);
    if (why === 'bridge') frame[other + F.Y] += 6;
    if (why === 'pit-rival') frame[other + F.IN_PIT] = 1;
    if (why === 'pit-player') frame[player + F.IN_PIT] = 1;
    if (why === 'retired') frame[other + F.RETIRED] = 1;
    if (why === 'finished') frame[other + F.FINISH] = 1;
    if (why === 'player-down') frame[bike + B.STATE] = 1;
    if (why === 'grid') frame[H.PHASE] = 1;
    if (why === 'malformed-position') frame[other + F.X] = NaN;
    if (why === 'malformed-heading') frame[player + F.QY] = NaN;
    if (why === 'same-lane') rival(frame, 1, heading, 0, 1);
    expect(nearbyTraffic(frame)).toEqual({ left: 'clear', right: 'clear' });
  });

  it.each(['apx01', 'sbk1000', 'mx450'])('preserves the established %s projection', (machine) => {
    const { frame } = pack(0, machine);
    pose(frame, 0, 0);
    rival(frame, 1, 0, -3, 2);
    rival(frame, 2, 0, 3, -10);
    expect(nearbyTraffic(frame)).toEqual({ left: 'overlap', right: 'near' });
  });

  it('is snapshot-only through held frames and backwards seeks', () => {
    const { frame, heading } = pack(),
      original = frame.slice();
    rival(frame, 1, heading, 1.4, 1);
    pose(frame, 0, heading, -Math.PI / 3);
    const saved = frame.slice(),
      expected = nearbyTraffic(frame);
    for (let i = 0; i < 8; i++) expect(nearbyTraffic(frame)).toEqual(expected);
    expect(nearbyTraffic(original)).toEqual({ left: 'clear', right: 'clear' });
    expect(nearbyTraffic(frame)).toEqual(expected);
    expect(frame).toEqual(saved);
    expect(nearbyTraffic(frame.subarray(0, frame.length - 1))).toEqual({
      left: 'clear',
      right: 'clear',
    });
  });
});

describe('GP riding advice respects the occupied passing corridor', () => {
  it('replaces tow/pass encouragement with the same side warning and clears immediately', () => {
    const { frame, heading } = pack(),
      cues = new GPRidingCues();
    applyTow(frame);
    expect(cues.read(frame, track)?.action).toBe('SLIPSTREAM');
    rival(frame, 1, heading, 1.6, 1);
    expect(cues.read(frame, track)).toMatchObject({
      action: 'RIDER LEFT',
      detail: 'Hold your line · leave racing room',
      tone: 'caution',
      tow: 0,
    });
    rival(frame, 2, heading, -1.6, 0);
    expect(cues.read(frame, track)?.action).toBe('RIDERS BOTH SIDES');
    rival(frame, 1, heading, 1.6, 8);
    rival(frame, 2, heading, -1.6, -20);
    expect(cues.read(frame, track)?.action).toBe('SLIPSTREAM');
  });

  it('retains corner progress and actual brake technique while warning of racing room', () => {
    const { frame, heading } = pack(track.circuit.corners[0].s - 60),
      cues = new GPRidingCues();
    frame[player + F.BRAKE] = 0.35;
    frame[bike + B.LEAN] = 0.3;
    const solo = cues.read(frame, track)!;
    rival(frame, 1, heading, -1.6, 1);
    const close = cues.read(frame, track)!;
    expect(close).toMatchObject({
      action: 'TRAIL BRAKING',
      detail: 'Ease brake as lean builds · leave racing room',
      tone: 'brake',
      corner: solo.corner,
      direction: solo.direction,
      distance: solo.distance,
      phase: solo.phase,
      progress: solo.progress,
    });
    frame[player + F.BRAKE] = 0;
    frame[bike + B.REAR_BRAKE] = 0.35;
    expect(cues.read(frame, track)).toMatchObject({
      action: 'REAR BRAKE',
      detail: 'Light pedal · leave racing room',
      tone: 'brake',
      tow: 0,
    });
  });

  it('keeps mechanical warnings and marshals above side-by-side advice', () => {
    const { frame, heading } = pack(),
      cues = new GPRidingCues();
    rival(frame, 1, heading, 1.5, 0);
    frame[player + WHEEL_BASE + W.PUNCTURED] = 1;
    expect(cues.read(frame, track)?.action).toBe('FRONT PUNCTURE');
    frame[player + F.LOCAL_FLAG] = FLAG.YELLOW;
    expect(cues.read(frame, track)?.action).toBe('CAUTION');
    frame[player + F.LOCAL_FLAG] = FLAG.BLUE;
    expect(cues.read(frame, track)?.action).toBe('BLUE FLAG');
    frame[H.SC_PHASE] = 1;
    expect(cues.read(frame, track)?.action).toBe('CAUTION');
  });

  it('restores the identical alongside cue after replaying another snapshot', () => {
    const { frame, heading } = pack(),
      cues = new GPRidingCues();
    applyTow(frame);
    rival(frame, 1, heading, -1.6, 1);
    const saved = frame.slice(),
      expected = cues.read(frame, track);
    const clear = frame.slice();
    rival(clear, 1, heading, -1.6, -25);
    expect(cues.read(clear, track)?.action).toBe('SLIPSTREAM');
    expect(cues.read(frame, track)).toEqual(expected);
    expect(frame).toEqual(saved);
  });
});
