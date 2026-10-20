import * as T from 'three';
import type { Track } from '../../simulation/track.ts';
import type { BroadcastSightlines } from '../broadcast-sightlines.ts';
import { box, mergeStatic, mesh, rod } from '../geometry.ts';
import type { StandSpec } from '../venue-plan.ts';

/** REF 032/036/077: open spectator terraces, thin overhanging roofs and
 * repeated exposed structural bays. The four profiles below are original
 * venue architecture; the reference pictures supply no engineering dimensions. */
const STYLES = Object.freeze({
  'poggio-alto': {
    label: 'POGGIO ALTO  /  AUTODROMO',
    background: '#763b35',
    steel: 0x514943,
    roof: 0xc9c5ba,
    seats: [0x762f29, 0x899087, 0x34423a, 0xa8a59b],
    pitch: 16,
    profile: 'raised eaves',
  },
  'cape-wrenna': {
    label: 'CAPE WRENNA  /  GRAND PRIX',
    background: '#365b6c',
    steel: 0x3b505b,
    roof: 0xc4cdd0,
    seats: [0x315d75, 0x7497a0, 0x9ea8a4, 0x34424e],
    pitch: 16,
    profile: 'coastal sail',
  },
  haarveld: {
    label: 'HAARVELD  /  GRAND PRIX',
    background: '#345074',
    steel: 0x3d4a57,
    roof: 0xc7cbd0,
    seats: [0x315481, 0x71869c, 0x9caaaf, 0x304151],
    pitch: 12,
    profile: 'folded crown',
  },
  montejaral: {
    label: 'MONTEJARAL  /  CIRCUITO',
    background: '#94603d',
    steel: 0x5a4e42,
    roof: 0xd0c6b4,
    seats: [0x98613d, 0xb4976f, 0x87765e, 0x42483d],
    pitch: 20,
    profile: 'sun visor',
  },
  steinhorn: {
    label: 'STEINHORN  /  ALPENRING',
    background: '#2b6874',
    steel: 0x3e4b50,
    roof: 0xd3d7d6,
    seats: [0x2a7f91, 0xa9b0ae, 0x9b2e2c, 0x323d42],
    pitch: 14,
    profile: 'alpine ridge',
  },
  'zafra-night': {
    label: 'ZAFRA  /  NIGHT GRAND PRIX',
    background: '#7d5d31',
    steel: 0x4b4339,
    roof: 0xd9cfb8,
    seats: [0xb08a42, 0x2f6f52, 0x8f8776, 0x3a3a36],
    pitch: 18,
    profile: 'desert dune',
  },
});

type GpVenue = keyof typeof STYLES;
export function gpGrandstandStyle(venue: string) {
  return Object.hasOwn(STYLES, venue) ? STYLES[venue as GpVenue] : null;
}

const FRONT = -1.8;
const REAR = 10.8;
const THICKNESS = 0.16;

/** Height in the retained stand's local frame; u grows away from the road.
 * Broad roof profiles remain legible at riding speed. Repeated longitudinal
 * folds/sails have metre-valued pitches, independent of the stand length. */
function roofHeight(venue: GpVenue, u: number, z: number) {
  const t = T.MathUtils.clamp((u - FRONT) / (REAR - FRONT), 0, 1),
    phase = (z / STYLES[venue].pitch) * Math.PI * 2,
    wave = 0.5 + 0.5 * Math.cos(phase);
  switch (venue) {
    case 'poggio-alto':
      return 6.12 + t * 1.38 + 0.32 * Math.sin(Math.PI * t) + 0.16 * wave * (1 - t);
    case 'cape-wrenna':
      return 6.08 + t * 1.02 + 0.8 * Math.sin(Math.PI * t) + 0.75 * wave * (1 - t);
    case 'haarveld': {
      const fold = 1 - Math.abs(((((z / STYLES[venue].pitch + 0.5) % 1) + 1) % 1) * 2 - 1);
      return 6.08 + t * 1.28 + 0.86 * fold * (0.65 + 0.35 * t);
    }
    case 'montejaral':
      return 6.76 + t * 0.7 - 0.78 * Math.sin(Math.PI * t) + 0.2 * wave;
    case 'steinhorn': {
      // A pitched alpine ridge repeated along the stand, shedding snow both ways.
      const ridge = 1 - Math.abs(((((z / STYLES[venue].pitch) % 1) + 1) % 1) * 2 - 1);
      return 6.2 + t * 1.15 + 0.62 * ridge * Math.sin(Math.PI * t);
    }
    case 'zafra-night':
      // Low dune swells: a deep sun/dew shade sweeping up to the rear.
      return 6.3 + t * 1.5 + 0.42 * Math.sin(Math.PI * t * 0.85) + 0.3 * wave * t;
  }
}

