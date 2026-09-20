import { Vector3 } from 'three';
import { clamp, mod } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';

export interface CameraRig {
  id: number;
  centerS: number;
  coverageM: number;
  position: Vector3;
  baseFov: number;
  trackingHz: number;
}
// Alternating crane/low platform placements are authored, not random camera
// teleport offsets. Pit-lane cameras stay across the circuit from the garages.
export const TRACKSIDE_PLATFORMS = [
  [-1, 5, 43],
  [-1, 3.4, 38],
  [-1, 5, 42],
  [1, 7, 36],
  [-1, 4, 42],
  [1, 5, 40],
  [-1, 3.5, 45],
  [1, 6, 39],
  [-1, 5, 40],
  [1, 3.5, 42],
  [-1, 6, 38],
  [1, 5, 40],
  [-1, 4, 43],
  [1, 7, 37],
  [-1, 3.5, 44],
  [1, 5, 40],
  [-1, 6, 37],
  [1, 4, 42],
  [-1, 5, 40],
  [-1, 6, 42],
] as const;

export function tracksideRigs(track: Track): readonly CameraRig[] {
  const p = trackPoint(),
    spacing = track.length / TRACKSIDE_PLATFORMS.length;
  return TRACKSIDE_PLATFORMS.map(([side, height, fov], id) => {
    const centerS = id * spacing;
    track.at(centerS + spacing * 0.18, p);
    const offset = side * (p.width + 18);
    return {
      id,
      centerS,
      coverageM: spacing + 16,
      position: new Vector3(p.x + p.nx * offset, p.y + height, p.z + p.nz * offset),
      baseFov: fov,
      trackingHz: 12,
    };
  });
}

/** Fixed trackside positions plus a predictable pan/zoom director. Replay seeks
 * and camera cuts reset the pan; normal boundary jitter uses coverage hysteresis. */
export class TracksideDirector {
  readonly rigs: readonly CameraRig[];
  readonly position = new Vector3();
  readonly gaze = new Vector3();
  private predicted = new Vector3();
  activeId = -1;
  cuts = 0;
  fov = 42;
  private previousS = NaN;
  constructor(readonly track: Track) {
    this.rigs = tracksideRigs(track);
  }
  reset() {
    this.activeId = -1;
    this.previousS = NaN;
  }
  update(s: number, target: Vector3, velocity: Vector3, dt: number) {
    if (
      !Number.isFinite(
        s + dt + target.x + target.y + target.z + velocity.x + velocity.y + velocity.z,
      ) ||
      dt < 0
    )
      throw new Error('Invalid trackside camera state');
    const length = this.track.length;
    s = mod(s, length);
    const spacing = length / this.rigs.length;
    const distance = (a: number, b: number) =>
      Math.abs(mod(a - b + length / 2, length) - length / 2);
    const seek = Number.isFinite(this.previousS) && distance(s, this.previousS) > spacing;
    let id = this.activeId;
    if (id < 0 || seek || distance(s, this.rigs[id].centerS) > this.rigs[id].coverageM / 2)
      id = Math.round(s / spacing) % this.rigs.length;
    const cut = id !== this.activeId || seek;
    const rig = this.rigs[id];
    this.position.copy(rig.position);
    this.predicted.copy(target).addScaledVector(velocity, 0.12);
    const distanceM = this.position.distanceTo(target);
    const fov = clamp(rig.baseFov * Math.sqrt(40 / Math.max(20, distanceM)), 24, 55);
    if (cut) {
      this.gaze.copy(this.predicted);
      this.fov = fov;
      this.cuts++;
    } else {
      const mix = -Math.expm1(-rig.trackingHz * dt);
      this.gaze.lerp(this.predicted, mix);
      this.fov += (fov - this.fov) * mix;
    }
    this.activeId = id;
    this.previousS = s;
    return this;
  }
}
