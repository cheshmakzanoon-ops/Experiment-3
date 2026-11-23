import * as T from 'three';
import { F, H, carBase } from '../simulation/protocol.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { box, mesh, mergeStatic, rod } from './geometry.ts';
import { grassApronOffset } from './ground-profile.ts';
import { tagWeatherSurface } from './weather-presentation.ts';

/** A pedestal on the public-side service strip, ahead of the first grid row
 * and upstream of the finish gantry. The race director and the visible camera
 * use this exact optical origin. The instrument clears the catch-fence return. */
export function formulaGridCameraSite(track: Track) {
  const s = track.length - Math.max(8, track.pit.gridStart - 16);
  const p = track.at(s, trackPoint()),
    side = -track.pit.side;
  const lateral = side * (track.boundaryAt(p, side) + 2.2);
  const base = new T.Vector3(
    p.x + p.nx * lateral,
    p.y + p.bank * T.MathUtils.clamp(lateral, -12, 12) + grassApronOffset(track, s, lateral),
    p.z + p.nz * lateral,
  );
  const eye = base.clone();
  eye.y += 6.25;
  const q = track.at(s - 34, trackPoint());
  return {
    s,
    side,
    lateral,
    base,
    eye,
    yaw: Math.atan2(p.tx, p.tz),
    target: new T.Vector3(q.x, q.y + 0.65, q.z),
  };
}

export class FormulaGridCamera {
  readonly root = new T.Group();
  readonly head = new T.Group();
  private readonly target = new T.Vector3();
  readonly site: ReturnType<typeof formulaGridCameraSite>;
  constructor(
    readonly track: Track,
    steel: T.Material,
  ) {
    const site = (this.site = formulaGridCameraSite(track));
    const dark = tagWeatherSurface(
      new T.MeshStandardMaterial({ color: 0x222930, metalness: 0.56, roughness: 0.48 }),
      'metal',
      0.8,
    );
    const trim = tagWeatherSurface(
      new T.MeshStandardMaterial({ color: 0xb6beb9, metalness: 0.52, roughness: 0.43 }),
      'paint',
      0.85,
    );
    const glass = new T.MeshPhysicalMaterial({
      color: 0x101f29,
      metalness: 0.32,
      roughness: 0.078,
      clearcoat: 1,
      clearcoatRoughness: 0.032,
    });
    const hardware = new T.Group(),
      head = this.head,
      side = site.side;
    this.root.name = 'Formula finish-line camera pedestal';
    this.root.position.copy(site.base);
    this.root.rotation.y = site.yaw;
    box(hardware, dark, side * 0.72, 0.07, 0, 0.64, 0.18, 0.65);
    for (const [y, length, radius] of [
      [1.45, 2.8, 0.14],
      [3.65, 2.35, 0.105],
      [5.2, 1.38, 0.074],
    ]) {
      mesh(
        hardware,
        new T.CylinderGeometry(radius * 0.93, radius, length, 12),
        steel,
        side * 0.72,
        y,
        0,
      );
    }
    for (const y of [0.2, 2.64, 4.66, 5.76])
      mesh(hardware, new T.CylinderGeometry(0.147, 0.15, 0.065, 12), dark, side * 0.72, y, 0);
    rod(hardware, steel, new T.Vector3(side * 0.72, 5.66, 0), new T.Vector3(0, 5.95, 0), 0.066);
    rod(hardware, steel, new T.Vector3(side * 0.72, 5.14, 0), new T.Vector3(0, 5.91, 0), 0.035);
    for (const x of [-0.16, 0.16]) {
      box(hardware, dark, x, 6.01, -0.1, 0.065, 0.33, 0.12);
      const pin = mesh(
        hardware,
        new T.CylinderGeometry(0.049, 0.049, 0.042, 10),
        trim,
        x,
        6.11,
        -0.1,
      );
      pin.rotation.z = Math.PI / 2;
    }
    mergeStatic(hardware);
    head.name = 'Weatherproof pan and tilt head';
    head.position.y = site.eye.y - site.base.y;
    head.rotation.order = 'YXZ';
    // The opening ends behind the optical centre. The camera cannot see its
    // own hood when it looks through the lens.
    box(head, trim, 0, 0.018, -0.39, 0.35, 0.27, 0.45);
    box(head, dark, 0, 0.008, -0.639, 0.26, 0.22, 0.07);
    for (const y of [-0.119, 0.154]) box(head, dark, 0, y, -0.22, 0.34, 0.027, 0.38);
    for (const x of [-0.157, 0.157]) box(head, dark, x, 0.015, -0.22, 0.026, 0.25, 0.38);
    const lens = mesh(head, new T.CylinderGeometry(0.097, 0.11, 0.105, 18), dark, 0, 0.01, -0.123);
    lens.rotation.x = Math.PI / 2;
    const optic = mesh(head, new T.CircleGeometry(0.083, 20), glass, 0, 0.01, -0.066);
    optic.receiveShadow = false;
    for (let j = 0; j < 6; j++)
      box(head, dark, -0.177, 0.003, -0.29 - j * 0.044, 0.011, 0.143, 0.017);
    mergeStatic(head);
    this.root.add(hardware, head);
    this.aim(site.target);
  }
  /** A lens cannot record its own yoke. This scope affects the direct colour
   * exposure only. Reflections, other cameras and the next frame see the rig. */
  expose(eye: T.Vector3, render: () => void) {
    if (eye.distanceToSquared(this.site.eye) > 0.0025) {
      render();
      return;
    }
    const visible = this.root.visible;
    this.root.visible = false;
    try {
      render();
    } finally {
      this.root.visible = visible;
    }
  }
  private aim(point: T.Vector3) {
    this.target.copy(point);
    this.root.worldToLocal(this.target).sub(this.head.position);
    this.head.rotation.y = Math.atan2(this.target.x, this.target.z);
    this.head.rotation.x = -Math.atan2(this.target.y, Math.hypot(this.target.x, this.target.z));
  }
  update(frame: Float32Array, follow: number) {
    let selected = -1,
      nearest = 180;
    for (let i = 0; i < frame[H.CARS]; i++) {
      const o = carBase(i);
      if (frame[o + F.IN_PIT] || frame[o + F.RETIRED]) continue;
      const d = Math.abs(frame[o + F.S] - this.site.s);
      const gap = Math.min(d, this.track.length - d);
      if (i === follow && gap < 100) {
        selected = o;
        break;
      }
      if (gap < nearest) {
        nearest = gap;
        selected = o;
      }
    }
    if (selected < 0) {
      this.aim(this.site.target);
      return;
    }
    this.aim(
      this.target.set(frame[selected + F.X], frame[selected + F.Y] + 0.18, frame[selected + F.Z]),
    );
  }
}
