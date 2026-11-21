import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Structure } from '../../simulation/open-world/placement.ts';
import { rodGeometry } from '../vehicle-bodies/loft.ts';

const SECTORS = 8,
  START = Math.PI / SECTORS;
const STEEL = 0x465153,
  ZINC = 0x818a86,
  CONCRETE = 0xb9b4a3;

function merge(parts: T.BufferGeometry[], material: T.Material, name: string) {
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
function tint(parts: T.BufferGeometry[], geometry: T.BufferGeometry, hex: number) {
  const colour = new T.Color(hex),
    count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colour.toArray(colors, i * 3);
  geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  parts.push(geometry);
}
function box(x: number, y: number, z: number, w: number, h: number, d: number, yaw = 0) {
  return new T.BoxGeometry(w, h, d).rotateY(yaw).translate(x, y, z);
}
function ring(radius: number, y: number, index: number) {
  const a = START + (index * 2 * Math.PI) / SECTORS;
  return new T.Vector3(Math.sin(a) * radius, y, Math.cos(a) * radius);
}
function drum(lo: number, hi: number, y0: number, y1: number) {
  return new T.CylinderGeometry(hi, lo, y1 - y0, SECTORS, 1, false, START).translate(
    0,
    (y1 + y0) / 2,
    0,
  );
}

/** Real consoles, mullions, soffits and ceiling remain visible through the
 * raked cab glazing from both the town and runway approaches. */
export class AirfieldTower {
  readonly root = new T.Group();
  private readonly metal = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.61,
    metalness: 0.18,
  });
  private readonly glazing = new T.MeshPhysicalMaterial({
    color: 0xadc8cb,
    roughness: 0.11,
    metalness: 0.04,
    clearcoat: 0.32,
    opacity: 0.25,
    transparent: true,
    depthWrite: false,
    flatShading: true,
  });
  private readonly illuminated = new T.MeshBasicMaterial({ vertexColors: true });
  private readonly fittings: T.Mesh;
  readonly triangles: number;

  constructor(s: Structure) {
    this.root.name = 'Kestrel air traffic control';
    this.root.position.set(s.x, s.base, s.z);
    this.root.rotation.y = -s.heading;
    const structure: T.BufferGeometry[] = [],
      hardware: T.BufferGeometry[] = [],
      lights: T.BufferGeometry[] = [];
    const r = Math.min(s.hx, s.hz);
    const gallery = s.height - 1.35,
      sill = gallery + 1.02,
      head = sill + 2.62;
    const galleryRadius = r * 1.58,
      cabBottom = r * 1.13,
      cabTop = r * 1.32;
    // The ground-floor walls coincide with the driving collision footprint.
    // Recessed stair glazing climbs to the watch gallery on opposing walls.
    tint(structure, box(0, gallery / 2, 0, 2 * s.hx - 0.48, gallery, 2 * s.hz - 0.48), 0x736f61);
    for (let i = 0; i < 4; i++) {
      const yaw = (i * Math.PI) / 2,
        reach = i % 2 ? s.hx : s.hz,
        half = i % 2 ? s.hz : s.hx;
      const face = (across: number, y: number, depth: number, w: number, h: number, d: number) =>
        box(
          Math.cos(yaw) * across + Math.sin(yaw) * (reach + depth),
          y,
          -Math.sin(yaw) * across + Math.cos(yaw) * (reach + depth),
          w,
          h,
          d,
          yaw,
        );
      if (i === 0 || i === 2) {
        const inset = half * 0.28,
          slit = 0.99;
        const x0 = inset - slit / 2,
          x1 = inset + slit / 2;
        tint(
          structure,
          face((-half + x0) / 2, gallery / 2, -0.11, half + x0, gallery, 0.22),
          CONCRETE,
        );
        tint(
          structure,
          face((half + x1) / 2, gallery / 2, -0.11, half - x1, gallery, 0.22),
          CONCRETE,
        );
        tint(structure, face(inset, 1.3, -0.11, slit, 2.6, 0.22), CONCRETE);
        tint(
          structure,
          face(inset, (gallery + 2.6) / 2, -0.19, slit, gallery - 2.6, 0.04),
          0x455c60,
        );
        for (let y = 3.9; y < gallery - 0.9; y += 2.85)
          tint(hardware, face(inset, y, -0.05, slit, 0.13, 0.17), STEEL);
      } else tint(structure, face(0, gallery / 2, -0.11, half * 2, gallery, 0.22), CONCRETE);
      for (let y = 4.5; y < gallery - 0.8; y += 4.45)
        tint(hardware, face(-half * 0.49, y, -0.003, half * 0.96, 0.035, 0.016), 0x8e8c7f);
      if (i === 0) {
        tint(hardware, face(-half * 0.41, 1.6, 0.007, 1.38, 2.55, 0.03), STEEL);
        tint(hardware, face(-half * 0.41, 1.61, 0.034, 1.15, 2.36, 0.044), 0x6c776f);
        tint(hardware, face(-half * 0.41, 2.0, 0.065, 0.59, 0.48, 0.026), 0x374c50);
        tint(hardware, face(-half * 0.41, 3.0, 0.35, 1.76, 0.12, 0.76), ZINC);
      }
    }
    tint(structure, drum(r * 0.98, galleryRadius, gallery - 2.38, gallery - 0.24), 0x8e9791);
    tint(structure, drum(galleryRadius, galleryRadius, gallery - 0.24, gallery), STEEL);
    tint(structure, drum(cabBottom, cabBottom, gallery, sill), 0xa2aaa3);
    tint(structure, drum(cabBottom + 0.07, cabBottom + 0.05, sill - 0.14, sill), STEEL);
    tint(structure, drum(cabTop + 0.21, cabTop + 0.34, head, head + 0.18), 0x354143);
    tint(structure, drum(cabTop + 0.34, cabTop + 0.31, head + 0.18, head + 0.4), 0xb8b9ae);
    tint(structure, drum(cabTop + 0.31, 0.81, head + 0.4, head + 0.73), 0x7d8886);
    const railRadius = galleryRadius - 0.16;
    for (let i = 0; i < SECTORS; i++) {
      tint(
        structure,
        rodGeometry(ring(cabBottom, sill, i), ring(cabTop, head, i), 0.089, 6),
        STEEL,
      );
      tint(
        hardware,
        rodGeometry(ring(railRadius, gallery, i), ring(railRadius, gallery + 1.07, i), 0.04, 6),
        ZINC,
      );
      for (const h of [0.48, 1.07])
        tint(
          hardware,
          rodGeometry(
            ring(railRadius, gallery + h, i),
            ring(railRadius, gallery + h, i + 1),
            h > 1 ? 0.048 : 0.026,
            6,
          ),
          ZINC,
        );
      const a = START + ((i + 0.5) * 2 * Math.PI) / SECTORS,
        c = Math.cos(a),
        n = Math.sin(a);
      const station = cabBottom * 0.72;
      tint(hardware, box(n * station, sill - 0.02, c * station, 1.65, 0.88, 0.71, a), 0x454f50);
      tint(hardware, box(n * station, sill + 0.46, c * station, 1.79, 0.11, 0.85, a), 0x64716f);
      if (i % 2 === 0) {
        const screen = new T.BoxGeometry(0.65, 0.32, 0.04)
          .rotateX(-0.14)
          .rotateY(a)
          .translate(n * (station + 0.14), sill + 0.69, c * (station + 0.14));
        tint(lights, screen, 0x9fc9c2);
      }
      tint(lights, box(n * station, head - 0.042, c * station, 1.48, 0.052, 0.13, a), 0xffe4b5);
    }
    const aerial = new T.Vector3(r * 0.38, head + 0.63, 0);
    tint(
      structure,
      rodGeometry(aerial, aerial.clone().add(new T.Vector3(0, 2.82, 0)), 0.05, 8),
      ZINC,
    );
    tint(
      hardware,
      rodGeometry(
        aerial.clone().add(new T.Vector3(0, 2.55, 0)),
        aerial.clone().add(new T.Vector3(0.36, 2.55, 0)),
        0.021,
        6,
      ),
      STEEL,
    );
    tint(lights, new T.SphereGeometry(0.105, 8, 5).translate(aerial.x, head + 3.48, 0), 0xff3e21);
    const shell = merge(structure, this.metal, 'Control tower core, gallery and roof');
    this.fittings = merge(hardware, this.metal, 'Gallery rails, consoles and stair details');
    const practical = merge(lights, this.illuminated, 'Cab luminaires, displays and aerial lamp');
    practical.castShadow = false;
    const panes = new T.Mesh(
      new T.CylinderGeometry(cabTop, cabBottom, head - sill, SECTORS, 1, true, START).translate(
        0,
        (sill + head) / 2,
        0,
      ),
      this.glazing,
    );
    panes.name = 'Eight outward-raked control-room panes';
    this.root.add(shell, this.fittings, practical, panes);
    this.triangles = this.root.children.reduce((total, o) => {
      const g = (o as T.Mesh).geometry;
      return total + (g.index?.count ?? g.getAttribute('position').count) / 3;
    }, 0);
  }
  update(eye: T.Vector3, pixelsPerMetreAtOneMetre: number) {
    const projected = pixelsPerMetreAtOneMetre / Math.max(1, this.root.position.distanceTo(eye));
    this.fittings.visible = projected > (this.fittings.visible ? 1.5 : 1.9);
  }
  setNight(night: number) {
    this.illuminated.color.setScalar(0.43 + night * 2.7);
  }
  dispose() {
    for (const child of this.root.children) (child as T.Mesh).geometry.dispose();
    this.root.removeFromParent();
    this.metal.dispose();
    this.glazing.dispose();
    this.illuminated.dispose();
  }
}
