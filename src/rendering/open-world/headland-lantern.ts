import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Structure } from '../../simulation/open-world/placement.ts';

const REVOLUTION = 16;
const TAU = Math.PI * 2;

/** A fixed observer sees the two opposed lenses pass eight seconds apart.
 * Horizontal bearing and vertical elevation both restrict the focal lobe. */
export function headlandSignal(time: number, dx: number, dy: number, dz: number) {
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 0.01) return 0;
  const yaw = ((time % REVOLUTION) / REVOLUTION) * TAU;
  return Math.abs((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / distance) ** 48;
}

function coronaMap() {
  const n = 32,
    data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
      const offset = (y * n + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = Math.round(255 * Math.max(0, 1 - r) ** 2);
    }
  const texture = new T.DataTexture(data, n, n);
  texture.magFilter = texture.minFilter = T.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** The painted structure, lantern glazing and rotating dioptric optic each
 * occupy one draw. All positions are local to the surveyed tower crown. */
export class HeadlandLantern {
  readonly group = new T.Group();
  private readonly iron = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.32,
  });
  private readonly glass = new T.MeshStandardMaterial({
    color: 0xa5c0c7,
    roughness: 0.18,
    metalness: 0.25,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  private readonly corona = new T.SpriteMaterial({
    map: coronaMap(),
    color: 0xffe5ae,
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  private readonly glow = new T.Sprite(this.corona);
  private readonly lens: T.Mesh;
  private readonly centre = new T.Vector3();

  constructor(
    s: Structure,
    private readonly lamp: T.MeshStandardMaterial,
  ) {
    const baseRadius = Math.min(s.hx, s.hz),
      deck = baseRadius * 0.94;
    const room = deck * 0.65,
      height = 2.8,
      sill = 0.49,
      segments = 32;
    const parts: T.BufferGeometry[] = [];
    const add = (geometry: T.BufferGeometry, finish: number) => {
      const colour = new T.Color(finish),
        count = geometry.getAttribute('position').count;
      const array = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) colour.toArray(array, i * 3);
      geometry.setAttribute('color', new T.BufferAttribute(array, 3));
      parts.push(geometry);
    };
    const cylinder = (
      upper: number,
      lower: number,
      h: number,
      y: number,
      finish: number,
      sides = segments,
    ) => add(new T.CylinderGeometry(upper, lower, h, sides).translate(0, y, 0), finish);
    const oxidised = 0x454c49,
      enamel = 0x833e39,
      stone = 0xc1b8a8;
    cylinder(deck, baseRadius * 0.69, 0.55, -0.19, stone);
    cylinder(deck + 0.07, deck, 0.2, 0.17, oxidised);
    cylinder(room + 0.1, room + 0.08, 0.32, 0.4, enamel, 12);
    cylinder(room + 0.17, room + 0.1, 0.18, sill + height, oxidised, 12);
    cylinder(0.34, room + 0.31, 1.13, sill + height + 0.63, enamel, 12);
    cylinder(0.17, 0.26, 0.38, sill + height + 1.33, oxidised, 12);
    cylinder(0.018, 0.09, 0.85, sill + height + 1.9, oxidised, 8);
    const railRadius = deck - 0.105;
    for (const y of [0.74, 1.27])
      add(
        new T.TorusGeometry(railRadius, y > 1 ? 0.043 : 0.028, 5, segments)
          .rotateX(Math.PI / 2)
          .translate(0, y, 0),
        oxidised,
      );
    for (let k = 0; k < 12; k++) {
      const a = (TAU * k) / 12,
        x = Math.sin(a),
        z = Math.cos(a);
      add(
        new T.CylinderGeometry(0.037, 0.047, 1.08, 6).translate(
          x * railRadius,
          0.76,
          z * railRadius,
        ),
        oxidised,
      );
      add(
        new T.BoxGeometry(0.084, height, 0.1)
          .rotateY(a)
          .translate(x * room, sill + height * 0.5, z * room),
        oxidised,
      );
    }
    // Recess colours, reveals and sills turn up a staggered keeper's stair.
    for (let k = 0; k < 4; k++) {
      const fraction = 0.2 + k * 0.195,
        a = 2.15 + k * 1.58;
      const y = s.height * (fraction - 1),
        r = baseRadius * (1 - fraction * 0.28);
      const panel = (w: number, h: number, d: number, dy: number, inset: number, color: number) =>
        add(new T.BoxGeometry(w, h, d).translate(0, y + dy, r + inset).rotateY(a), color);
      panel(0.84, 1.25, 0.13, 0, -0.025, stone);
      panel(0.55, 0.94, 0.07, 0, 0.05, 0x343f42);
      panel(0.95, 0.12, 0.26, -0.58, 0.045, oxidised);
    }
    // The turntable and central spindle support the optic above the sill.
    cylinder(0.45, 0.55, 0.22, sill + 0.15, oxidised);
    cylinder(0.16, 0.29, 0.89, sill + 0.68, 0x71654c);
    cylinder(0.41, 0.29, 0.12, sill + 1.17, oxidised);
    const shell = new T.Mesh(mergeGeometries(parts)!, this.iron);
    for (const part of parts) part.dispose();
    shell.name = 'Headland gallery, keeper windows and lantern ironwork';
    shell.castShadow = shell.receiveShadow = true;
    const glazing = new T.Mesh(new T.CylinderGeometry(room, room, height, 12, 1, true), this.glass);
    glazing.name = 'Twelve lantern-room panes';
    glazing.position.y = sill + height / 2;
    // Stepped annular prisms preserve the lens silhouette and reflected bands.
    const profile = [new T.Vector2(0, 0.41)];
    const radius = Math.min(0.95, room * 0.49);
    for (let i = 1; i <= 8; i++) {
      const u = i / 8,
        r = radius * u;
      profile.push(new T.Vector2(r - 0.015, 0.21 + 0.19 * (1 - u * u)), new T.Vector2(r, 0.15));
    }
    profile.push(new T.Vector2(radius, 0.1), new T.Vector2(0, 0.1));
    const front = new T.LatheGeometry(profile.reverse(), 40).rotateX(Math.PI / 2);
    const count = front.getAttribute('position').count,
      rgba = new Float32Array(count * 3);
    const pass = new Float32Array(count),
      coord = front.getAttribute('position');
    const tint = new T.Color();
    for (let i = 0; i < count; i++) {
      const r = Math.hypot(coord.getX(i), coord.getY(i)) / radius;
      const facet = coord.getZ(i) > 0.202,
        core = r < 0.18;
      tint.setHex(core ? 0xd4ba83 : facet ? 0x9db9ad : 0x476461).toArray(rgba, i * 3);
      pass[i] = core ? 1 : facet ? 0.72 : 0.24;
    }
    front.setAttribute('color', new T.BufferAttribute(rgba, 3));
    front.setAttribute('opticPass', new T.BufferAttribute(pass, 1));
    const back = front.clone().rotateY(Math.PI);
    const rotor: T.BufferGeometry[] = [front, back];
    for (const side of [-1, 1]) {
      const rim = new T.TorusGeometry(radius + 0.025, 0.043, 6, 40).translate(0, 0, side * 0.19);
      const n = rim.getAttribute('position').count,
        bronze = new Float32Array(n * 3);
      tint.setHex(0x71634a);
      for (let i = 0; i < n; i++) tint.toArray(bronze, i * 3);
      rim.setAttribute('color', new T.BufferAttribute(bronze, 3));
      rim.setAttribute('opticPass', new T.BufferAttribute(new Float32Array(n), 1));
      rotor.push(rim);
    }
    const optic = mergeGeometries(rotor)!;
    for (const piece of rotor) piece.dispose();
    lamp.color.setHex(0xf0f3ef);
    lamp.vertexColors = true;
    lamp.roughness = 0.24;
    lamp.metalness = 0.23;
    chainShaderHook(lamp, 'headland-lens-transmission-v1', (shader) => {
      injectDeclarations(
        shader,
        'common',
        'attribute float opticPass; varying float vOpticPass;',
        'vertex',
      );
      injectAfter(shader, 'begin_vertex', 'vOpticPass = opticPass;', 'vertex');
      injectDeclarations(shader, 'common', 'varying float vOpticPass;', 'fragment');
      injectAfter(
        shader,
        'emissivemap_fragment',
        'totalEmissiveRadiance *= vOpticPass;',
        'fragment',
      );
    });
    this.lens = new T.Mesh(optic, lamp);
    this.lens.name = 'Lighthouse lantern';
    this.lens.position.y = glazing.position.y;
    this.glow.name = 'Headland optical flash';
    this.glow.position.copy(this.lens.position);
    this.glow.visible = false;
    this.glow.renderOrder = 3;
    this.group.name = 'Port Ilse headland light';
    this.group.position.set(s.x, s.base + s.height, s.z);
    this.group.add(shell, this.lens, glazing, this.glow);
    this.centre.copy(this.group.position).add(this.lens.position);
  }

  update(time: number, night: number, eye?: T.Vector3) {
    this.lens.rotation.y = ((time % REVOLUTION) / REVOLUTION) * TAU;
    const pulse = eye
      ? headlandSignal(time, eye.x - this.centre.x, eye.y - this.centre.y, eye.z - this.centre.z)
      : 0;
    this.lamp.emissiveIntensity = 0.014 + night * (0.09 + 19 * pulse);
    const distance = eye ? eye.distanceTo(this.centre) : 0;
    this.corona.opacity = night * (0.015 + pulse * 0.83);
    this.glow.visible = this.corona.opacity > 0.03 && distance > 22;
    this.glow.scale.setScalar(Math.min(15, 1.3 + distance * 0.006));
  }

  dispose() {
    // The building set releases the merged mesh geometries during traversal.
    this.lamp.dispose();
    this.iron.dispose();
    this.glass.dispose();
    this.corona.map?.dispose();
    this.corona.dispose();
  }
}
