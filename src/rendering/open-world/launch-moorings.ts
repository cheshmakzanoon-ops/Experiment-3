import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  harbourOrbitalDisplacement,
  harbourWaveHeight,
  sampleLaunchAttitude,
} from './harbour-swell.ts';

// Local attachment coordinates in the authored nine-metre hull. The towing eye
// projects through the stem; the buoy eye and hawser meet above its shoulder.
const BOW = new T.Vector3(0, 0.94, 4.69);
const HEAD = new T.Vector3(0, 0.45, 0);
const SEPARATION = 8.43;
const ROPE_LENGTH = 3.87;
const RINGS = 18,
  SIDES = 6,
  ROPE_RADIUS = 0.021;

function colours(g: T.BufferGeometry, paint: (height: number, angle: number) => T.Color) {
  const pos = g.getAttribute('position'),
    attribute = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const colour = paint(pos.getY(i), Math.atan2(pos.getZ(i), pos.getX(i)));
    colour.toArray(attribute, 3 * i);
  }
  g.setAttribute('color', new T.BufferAttribute(attribute, 3));
  return g;
}

function castFloat() {
  // Vegetation stain below the waterline, two enamel panels, a raised rubbing
  // bead and a pale safety stripe. Radii and levels are in metres.
  const profile = [
    [0.065, -0.4],
    [0.13, -0.39],
    [0.19, -0.33],
    [0.33, -0.17],
    [0.35, -0.09],
    [0.355, -0.045],
    [0.36, -0.036],
    [0.36, -0.013],
    [0.35, -0.008],
    [0.345, 0.043],
    [0.34, 0.077],
    [0.34, 0.084],
    [0.335, 0.125],
    [0.335, 0.131],
    [0.305, 0.174],
    [0.19, 0.225],
    [0.09, 0.255],
    [0.07, 0.26],
    [0.002, 0.26],
  ];
  const stain = new T.Color(0x354536),
    paint = new T.Color(0xb64725),
    band = new T.Color(0xe9d6a6),
    iron = new T.Color(0x676b60);
  const colour = new T.Color();
  const body = colours(
    new T.LatheGeometry(
      profile.map(([r, y]) => new T.Vector2(r, y)),
      24,
    ),
    (y, az) =>
      colour
        .copy(y < -0.04 ? stain : y > 0.081 && y < 0.129 ? band : paint)
        .multiplyScalar(0.92 + 0.06 * Math.sin(5 * az + y * 7) + 0.025 * Math.cos(11 * az)),
  );
  const base = colours(
    new T.CylinderGeometry(0.085, 0.105, 0.07, 12).translate(0, 0.278, 0),
    () => iron,
  );
  const ring = colours(
    new T.TorusGeometry(0.085, 0.019, 8, 24).rotateY(Math.PI / 2).translate(0, 0.386, 0),
    () => iron,
  );
  const result = mergeGeometries([body, base, ring]);
  body.dispose();
  base.dispose();
  ring.dispose();
  return result;
}

export class MooringHardware {
  readonly float = castFloat();
  readonly eye = new T.TorusGeometry(0.083, 0.018, 8, 20)
    .rotateY(Math.PI / 2)
    .translate(0, BOW.y, BOW.z - 0.081);
  readonly paint = new T.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.21,
    roughness: 0.64,
  });
  readonly zinc = new T.MeshStandardMaterial({ color: 0x89918b, metalness: 0.77, roughness: 0.37 });
  readonly rope = new T.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.88 });
  dispose() {
    this.float.dispose();
    this.eye.dispose();
    this.paint.dispose();
    this.zinc.dispose();
    this.rope.dispose();
  }
}

/** Invert the arc-length equation of a hanging chain. Its length stays fixed
 * as the two eyes heave independently. Close to taut the straight limit avoids
 * subtracting nearly equal hyperbolic cosines. */
function catenary(horizontal: number, vertical: number, length: number) {
  const chord = Math.hypot(horizontal, vertical);
  if (horizontal < 1e-5 || length - chord < 1e-5) return 0;
  const ratio = Math.sqrt(length * length - vertical * vertical) / horizontal;
  let u = Math.sqrt(6 * (ratio - 1));
  for (let i = 0; i < 4; i++) {
    const sh = Math.sinh(u);
    u -= ((sh / u - ratio) * u * u) / (u * Math.cosh(u) - sh);
  }
  return horizontal / (2 * u);
}

function cableGeometry() {
  const g = new T.BufferGeometry(),
    count = (RINGS + 1) * SIDES;
  for (const name of ['position', 'normal'])
    g.setAttribute(
      name,
      new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage),
    );
  const colours = new Float32Array(count * 3),
    indices: number[] = [];
  const hemp = new T.Color(0xbca471),
    dark = new T.Color(0x817752),
    c = new T.Color();
  for (let ring = 0; ring <= RINGS; ring++)
    for (let side = 0; side < SIDES; side++) {
      const i = ring * SIDES + side,
        j = ring * SIDES + ((side + 1) % SIDES);
      c.copy(hemp)
        .lerp(dark, 0.35 + 0.3 * Math.cos((side + ring * 0.7) * Math.PI * 0.66))
        .toArray(colours, i * 3);
      if (ring < RINGS) indices.push(i, i + SIDES, j, j, i + SIDES, j + SIDES);
    }
  g.setIndex(indices);
  g.setAttribute('color', new T.BufferAttribute(colours, 3));
  // Coordinates are local to the mooring, including the complete restrained swing.
  g.boundingSphere = new T.Sphere(new T.Vector3(0, 0.4, 0), 5.1);
  return g;
}

