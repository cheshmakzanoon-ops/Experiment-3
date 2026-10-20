import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { box, mergeStatic } from '../geometry.ts';
import type { PaddockMaterials } from '../paddock-detail.ts';
import { installCircuitFinish } from '../circuit-finish.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';

interface GpPaddockStyle {
  accent: number;
  /** Original roof cross-section: [local X, height above the garage base]. */
  roof: readonly (readonly [number, number])[];
  shade: number;
  sawtooth: number;
}

/** REF032/062/077 show deep overhangs, roof framing, layered glazing and
 * repeating pit bays. These four profiles are original venue architecture,
 * not copied circuit buildings. All reuse the existing garage foundations. */
export const GP_PADDOCK_STYLES: Readonly<Record<string, GpPaddockStyle>> = {
  'poggio-alto': {
    accent: 0x934d3c,
    roof: [
      [-9.2, 10.94],
      [-6.5, 11.22],
      [1.5, 11.7],
      [7.1, 11.45],
    ],
    shade: 2,
    sawtooth: 0,
  },
  'cape-wrenna': {
    accent: 0x557b8e,
    roof: [
      [-10, 11.75],
      [-6.5, 11.02],
      [-1, 10.82],
      [7.1, 11.24],
    ],
    shade: 1,
    sawtooth: 0,
  },
  haarveld: {
    accent: 0x405f88,
    roof: [
      [-9.3, 11.05],
      [-6.5, 11.25],
      [0, 11.42],
      [7.1, 10.98],
    ],
    shade: 1,
    sawtooth: 0.95,
  },
  montejaral: {
    accent: 0xa37a48,
    roof: [
      [-10.2, 11.06],
      [-6.5, 11.2],
      [1, 11.45],
      [7.1, 11.08],
    ],
    shade: 4,
    sawtooth: 0,
  },
  steinhorn: {
    accent: 0x2f7f8e,
    roof: [
      [-9.8, 11.3],
      [-6.5, 11.55],
      [0.5, 11.2],
      [7.1, 10.92],
    ],
    shade: 2,
    sawtooth: 0.7,
  },
  'zafra-night': {
    accent: 0xae8c48,
    roof: [
      [-10.4, 11.0],
      [-6.5, 11.32],
      [0, 11.5],
      [7.1, 11.12],
    ],
    shade: 3,
    sawtooth: 0,
  },
};

export interface GpPaddockBay {
  index: number;
  s: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
}

/** Match buildGarageBay's actual station, bank datum and mirrored local
 * frame. A single straight upper slab previously bridged over a sloping row
 * of garages; individual modules now remain attached to each foundation. */
export function gpPaddockPlan(track: Track): readonly GpPaddockBay[] {
  if (!isGpCourse(track)) return [];
  const pit = track.pit,
    side = pit.side,
    spacing = Math.max(9, pit.boxSpacing),
    centre = pit.firstBox + 5.5 * pit.boxSpacing,
    front = pit.offset + 6.5;
  return Array.from({ length: 12 }, (_, index) => {
    const s = centre + (index - 5.5) * spacing,
      p = track.at(s, trackPoint()),
      lateral = side * (front + 6.5);
    return {
      index,
      s,
      x: p.x + p.nx * lateral,
      y: p.y + p.bank * clamp(side * front, -12, 12) + 0.02,
      z: p.z + p.nz * lateral,
      yaw: Math.atan2(p.tx, p.tz) + (side > 0 ? 0 : Math.PI),
      width: spacing,
    };
  });
}

function roofHeight(style: GpPaddockStyle, x: number, z: number, width: number) {
  const profile = style.roof;
  let y = profile[profile.length - 1][1];
  for (let i = 1; i < profile.length; i++) {
    const [a, b] = [profile[i - 1], profile[i]];
    if (x > b[0]) continue;
    y = T.MathUtils.lerp(a[1], b[1], clamp((x - a[0]) / (b[0] - a[0]), 0, 1));
    break;
  }
  // The heath venue has a shallow repeat along the pit row. The lowered
  // back edge and raised front edge create a real folded sawtooth silhouette.
  return y + style.sawtooth * (0.5 + z / width);
}

