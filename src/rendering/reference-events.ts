import {
  F,
  H,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  CAR_STRIDE,
  HEADER,
  carBase,
} from '../simulation/protocol.ts';
import { PHASE } from '../simulation/race.ts';
import { SURFACE } from '../simulation/track.ts';

export type RaceEventKind =
  | 'grid'
  | 'start'
  | 'battle'
  | 'pack'
  | 'wet-traffic'
  | 'wet-lap'
  | 'pit-service'
  | 'gravel'
  | 'loaded-corner'
  | 'braking'
  | 'finish'
  | 'motion';
export type ReferenceCamera = 'chase' | 'cockpit' | 'pod' | 'trackside';
export interface EventRequirement {
  kind: RaceEventKind;
  camera: ReferenceCamera;
  holdSeconds: number;
  instruction: string;
}
const requirement = (
  kind: RaceEventKind,
  camera: ReferenceCamera,
  holdSeconds: number,
  instruction: string,
): EventRequirement => ({ kind, camera, holdSeconds, instruction });
/** Every listed route requests an actual event, never a replacement static car.
 * Variants retain their own numbered identity while sharing event predicates. */
export function referenceEvent(id: number): EventRequirement | null {
  if ([4, 71, 92, 95].includes(id))
    return requirement(
      'pit-service',
      id === 95 ? 'cockpit' : 'trackside',
      1,
      'Request a real tyre stop. The car must be stationary in service, with the jack phase and crew visible.',
    );
  if (id === 47)
    return requirement(
      'grid',
      'pod',
      0,
      'Open the preparation phase before the lights. Staff and blankets must still be present.',
    );
  if (id === 94)
    return requirement(
      'start',
      'pod',
      0,
      'Observe the real start-light sequence. A car sitting on the grid after lights-out is not a countdown.',
    );
  if ([6, 32, 45, 83, 85].includes(id))
    return requirement(
      'battle',
      id === 85 ? 'chase' : 'trackside',
      1,
      'Find two moving cars overlapping longitudinally with a safe lateral separation. A lone-car photo is not this event.',
    );
  if ([7, 39, 44, 66, 98].includes(id))
    return requirement(
      'pack',
      'trackside',
      1,
      'A group of at least four moving, non-pitting cars must occupy the followed car’s neighbourhood.',
    );
  if ([10, 68, 82, 93].includes(id))
    return requirement(
      'wet-traffic',
      id === 93 ? 'cockpit' : 'trackside',
      3,
      'Drive on a genuinely wet circuit near moving traffic for three uninterrupted simulation seconds.',
    );
  if (id === 96)
    return requirement(
      'wet-lap',
      'cockpit',
      3,
      'Drive at speed over wet contact patches. The cockpit and instruments remain live.',
    );
  if (id === 41)
    return requirement(
      'gravel',
      'trackside',
      0.25,
      'A wheel must physically contact gravel while the car is moving. A trackside dust decoration is not evidence.',
    );
  if (id === 28)
    return requirement(
      'braking',
      'cockpit',
      0.5,
      'Apply significant braking at speed. Braking-zone location and marker composition still need visual inspection.',
    );
  if ([22, 29, 36].includes(id))
    return requirement(
      'loaded-corner',
      id === 22 ? 'trackside' : 'chase',
      1,
      'Observe actual lateral acceleration in a moving corner, not a stationary steering pose.',
    );
  if ([2, 42, 78, 90].includes(id))
    return requirement(
      'motion',
      'trackside',
      2,
      'Follow a moving car with the production trackside director and motion blur. Lens/framing/temporal quality require separate comparison.',
    );
  if ([3, 8, 24, 27, 30, 84, 88].includes(id))
    return requirement(
      'motion',
      [8].includes(id) ? 'pod' : id === 24 ? 'chase' : 'cockpit',
      2,
      'Use the native onboard or chase camera while the production car is moving. Scenery, HUD and driver anatomy remain separate acceptance items.',
    );
  return null;
}
export interface RaceObservation {
  time: number;
  followed: number;
  speed: number;
  longitudinalG: number;
  lateralG: number;
  rain: number;
  contactWater: number;
  lights: number;
  phase: number;
  pitPhase: number;
  neighbour: number | null;
  neighbourDistance: number | null;
  nearbyCars: number;
  events: readonly RaceEventKind[];
}
export function observeRace(frame: Float32Array, followed = 0): RaceObservation {
  const count = frame[H.CARS];
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    frame.length < HEADER + count * CAR_STRIDE ||
    !Number.isInteger(followed) ||
    followed < 0 ||
    followed >= count
  )
    throw new Error('Invalid race-event snapshot');
  const b = carBase(followed),
    required = [
      H.TIME,
      H.RAIN,
      H.LIGHTS,
      H.PHASE,
      b + F.X,
      b + F.Y,
      b + F.Z,
      b + F.S,
      b + F.LATERAL,
      b + F.SPEED,
      b + F.G_LAT,
      b + F.G_LONG,
      b + F.PIT_PHASE,
      b + F.BRAKE,
    ];
  if (required.some((i) => !Number.isFinite(frame[i])))
    throw new Error('Non-finite race-event observation');
  const events: RaceEventKind[] = [],
    speed = Math.abs(frame[b + F.SPEED]);
  const out: RaceObservation = {
    time: frame[H.TIME],
    followed,
    speed,
    longitudinalG: frame[b + F.G_LONG],
    lateralG: frame[b + F.G_LAT],
    rain: frame[H.RAIN],
    contactWater: 0,
    lights: frame[H.LIGHTS],
    phase: frame[H.PHASE],
    pitPhase: frame[b + F.PIT_PHASE],
    neighbour: null,
    neighbourDistance: null,
    nearbyCars: 1,
    events,
  };
  let gravel = false,
    wetContacts = 0;
  for (let i = 0; i < 4; i++) {
    const w = b + WHEEL_BASE + i * WHEEL_STRIDE;
    if (!Number.isFinite(frame[w + W.WATER] + frame[w + W.SURFACE] + frame[w + W.LOAD]))
      throw new Error('Invalid contact-event data');
    out.contactWater += Math.max(0, frame[w + W.WATER]) / 4;
    if (frame[w + W.LOAD] > 20 && frame[w + W.WATER] > 0.1) wetContacts++;
    if (frame[w + W.LOAD] > 20 && frame[w + W.SURFACE] === SURFACE.GRAVEL) gravel = true;
  }
  const racing =
    !frame[b + F.IN_PIT] && !frame[b + F.PIT_PHASE] && !frame[b + F.RETIRED] && speed > 12;
  let overlapping = false;
  if (racing)
    for (let id = 0; id < count; id++) {
      if (id === followed) continue;
      const o = carBase(id);
      if (
        !Number.isFinite(
          frame[o + F.X] +
            frame[o + F.Y] +
            frame[o + F.Z] +
            frame[o + F.SPEED] +
            frame[o + F.S] +
            frame[o + F.LATERAL],
        )
      )
        throw new Error('Invalid traffic-event data');
      if (
        frame[o + F.IN_PIT] ||
        frame[o + F.PIT_PHASE] ||
        frame[o + F.RETIRED] ||
        Math.abs(frame[o + F.SPEED]) < 12
      )
        continue;
      const distance = Math.hypot(frame[b + F.X] - frame[o + F.X], frame[b + F.Z] - frame[o + F.Z]);
      if (Math.abs(frame[b + F.Y] - frame[o + F.Y]) > 3) continue;
      if (distance < 35) out.nearbyCars++;
      if (distance < 25 && (out.neighbourDistance === null || distance < out.neighbourDistance)) {
        out.neighbour = id;
        out.neighbourDistance = distance;
      }
      const length = frame[H.LENGTH];
      if (!Number.isFinite(length) || length <= 0)
        throw new Error('Invalid race-event track length');
      const ds = Math.abs(
          ((frame[b + F.S] - frame[o + F.S] + length * 1.5) % length) - length * 0.5,
        ),
        lateral = Math.abs(frame[b + F.LATERAL] - frame[o + F.LATERAL]);
      if (distance < 8 && ds < 4.5 && lateral > 1.65 && lateral < 4.8) overlapping = true;
    }
  // Real race phase, never inferred from a screenshot or wall timer.
  if (frame[H.PHASE] === PHASE.GRID && speed < 1) events.push('grid');
  if (frame[H.PHASE] === PHASE.LIGHTS && frame[H.LIGHTS] > 0 && frame[H.LIGHTS] <= 5)
    events.push('start');
  if (out.pitPhase >= 2 && out.pitPhase <= 4 && speed < 0.5 && frame[b + F.IN_PIT])
    events.push('pit-service');
  if (frame[b + F.FINISH] > 0) events.push('finish');
  if (racing) {
    events.push('motion');
    if (overlapping) events.push('battle');
    if (out.nearbyCars >= 4) events.push('pack');
    if (wetContacts >= 2) {
      events.push('wet-lap');
      if (out.neighbour !== null) events.push('wet-traffic');
    }
    if (Math.abs(out.lateralG) > 0.6) events.push('loaded-corner');
    if (frame[b + F.BRAKE] > 0.45 && out.longitudinalG < -0.35) events.push('braking');
    if (gravel) events.push('gravel');
  }
  return out;
}

