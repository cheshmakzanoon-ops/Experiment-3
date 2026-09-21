import { Vector3 } from 'three';
import { clamp, mod } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { F, H, HEADER, CAR_STRIDE, carBase } from '../simulation/protocol.ts';
import { inStandFootprint } from './grandstand.ts';

export interface CameraRig {
  id: number;
  centerS: number;
  coverageM: number;
  position: Vector3;
  baseFov: number;
  trackingHz: number;
  zoomHz: number;
  shot: 'grid-finish' | 'corner' | 'straight' | 'elevated';
  leadSeconds: number;
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

export const BROADCAST_STYLES = Object.freeze({
  'grid-finish': { panHz: 12, zoomHz: 7, leadSeconds: 0.1 },
  corner: { panHz: 11, zoomHz: 6, leadSeconds: 0.08 },
  straight: { panHz: 9, zoomHz: 5, leadSeconds: 0.16 },
  elevated: { panHz: 7, zoomHz: 4, leadSeconds: 0.12 },
});

/** Widen for nearby moving battle participants without a nearest-car identity
 * switch. Weight reaches exactly zero at 16m. The followed car remains the
 * optical subject; portrait/close views may fall back to single-car framing. */
export function broadcastRadius(frame: Float32Array, followed: number) {
  const cars = frame[H.CARS];
  if (
    !Number.isInteger(cars) ||
    cars < 1 ||
    cars > 12 ||
    !Number.isInteger(followed) ||
    followed < 0 ||
    followed >= cars ||
    frame.length < HEADER + cars * CAR_STRIDE
  )
    throw new Error('Invalid broadcast frame');
  const o = carBase(followed);
  let radius = 3.1;
  for (let id = 0; id < cars; id++) {
    const b = carBase(id);
    if (id === followed || frame[b + F.RETIRED] || frame[b + F.IN_PIT]) continue;
    const d = Math.hypot(
      frame[b + F.X] - frame[o + F.X],
      frame[b + F.Y] - frame[o + F.Y],
      frame[b + F.Z] - frame[o + F.Z],
    );
    if (!Number.isFinite(d)) throw new Error('Invalid broadcast participant');
    const t = clamp((16 - d) / 8, 0, 1),
      weight = t * t * (3 - 2 * t);
    radius = Math.max(radius, 3.1 + d * weight);
  }
  return radius;
}

export function tracksideRigs(track: Track): readonly CameraRig[] {
  const p = trackPoint(),
    spacing = track.length / TRACKSIDE_PLATFORMS.length;
  return TRACKSIDE_PLATFORMS.map(([side, height, fov], id): CameraRig => {
    const centerS = id * spacing;
    track.at(centerS + spacing * 0.18, p);
    let offset = side * (p.width + 18);
    // Old lens sites were underneath or beside stand canopies. Author a permanent
    // front-walkway pedestal, outside the protected road and in front of the
    // canopy edge. The visible infrastructure consumes this SAME site; never
    // hide the stand or move a camera dynamically to mask an obstruction.
    if (inStandFootprint(track, p.x + p.nx * offset, p.z + p.nz * offset, 1.2, 22))
      offset = side * (track.boundary(centerS + spacing * 0.18, side) + 3.4);
    const shot: CameraRig['shot'] =
      id === 0
        ? 'grid-finish'
        : Math.abs(p.curvature) > 0.012
          ? 'corner'
          : height >= 6
            ? 'elevated'
            : 'straight';
    const style = BROADCAST_STYLES[shot];
    return {
      id,
      centerS,
      coverageM: spacing + 16,
      position: new Vector3(p.x + p.nx * offset, p.y + height, p.z + p.nz * offset),
      baseFov: fov,
      trackingHz: style.panHz,
      zoomHz: style.zoomHz,
      shot,
      leadSeconds: style.leadSeconds,
    };
  });
}

/** A complete car fits within a 3.1 m bounding sphere. Reserve composition
 * room on the smaller screen axis, including narrow/portrait viewports. */
export function tracksideFraming(
  distanceM: number,
  baseFov: number,
  aspect = 16 / 9,
  subjectRadius = 3.1,
) {
  if (
    !Number.isFinite(distanceM) ||
    distanceM <= 0 ||
    !Number.isFinite(baseFov) ||
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    !Number.isFinite(subjectRadius) ||
    subjectRadius < 3.1
  )
    throw new Error('Invalid trackside framing');
  const smallAxis = Math.min(1, aspect);
  const radius = Math.asin(
    Math.min(0.98, subjectRadius / Math.max(subjectRadius + 0.1, distanceM)),
  );
  const required = (2 * Math.atan(Math.tan(radius / 0.72) / smallAxis) * 180) / Math.PI;
  const fov = clamp(Math.max(baseFov * Math.sqrt(40 / Math.max(20, distanceM)), required), 24, 55);
  const half = Math.atan(Math.tan((fov * Math.PI) / 360) * smallAxis);
  return {
    fov,
    minimumFov: Math.min(55, required),
    gazeAllowance: Math.max(0, half * 0.78 - radius),
    fits: radius < half,
  };
}

/** Fixed trackside positions plus a predictable pan/zoom director. Replay seeks
 * and camera cuts reset the pan; normal boundary jitter uses coverage hysteresis. */
export class TracksideDirector {
  readonly rigs: readonly CameraRig[];
  readonly position = new Vector3();
  readonly gaze = new Vector3();
  private predicted = new Vector3();
  private targetDirection = new Vector3();
  private viewDirection = new Vector3();
  framingFits = true;
  subjectRadius = 3.1;
  activeId = -1;
  cuts = 0;
  fov = 42;
  private previousS = NaN;
  private previousAspect = NaN;
  constructor(readonly track: Track) {
    this.rigs = tracksideRigs(track);
  }
  reset() {
    this.activeId = -1;
    this.previousS = NaN;
    this.previousAspect = NaN;
  }
  update(s: number, target: Vector3, velocity: Vector3, dt: number, aspect = 16 / 9, radius = 3.1) {
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
    const resized = aspect !== this.previousAspect;
    const rig = this.rigs[id];
    this.position.copy(rig.position);
    const distanceM = this.position.distanceTo(target);
    let framing = tracksideFraming(Math.max(0.001, distanceM), rig.baseFov, aspect, radius);
    this.subjectRadius = radius;
    if (!framing.fits && radius > 3.1) {
      this.subjectRadius = 3.1;
      framing = tracksideFraming(Math.max(0.001, distanceM), rig.baseFov, aspect);
    }
    this.framingFits = framing.fits;
    const speed = velocity.length();
    const lead = Math.min(
      rig.leadSeconds,
      (distanceM * Math.tan(framing.gazeAllowance * 0.6)) / Math.max(0.001, speed),
    );
    this.predicted.copy(target).addScaledVector(velocity, lead);
    const fov = framing.fov;
    if (cut || resized) {
      this.gaze.copy(this.predicted);
      this.fov = fov;
      if (cut) this.cuts++;
    } else {
      const mix = -Math.expm1(-rig.trackingHz * dt);
      this.gaze.lerp(this.predicted, mix);
      this.fov += (fov - this.fov) * -Math.expm1(-rig.zoomHz * dt);
      // Widen immediately when required for safety; tighten with the authored
      // lens rate. No lag-induced cropping on a fast approach.
      this.fov = Math.max(framing.minimumFov, this.fov);
    }
    // Pan filtering must not push a close, fast car outside the frame. Clamp
    // the optical direction to a safe cone; never translate the physical rig.
    if (cut || resized || dt > 0) {
      // The actual filtered FOV, not a second distance-scaled FOV, owns the cone.
      const half = Math.atan(Math.tan((this.fov * Math.PI) / 360) * Math.min(1, aspect));
      const radius = Math.asin(
        Math.min(0.98, this.subjectRadius / Math.max(this.subjectRadius + 0.1, distanceM)),
      );
      const allowed = Math.max(0, half * 0.78 - radius);
      this.framingFits = radius < half;
      this.targetDirection.copy(target).sub(this.position).normalize();
      this.viewDirection.copy(this.gaze).sub(this.position).normalize();
      const dot = clamp(this.targetDirection.dot(this.viewDirection), -1, 1);
      const angle = Math.acos(dot);
      if (angle > allowed + 1e-8) {
        if (dot < -0.9999 || allowed === 0) this.gaze.copy(target);
        else {
          const fraction = allowed / angle,
            sine = Math.sin(angle);
          this.gaze
            .copy(this.targetDirection)
            .multiplyScalar(Math.sin((1 - fraction) * angle) / sine)
            .addScaledVector(this.viewDirection, Math.sin(fraction * angle) / sine)
            .multiplyScalar(distanceM)
            .add(this.position);
        }
      }
    }
    this.activeId = id;
    this.previousS = s;
    this.previousAspect = aspect;
    return this;
  }
}