/** A solid folded roof, including underside and fascia. Independent face
 * normals retain the folded planes; all faces have metre-based UVs. */
export function gpPaddockRoofGeometry(id: string, width: number) {
  const style = GP_PADDOCK_STYLES[id];
  if (!style || !Number.isFinite(width) || width <= 0) throw new Error('Invalid GP paddock roof');
  const positions: number[] = [],
    normals: number[] = [],
    uv: number[] = [];
  const face = (corners: readonly T.Vector3[]) => {
    const normal = new T.Vector3()
      .subVectors(corners[1], corners[0])
      .cross(new T.Vector3().subVectors(corners[2], corners[0]))
      .normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(corners[i].x, corners[i].y, corners[i].z);
      normals.push(normal.x, normal.y, normal.z);
      // A non-degenerate planar footprint on every face, including fascia.
      const [a, b] =
        Math.abs(normal.y) > 0.5
          ? [corners[i].x, corners[i].z]
          : Math.abs(normal.x) > 0.5
            ? [corners[i].z, corners[i].y]
            : [corners[i].x, corners[i].y];
      uv.push(a, b);
    }
  };
  const vertex = (x: number, z: number, bottom = false) =>
    new T.Vector3(x, roofHeight(style, x, z, width) - (bottom ? 0.18 : 0), z);
  const back = -width / 2,
    front = width / 2;
  for (let i = 1; i < style.roof.length; i++) {
    const a = style.roof[i - 1][0],
      b = style.roof[i][0];
    face([vertex(a, back), vertex(a, front), vertex(b, front), vertex(b, back)]);
    face([
      vertex(a, back, true),
      vertex(b, back, true),
      vertex(b, front, true),
      vertex(a, front, true),
    ]);
    face([vertex(a, front), vertex(a, front, true), vertex(b, front, true), vertex(b, front)]);
    face([vertex(a, back), vertex(b, back), vertex(b, back, true), vertex(a, back, true)]);
  }
  const a = style.roof[0][0],
    b = style.roof[style.roof.length - 1][0];
  face([vertex(a, back), vertex(a, back, true), vertex(a, front, true), vertex(a, front)]);
  face([vertex(b, back), vertex(b, front), vertex(b, front, true), vertex(b, back, true)]);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function beam(root: T.Group, material: T.Material, a: T.Vector3, b: T.Vector3, width = 0.075) {
  const delta = b.clone().sub(a),
    mesh = new T.Mesh(new T.BoxGeometry(width, delta.length(), width), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
}

export function buildGpPaddockArchitecture(track: Track, materials: PaddockMaterials) {
  const plan = gpPaddockPlan(track);
  if (!plan.length) return null;
  const style = GP_PADDOCK_STYLES[track.circuit.id],
    root = new T.Group(),
    accent = new T.MeshStandardMaterial({ color: style.accent, roughness: 0.67, metalness: 0.12 });
  root.name = 'GP layered pit architecture · ' + track.circuit.short;
  root.userData.gpPaddockBays = plan;
  accent.name = 'GP pit architectural enamel';
  installCircuitFinish(accent, 'paint');
  tagWeatherSurface(accent, 'paint');
  for (const material of [materials.steel, materials.cladding])
    tagWeatherSurface(material, 'metal');
  for (const site of plan) {
    const bay = new T.Group(),
      width = site.width - 0.06;
    bay.position.set(site.x, site.y, site.z);
    bay.rotation.y = site.yaw;
    root.add(bay);
    // The upper level has depth: floor, rear wall, recessed glazing and
    // projecting terrace. No new supports enter the active pit-lane corridor.
    box(bay, materials.concrete, 0, 6.59, 0, 13.1, 0.24, width);
    box(bay, materials.interior, 6.29, 8.46, 0, 0.3, 3.5, width);
    box(bay, materials.interior, 0, 10.2, 0, 12.6, 0.14, width);
    box(bay, materials.glass, -6.38, 8.43, 0, 0.08, 3.4, width - 0.16);
    box(bay, materials.cladding, -6.48, 6.96, 0, 0.24, 0.5, width);
    box(bay, accent, -6.55, 10.15, 0, 0.22, 0.34, width);
    box(bay, materials.concrete, -7.25, 6.7, 0, 1.6, 0.22, width);
    box(bay, materials.glass, -8.02, 7.29, 0, 0.065, 1.05, width - 0.16);
    box(bay, materials.steel, -8.05, 7.84, 0, 0.07, 0.07, width);
    for (const z of [-width / 2 + 0.08, 0, width / 2 - 0.08]) {
      box(bay, materials.steel, -6.52, 8.47, z, 0.13, 3.48, 0.08);
      box(bay, materials.steel, -8.05, 7.3, z, 0.075, 1.1, 0.075);
    }
    // Sun screens differ in depth and spacing, not arbitrary textures. They
    // cast real narrow shadows over the glazing in morning and evening light.
    for (let slat = 0; slat < style.shade; slat++) {
      const y = 9.15 + slat * 0.25;
      box(bay, materials.cladding, -6.97, y, 0, 1.14, 0.065, width);
    }
    const roof = new T.Mesh(
      gpPaddockRoofGeometry(track.circuit.id, width + 0.06),
      materials.cladding,
    );
    roof.castShadow = roof.receiveShadow = true;
    bay.add(roof);
    for (const z of [-width / 2 + 0.16, width / 2 - 0.16]) {
      const firstX = style.roof[0][0] + 0.12,
        lastX = 6.7,
        lower = (x: number) => roofHeight(style, x, z, site.width) - 0.72,
        upper = (x: number) => roofHeight(style, x, z, site.width) - 0.24;
      for (let segment = 0; segment < 5; segment++) {
        const a = T.MathUtils.lerp(firstX, lastX, segment / 5),
          b = T.MathUtils.lerp(firstX, lastX, (segment + 1) / 5);
        beam(bay, materials.steel, new T.Vector3(a, lower(a), z), new T.Vector3(b, lower(b), z));
        beam(
          bay,
          materials.steel,
          new T.Vector3(a, lower(a), z),
          new T.Vector3(b, upper(b), z),
          0.055,
        );
        beam(
          bay,
          materials.steel,
          new T.Vector3(b, lower(b), z),
          new T.Vector3(b, upper(b), z),
          0.055,
        );
      }
      for (const x of [-6.1, 5.8])
        beam(bay, materials.steel, new T.Vector3(x, 6.72, z), new T.Vector3(x, upper(x), z), 0.14);
    }
    const fasciaY = roofHeight(style, style.roof[0][0], 0, site.width) - 0.08;
    const fascia = box(
      bay,
      accent,
      style.roof[0][0] - 0.015,
      fasciaY,
      0,
      0.075,
      0.24,
      Math.hypot(width, (style.sawtooth * width) / site.width),
    );
    fascia.rotation.x = -Math.atan2(style.sawtooth, site.width);
    // Opaque end walls close the two ends of the upper gallery. Intermediate
    // bays stay contiguous so windows do not read as independent containers.
    if (site.index === 0 || site.index === plan.length - 1) {
      // The left-side garage frame also reverses local Z. Close the physical
      // end of the row rather than putting its cap into the adjacent module.
      const end = ((site.index === 0 ? -1 : 1) * track.pit.side * width) / 2;
      box(bay, materials.cladding, 0, 8.4, end, 13, 3.4, 0.16);
    }
  }
  // Six materials, no new textures/lights, no per-frame work. Explicitly merge
  // here so twelve structural bay repeats do not create hundreds of draws.
  mergeStatic(root);
  return root;
}