export class LaunchMooring {
  readonly root = new T.Group();
  readonly float: T.Mesh;
  private readonly eye: T.Mesh;
  readonly line: T.Mesh;
  private readonly bow = new T.Vector3();
  private readonly head = new T.Vector3();
  private readonly orbital = { x: 0, z: 0 };
  private readonly attitude = { heave: 0, pitch: 0, roll: 0 };
  private readonly s: number;
  private readonly c: number;
  constructor(
    private readonly hull: T.Group,
    private readonly baseYaw: number,
    private readonly datum: number,
    hardware: MooringHardware,
  ) {
    this.s = Math.sin(baseYaw);
    this.c = Math.cos(baseYaw);
    this.root.position.set(
      hull.position.x + this.s * SEPARATION,
      datum,
      hull.position.z + this.c * SEPARATION,
    );
    this.root.name = 'Port Ilse swing mooring';
    this.float = new T.Mesh(hardware.float, hardware.paint);
    this.float.name = 'Enamelled mooring float';
    this.eye = new T.Mesh(hardware.eye, hardware.zinc);
    this.eye.name = 'Stem towing eye';
    this.line = new T.Mesh(cableGeometry(), hardware.rope);
    this.line.name = 'Spliced mooring pennant';
    this.float.castShadow =
      this.float.receiveShadow =
      this.eye.castShadow =
      this.line.receiveShadow =
        true;
    this.root.add(this.float, this.line);
    hull.add(this.eye);
  }

  update(time: number, distance: number, low: boolean) {
    const anchor = this.root.position;
    harbourOrbitalDisplacement(anchor.x, anchor.z, time, this.orbital);
    const cross = this.orbital.x * this.c - this.orbital.z * this.s;
    const along = this.orbital.x * this.s + this.orbital.z * this.c;
    // The buoy anchors the bow. The longer stern arm swings farther across the swell.
    const yaw = this.baseYaw + 0.32 * cross,
      tether = SEPARATION - 0.3 * along;
    const s = Math.sin(yaw),
      c = Math.cos(yaw);
    const x = anchor.x - s * tether,
      z = anchor.z - c * tether;
    sampleLaunchAttitude(x, z, yaw, time, this.attitude);
    this.hull.position.set(x, this.datum - 0.03 + this.attitude.heave, z);
    this.hull.rotation.set(this.attitude.pitch, yaw, this.attitude.roll, 'YXZ');
    this.root.visible = distance < (low ? 130 : 310);
    this.eye.visible = this.line.visible = distance < (low ? 48 : 110);
    if (!this.root.visible) return;
    const bx = 0.49 * this.orbital.x,
      bz = 0.49 * this.orbital.z;
    const h = harbourWaveHeight(anchor.x + bx, anchor.z + bz, time);
    this.float.position.set(bx, h, bz);
    // A short float follows the local slope, the nine-metre launch averages four supports.
    const r = 0.24,
      sx =
        (harbourWaveHeight(anchor.x + bx + r, anchor.z + bz, time) -
          harbourWaveHeight(anchor.x + bx - r, anchor.z + bz, time)) /
        (2 * r);
    const sz =
      (harbourWaveHeight(anchor.x + bx, anchor.z + bz + r, time) -
        harbourWaveHeight(anchor.x + bx, anchor.z + bz - r, time)) /
      (2 * r);
    this.float.rotation.set(-Math.atan(sz), 0, Math.atan(sx), 'YXZ');
    if (!this.line.visible) return;
    this.bow.copy(BOW).applyQuaternion(this.hull.quaternion).add(this.hull.position).sub(anchor);
    this.head.copy(HEAD).applyQuaternion(this.float.quaternion).add(this.float.position);
    this.updateLine();
  }

  private updateLine() {
    const a = this.bow,
      b = this.head,
      dx = b.x - a.x,
      dz = b.z - a.z,
      dy = b.y - a.y;
    const h = Math.hypot(dx, dz),
      tx = dx / h,
      tz = dz / h;
    const scale = catenary(h, dy, ROPE_LENGTH);
    const start = scale ? Math.atanh(dy / ROPE_LENGTH) - h / (2 * scale) : 0;
    const pos = this.line.geometry.getAttribute('position') as T.BufferAttribute;
    const normal = this.line.geometry.getAttribute('normal') as T.BufferAttribute;
    for (let ring = 0; ring <= RINGS; ring++) {
      const t = ring / RINGS,
        v = start + (scale ? (h * t) / scale : 0);
      const y = scale ? a.y + scale * (Math.cosh(v) - Math.cosh(start)) : a.y + t * dy;
      const slope = scale ? Math.sinh(v) : dy / h,
        inv = 1 / Math.hypot(1, slope);
      for (let side = 0; side < SIDES; side++) {
        const angle = side * ((2 * Math.PI) / SIDES),
          u = Math.cos(angle),
          w = Math.sin(angle);
        const nx = -tz * u - tx * slope * inv * w,
          ny = inv * w,
          nz = tx * u - tz * slope * inv * w;
        const i = ring * SIDES + side;
        pos.setXYZ(
          i,
          a.x + t * dx + ROPE_RADIUS * nx,
          y + ROPE_RADIUS * ny,
          a.z + t * dz + ROPE_RADIUS * nz,
        );
        normal.setXYZ(i, nx, ny, nz);
      }
    }
    pos.needsUpdate = normal.needsUpdate = true;
  }

  dispose() {
    this.line.geometry.dispose();
    this.eye.removeFromParent();
    this.root.removeFromParent();
    this.root.clear();
  }
}
