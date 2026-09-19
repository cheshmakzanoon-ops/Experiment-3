import { clamp } from '../core/math.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../simulation/protocol.ts';

export interface AudioView {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rightX: number;
  rightY: number;
  rightZ: number;
  interior: boolean;
  followedCar: number;
}
interface Pose {
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
}
/** Listener coordinates come from the actual view, not the player chassis.
 * Three cameras look along local -Z; local +X is screen right. This deliberately
 * differs from the car's documented +X-left convention. Velocity uses simulation
 * seconds so replay rate does not become a fictitious supersonic listener. */
export class AudioViewTracker {
  readonly value: AudioView = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rightX: 1,
    rightY: 0,
    rightZ: 0,
    interior: false,
    followedCar: 0,
  };
  private time = NaN;
  private shot = -1;
  reset() {
    this.time = NaN;
  }
  update(camera: Pose, time: number, shot: number, interior: boolean, followedCar = 0) {
    const p = camera.position,
      q = camera.quaternion,
      v = this.value;
    if (!Number.isFinite(time + p.x + p.y + p.z + q.x + q.y + q.z + q.w))
      throw new Error('Non-finite audio camera');
    const dt = time - this.time,
      dx = p.x - v.x,
      dy = p.y - v.y,
      dz = p.z - v.z;
    // A camera cut, rewind, long gap or discontinuous spatial seek has no physical
    // listener velocity. Do not turn a teleport into a Doppler spike.
    const continuous =
      this.shot === shot && dt > 0 && dt <= 0.5 && Math.hypot(dx, dy, dz) <= 250 * dt + 0.5;
    v.vx = continuous ? dx / dt : 0;
    v.vy = continuous ? dy / dt : 0;
    v.vz = continuous ? dz / dt : 0;
    v.x = p.x;
    v.y = p.y;
    v.z = p.z;
    v.rightX = 1 - 2 * (q.y * q.y + q.z * q.z);
    v.rightY = 2 * (q.x * q.y + q.w * q.z);
    v.rightZ = 2 * (q.x * q.z - q.w * q.y);
    v.interior = interior;
    v.followedCar = followedCar;
    this.time = time;
    this.shot = shot;
    return v;
  }
}
export interface SpatialVoice {
  id: number;
  distance: number;
  gain: number;
  pan: number;
  doppler: number;
}
export const spatialVoice = (): SpatialVoice => ({
  id: -1,
  distance: 0,
  gain: 0,
  pan: 0,
  doppler: 1,
});
const SOUND_SPEED_MPS = 343;
const REFERENCE_DISTANCE_M = 8;
const MAX_AUDIBLE_DISTANCE_M = 280;
export function locateSource(
  frame: Float32Array,
  id: number,
  listener: AudioView,
  out: SpatialVoice,
) {
  const o = carBase(id),
    dx = frame[o + F.X] - listener.x,
    dy = frame[o + F.Y] - listener.y,
    dz = frame[o + F.Z] - listener.z;
  const d = Math.hypot(dx, dy, dz);
  const svx = frame[o + F.VX],
    svy = frame[o + F.VY],
    svz = frame[o + F.VZ];
  if (
    !Number.isFinite(
      d +
        svx +
        svy +
        svz +
        listener.vx +
        listener.vy +
        listener.vz +
        listener.rightX +
        listener.rightY +
        listener.rightZ,
    )
  )
    throw new Error('Non-finite audio source');
  out.id = id;
  out.distance = d;
  const seated = listener.interior && id === listener.followedCar;
  out.pan =
    seated || d < 0.01
      ? 0
      : clamp(
          (dx * listener.rightX + dy * listener.rightY + dz * listener.rightZ) / Math.max(2, d),
          -1,
          1,
        );
  out.doppler = 1;
  if (!seated && d > 0.1) {
    // n points listener -> source. A source approaching the listener has a
    // negative radial speed; a listener approaching the source has a positive one.
    const sourceRadial = (svx * dx + svy * dy + svz * dz) / d;
    const listenerRadial = (listener.vx * dx + listener.vy * dy + listener.vz * dz) / d;
    // This is a subsonic racing model, not a sonic-boom synthesizer.
    const source = clamp(sourceRadial, -0.8 * SOUND_SPEED_MPS, 0.8 * SOUND_SPEED_MPS);
    const observer = clamp(listenerRadial, -0.8 * SOUND_SPEED_MPS, 0.8 * SOUND_SPEED_MPS);
    out.doppler = clamp((SOUND_SPEED_MPS + observer) / (SOUND_SPEED_MPS + source), 0.5, 2);
  }
  const fade = 1 - clamp((d - MAX_AUDIBLE_DISTANCE_M * 0.8) / (MAX_AUDIBLE_DISTANCE_M * 0.2), 0, 1);
  out.gain = seated ? 0.82 : ((0.82 * REFERENCE_DISTANCE_M) / (REFERENCE_DISTANCE_M + d)) * fade;
  return out;
}
/** Four stable synthesis voices, selected by distance to the camera with 15%
 * incumbent hysteresis. Nearby cars do not exchange oscillator identities on
 * every distance-order swap. No sorting/array allocation in the update loop. */
export class SpatialAudioScene {
  readonly voices = Array.from({ length: 4 }, spatialVoice);
  readonly player = spatialVoice();
  private sources = Array.from({ length: 12 }, spatialVoice);
  private selected = new Uint8Array(12);
  private assigned = new Uint8Array(12);
  private scores = new Float64Array(12);
  update(frame: Float32Array, view: AudioView) {
    const count = frame[H.CARS];
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 12 ||
      frame.length !== HEADER + count * CAR_STRIDE
    )
      throw new Error('Invalid audio grid');
    this.selected.fill(0);
    this.assigned.fill(0);
    for (let id = 0; id < count; id++) {
      const state = locateSource(frame, id, view, this.sources[id]);
      let incumbent = false;
      for (const voice of this.voices) if (voice.id === id) incumbent = true;
      this.scores[id] = (state.distance + 1) * (incumbent ? 0.85 : 1);
      if (view.interior && id === view.followedCar) this.scores[id] = -1;
    }
    for (let n = 0; n < Math.min(4, count); n++) {
      let best = -1,
        score = Infinity;
      for (let id = 0; id < count; id++)
        if (!this.selected[id] && this.scores[id] < score) {
          best = id;
          score = this.scores[id];
        }
      if (best >= 0) this.selected[best] = 1;
    }
    for (const voice of this.voices) {
      if (voice.id >= 0 && voice.id < count && this.selected[voice.id]) this.assigned[voice.id] = 1;
      else {
        voice.id = -1;
        voice.gain = 0;
      }
    }
    for (const voice of this.voices) {
      if (voice.id < 0)
        for (let id = 0; id < count; id++)
          if (this.selected[id] && !this.assigned[id]) {
            voice.id = id;
            this.assigned[id] = 1;
            break;
          }
      if (voice.id >= 0) Object.assign(voice, this.sources[voice.id]);
    }
    Object.assign(this.player, this.sources[0]);
  }
}