/** Closed, thin canopy; its underside and end caps retain outward winding.
 * Rotate the complete geometry for left-side stands, never mirror a mesh with
 * negative scale (which would turn the shell inside out). */
export function gpGrandstandRoofGeometry(venue: string, length: number, side: -1 | 1 = 1) {
  if (
    !gpGrandstandStyle(venue) ||
    !Number.isFinite(length) ||
    length < 8 ||
    length > 240 ||
    (side !== -1 && side !== 1)
  )
    throw new Error('Invalid GP grandstand canopy');
  // Matching top/bottom triangle diagonals are essential: bending the six
  // independent faces of BoxGeometry gives opposite diagonals across curved
  // panels, so the underside can vary in thickness between the same vertices.
  const across = 18,
    along = Math.ceil((length + 1.5) / 1.5),
    positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    vertex = (u: number, z: number, sign: number) => {
      const index = positions.length / 3;
      positions.push(u, roofHeight(venue as GpVenue, u, z) + (sign * THICKNESS) / 2, z);
      uvs.push(u / 5, z / 5);
      return index;
    },
    uAt = (i: number) => FRONT + ((REAR - FRONT) * i) / across,
    zAt = (j: number) => -(length + 1.5) / 2 + ((length + 1.5) * j) / along;
  for (const sign of [1, -1]) {
    const base = positions.length / 3;
    for (let j = 0; j <= along; j++) for (let i = 0; i <= across; i++) vertex(uAt(i), zAt(j), sign);
    for (let j = 0; j < along; j++)
      for (let i = 0; i < across; i++) {
        const a = base + j * (across + 1) + i,
          b = a + 1,
          c = a + across + 1,
          d = c + 1;
        if (sign > 0) indices.push(a, c, b, b, c, d);
        else indices.push(a, b, c, b, d, c);
      }
  }
  // Separate cap vertices preserve a crisp folded-sheet edge normal.
  const edge = (ua: number, za: number, ub: number, zb: number) => {
    const a = vertex(ua, za, 1),
      b = vertex(ua, za, -1),
      c = vertex(ub, zb, 1),
      d = vertex(ub, zb, -1);
    indices.push(a, b, c, c, b, d);
  };
  for (let j = 0; j < along; j++) {
    edge(FRONT, zAt(j), FRONT, zAt(j + 1));
    edge(REAR, zAt(j + 1), REAR, zAt(j));
  }
  for (let i = 0; i < across; i++) {
    edge(uAt(i + 1), zAt(0), uAt(i), zAt(0));
    edge(uAt(i), zAt(along), uAt(i + 1), zAt(along));
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (side < 0) geometry.rotateY(Math.PI);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface StandFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  ground(x: number, z: number): number;
}
interface StandMaterials {
  concrete: T.Material;
  steel: T.Material;
  roof: T.Material;
  underside: T.Material;
  sign: T.Material;
}

/** Builds into the existing stand frame, never moving its rows, aisles, crowd
 * or footprint. Four opaque material batches and one printed fascia; no new
 * textures, lights, tick callbacks or collision geometry are created here. */
export function buildGpGrandstandArchitecture(
  track: Track,
  parent: T.Group,
  site: StandSpec,
  frame: StandFrame,
  m: StandMaterials,
  sightlines?: BroadcastSightlines,
) {
  const style = gpGrandstandStyle(track.circuit.id);
  if (!style) return null;
  if (site.side !== -1 && site.side !== 1) throw new Error('Invalid GP grandstand side');
  const venue = track.circuit.id as GpVenue,
    root = new T.Group(),
    side = site.side,
    length = site.length;
  root.name = `${track.circuit.name} ${style.profile} grandstand`;
  root.userData.gpGrandstand = { venue, profile: style.profile, length, side };
  parent.add(root);
  box(root, m.concrete, side * 0.3, -0.12, 0, 2.5, 0.24, length);
  for (let row = 0; row < 8; row++)
    box(root, m.concrete, side * (1.7 + row * 0.98), row * 0.49 + 0.1, 0, 1.02, 0.2, length);
  box(root, m.concrete, side * 9.5, 3.53, 0, 1.25, 0.2, length);

  const bays = Math.ceil(length / 8),
    along = (index: number) => -length / 2 + (index * length) / bays;
  for (let bay = 0; bay <= bays; bay++) {
    const z = along(bay),
      rearTop = roofHeight(venue, 9.8, z) - THICKNESS / 2;
    for (const u of [2.1, 9.8]) {
      const x = side * u,
        wx = frame.x + Math.cos(frame.yaw) * x + Math.sin(frame.yaw) * z,
        wz = frame.z - Math.sin(frame.yaw) * x + Math.cos(frame.yaw) * z,
        foot = frame.ground(wx, wz) - frame.y - 0.12,
        top = u < 3 ? 0.55 : rearTop;
      box(root, m.concrete, x, foot + 0.17, z, 0.85, 0.34, 0.85);
      box(root, m.steel, x, (foot + top) / 2, z, 0.2, top - foot, 0.2);
    }
    rod(
      root,
      m.steel,
      new T.Vector3(side * 0.95, -0.08, z),
      new T.Vector3(side * 9.9, 3.5, z),
      0.09,
    );
    // A rear-supported, triangulated cantilever leaves the spectator view
    // open. Diagonal lower chords visibly connect each rib to its rear mast.
    for (let rib = 0; rib < 6; rib++) {
      const a = FRONT + ((REAR - FRONT) * rib) / 6,
        b = FRONT + ((REAR - FRONT) * (rib + 1)) / 6,
        ya = roofHeight(venue, a, z) - 0.16,
        yb = roofHeight(venue, b, z) - 0.16,
        lowA = ya - (0.18 + (0.4 * rib) / 6),
        lowB = yb - (0.18 + (0.4 * (rib + 1)) / 6);
      rod(root, m.steel, new T.Vector3(side * a, ya, z), new T.Vector3(side * b, yb, z), 0.065);
      rod(root, m.steel, new T.Vector3(side * a, lowA, z), new T.Vector3(side * b, lowB, z), 0.042);
      rod(root, m.steel, new T.Vector3(side * a, lowA, z), new T.Vector3(side * b, yb, z), 0.028);
    }
    rod(
      root,
      m.steel,
      new T.Vector3(side * 9.8, 4.5, z),
      new T.Vector3(side * 6.4, roofHeight(venue, 6.4, z) - 0.62, z),
      0.075,
    );
    if (bay < bays) {
      const next = along(bay + 1);
      rod(
        root,
        m.steel,
        new T.Vector3(side * 9.8, 0.4, z),
        new T.Vector3(side * 9.8, 4.8, next),
        0.04,
      );
      rod(
        root,
        m.steel,
        new T.Vector3(side * 9.8, 4.8, z),
        new T.Vector3(side * 9.8, 0.4, next),
        0.04,
      );
    }
  }
  const canopy = mesh(root, gpGrandstandRoofGeometry(venue, length, side), m.roof);
  canopy.name = `Closed ${style.profile} canopy`;
  // The complete roof stays above the spectator volume. The conservative
  // broadcast bound contains only the canopy, not the open trusses and seats.
  sightlines?.add(canopy);
  for (const u of [FRONT + 0.05, REAR - 0.05])
    for (let z = -length / 2 - 0.65; z < length / 2 + 0.65; z += 2) {
      const next = Math.min(z + 2, length / 2 + 0.65);
      rod(
        root,
        m.steel,
        new T.Vector3(side * u, roofHeight(venue, u, z) - 0.03, z),
        new T.Vector3(side * u, roofHeight(venue, u, next) - 0.03, next),
        0.075,
      );
    }
  // Front and rear public circulation rails follow the retained terrace.
  for (let z = -length / 2; z <= length / 2; z += 4) {
    box(root, m.steel, side * -0.8, 0.54, z, 0.045, 1.1, 0.045);
    box(root, m.steel, side * 10, 4.2, z, 0.045, 1.3, 0.045);
  }
  for (const [u, y] of [
    [-0.8, 1.05],
    [10, 4.82],
    [10, 4.27],
  ])
    box(root, m.steel, side * u, y, 0, 0.04, 0.04, length);
  // A dark inset behind the fascia gives the print a physical frame; it
  // hangs below the lowest front eave, safely above the spectator heads.
  box(root, m.underside, side * -1.77, 5.65, 0, 0.08, 0.62, length * 0.72 + 0.18);
  mergeStatic(root);
  const sign = mesh(root, new T.PlaneGeometry(length * 0.72, 0.5), m.sign, side * -1.82, 5.65, 0);
  sign.name = `${style.label} grandstand fascia`;
  sign.rotation.y = (-side * Math.PI) / 2;
  sign.castShadow = false;
  return root;
}