export interface EventWitness {
  version: 1;
  reference: number;
  source: string;
  session: string;
  startedAt: number;
  lastTime: number;
  status: 'waiting' | 'observed' | 'interrupted';
  kind: RaceEventKind;
  camera: ReferenceCamera;
  observedFor: number;
  matchedFrames: number;
  replay: boolean;
  automated: boolean;
  reason: string;
  observation: RaceObservation | null;
  humanAccepted: false;
  visualAccepted: false;
}
/** Bounded watch: long gaps, camera changes, session changes and rewind cannot
 * be stitched into a supposedly continuous event. Observation is not approval. */
export class ReferenceEventWatch {
  private witness: EventWitness | null = null;
  private requirement: EventRequirement | null = null;
  private matchedSince: number | null = null;
  arm(reference: number, source: string, session: string, replay = false) {
    const rule = referenceEvent(reference);
    if (!rule) throw new Error('Reference has no live-event requirement');
    if (!/^[a-f0-9]{64}$/.test(source) || !session || session.length > 160)
      throw new Error('Invalid reference event identity');
    this.requirement = rule;
    this.matchedSince = null;
    this.witness = {
      version: 1,
      reference,
      source,
      session,
      startedAt: -1,
      lastTime: -1,
      status: 'waiting',
      kind: rule.kind,
      camera: rule.camera,
      observedFor: 0,
      matchedFrames: 0,
      replay,
      automated: false,
      reason: 'Waiting for the actual scene.',
      observation: null,
      humanAccepted: false,
      visualAccepted: false,
    };
  }
  sample(
    frame: Float32Array,
    followed: number,
    camera: ReferenceCamera,
    session: string,
    replay: boolean,
    automated: boolean,
  ) {
    const w = this.witness,
      r = this.requirement;
    if (!w || !r || w.status !== 'waiting') return;
    if (w.session !== session || w.replay !== replay) {
      this.interrupt('Session or playback source changed.');
      return;
    }
    const observation = observeRace(frame, followed);
    if (w.lastTime >= 0 && (observation.time < w.lastTime || observation.time - w.lastTime > 1)) {
      this.matchedSince = null;
      w.matchedFrames = 0;
      w.observedFor = 0;
    }
    if (w.lastTime === observation.time) return;
    w.lastTime = observation.time;
    if (w.startedAt < 0) w.startedAt = observation.time;
    w.observation = observation;
    w.automated ||= automated;
    if (observation.time - w.startedAt > 7200) {
      this.interrupt('Two-hour watch limit reached.');
      return;
    }
    if (camera !== r.camera || !observation.events.includes(r.kind)) {
      this.matchedSince = null;
      w.matchedFrames = 0;
      w.observedFor = 0;
      w.reason = camera !== r.camera ? `Select ${r.camera} camera.` : `Waiting for ${r.kind}.`;
      return;
    }
    this.matchedSince ??= observation.time;
    w.matchedFrames++;
    w.observedFor = observation.time - this.matchedSince;
    w.reason = `Observed ${r.kind}: ${w.observedFor.toFixed(1)} / ${r.holdSeconds.toFixed(1)} s.`;
    if (w.observedFor >= r.holdSeconds) {
      w.status = 'observed';
      w.reason =
        'Scene conditions observed. Framing, sound, UI and artistic quality are not approved.';
    }
  }
  interrupt(reason: string) {
    if (this.witness?.status === 'waiting') {
      this.witness.status = 'interrupted';
      this.witness.reason = reason.slice(0, 240);
    }
  }
  clear() {
    this.witness = null;
    this.requirement = null;
    this.matchedSince = null;
  }
  get active() {
    return this.witness?.status === 'waiting';
  }
  report() {
    return this.witness ? structuredClone(this.witness) : null;
  }
}
