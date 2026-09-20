import { CrowdCluster } from './crowd.ts';
import { grassApronOffset } from './ground-profile.ts';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Track, trackPoint } from '../simulation/track.ts';
import { clamp, Random } from '../core/math.ts';
import { box, mesh, rod, label } from './geometry.ts';

/** Original site plan: front edges stay behind the physical barrier. Shared by
 * structure construction and vegetation exclusion, not separate random layouts. */
export const GRANDSTANDS = Object.freeze([
  { s: -72, side: -1, length: 64 },
  { s: 55, side: -1, length: 80 },
  { s: 450, side: -1, length: 48 },
  { s: 780, side: 1, length: 48 },
  { s: 1220, side: -1, length: 48 },
  { s: 1670, side: 1, length: 48 },
  { s: 2210, side: -1, length: 48 },
  { s: 2600, side: 1, length: 48 },
]);
export type StandSite = (typeof GRANDSTANDS)[number];
export function standFrame(track: Track, site: StandSite) {
  const p = track.at(site.s, trackPoint()),
    lateral = site.side * (track.boundary(site.s, site.side) + 7);
  const x = p.x + p.nx * lateral,
    z = p.z + p.nz * lateral;
  const ground = (wx: number, wz: number) => {
    const near = trackPoint(),
      l = track.nearest(wx, wz, near);
    return near.y + near.bank * clamp(l, -12, 12) + grassApronOffset(track, near.s, l);
  };
  // A level deck above the highest corner. Footings reach the actual sloping
  // grass apron; buildings are not tilted to follow an arbitrary road camber.
  let base = -Infinity;
  for (const u of [-2, 11])
    for (const v of [-site.length / 2, site.length / 2])
      base = Math.max(
        base,
        ground(x + p.nx * site.side * u + p.tx * v, z + p.nz * site.side * u + p.tz * v),
      );
  return { x, z, y: base + 0.35, yaw: Math.atan2(p.tx, p.tz), ground };
}
export function inStandFootprint(track: Track, x: number, z: number, padding = 3) {
  for (const site of GRANDSTANDS) {
    const p = track.at(site.s, trackPoint()),
      l = site.side * (track.boundary(site.s, site.side) + 7);
    const dx = x - p.x - p.nx * l,
      dz = z - p.z - p.nz * l;
    const u = (dx * p.nx + dz * p.nz) * site.side,
      v = dx * p.tx + dz * p.tz;
    if (u > -2 - padding && u < 11 + padding && Math.abs(v) < site.length / 2 + padding)
      return true;
  }
  return false;
}
export function standMaterials() {
  return {
    concrete: new T.MeshStandardMaterial({ color: 0x878880, roughness: 0.93 }),
    steel: new T.MeshStandardMaterial({ color: 0x454e51, metalness: 0.72, roughness: 0.45 }),
    roof: new T.MeshStandardMaterial({ color: 0xc6c9c7, metalness: 0.42, roughness: 0.58 }),
    underside: new T.MeshStandardMaterial({ color: 0x606963, roughness: 0.9 }),
    seats: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58 }),
    people: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    sign: new T.MeshStandardMaterial({
      map: label('A U R E L    /    GRAND CIRCUIT', '#273536', '#e5e2d7', 1024, 128),
      roughness: 0.7,
      side: T.DoubleSide,
    }),
  };
}
export function buildGrandstand(
  track: Track,
  props: T.Group,
  crowd: T.Group,
  site: StandSite,
  m: ReturnType<typeof standMaterials>,
  clusters?: CrowdCluster[],
) {
  const frame = standFrame(track, site),
    root = new T.Group();
  root.name = `Aurel grandstand ${site.s}m`;
  root.position.set(frame.x, frame.y, frame.z);
  root.rotation.y = frame.yaw;
  props.add(root);
  const side = site.side,
    L = site.length;
  // Terraced concrete decks with open sightlines and a continuous front walkway.
  box(root, m.concrete, side * 0.3, -0.12, 0, 2.5, 0.24, L);
  for (let row = 0; row < 8; row++)
    box(root, m.concrete, side * (1.7 + row * 0.98), row * 0.49 + 0.1, 0, 1.02, 0.2, L);
  box(root, m.concrete, side * 9.5, 3.53, 0, 1.25, 0.2, L);
  const point = trackPoint();
  const supports = Math.ceil(L / 8);
  for (let j = 0; j <= supports; j++) {
    const z = -L / 2 + (j * L) / supports;
    // Two post lines carry the cantilever and connect to independent footings.
    for (const u of [2.1, 9.8]) {
      const wx = frame.x + Math.cos(frame.yaw) * side * u + Math.sin(frame.yaw) * z;
      const wz = frame.z - Math.sin(frame.yaw) * side * u + Math.cos(frame.yaw) * z;
      const foot = frame.ground(wx, wz) - frame.y - 0.12,
        top = u < 3 ? 5.95 : 7.65;
      box(root, m.concrete, side * u, foot + 0.17, z, 0.85, 0.34, 0.85);
      box(root, m.steel, side * u, (foot + top) / 2, z, 0.16, top - foot, 0.16);
    }
    const a = new T.Vector3(side * -1.6, 5.45, z),
      b = new T.Vector3(side * 10.65, 7.5, z);
    rod(root, m.steel, a, b, 0.08);
    rod(root, m.steel, new T.Vector3(side * 2.1, 4.6, z), b, 0.05);
    // Open triangular bracing under each roof rib, not a solid dark roof slab.
    for (let k = 0; k < 5; k++) {
      const u = -1.6 + k * 2.45,
        v = u + 2.45;
      rod(
        root,
        m.steel,
        new T.Vector3(side * u, 5.45 + (u + 1.6) * 0.167, z),
        new T.Vector3(side * v, 5.05 + (v + 1.6) * 0.167, z),
        0.021,
      );
    }
    if (j < supports) {
      const next = z + L / supports;
      rod(
        root,
        m.steel,
        new T.Vector3(side * 9.8, 1, z),
        new T.Vector3(side * 9.8, 6.1, next),
        0.04,
      );
      rod(
        root,
        m.steel,
        new T.Vector3(side * 9.8, 6.1, z),
        new T.Vector3(side * 9.8, 1, next),
        0.04,
      );
    }
  }
  // One thin pitched roof per stand with a separate shaded soffit.
  const roof = box(root, m.roof, side * 4.5, 6.58, 0, 12.8, 0.12, L + 1.5);
  roof.rotation.z = side * 0.166;
  const lining = new T.PlaneGeometry(12.8, L + 1.5).rotateX(Math.PI / 2).rotateZ(side * 0.166);
  mesh(root, lining, m.underside, side * 4.5, 6.5, 0).name = 'Shaded canopy lining';
  for (const u of [-1.75, 10.75])
    box(root, m.steel, side * u, 5.55 + (u + 1.75) * 0.167, 0, 0.12, 0.24, L + 1.5);
  for (let z = -L / 2; z < L / 2; z += 4) {
    box(root, m.steel, side * -0.8, 0.54, z, 0.045, 1.1, 0.045);
    box(root, m.steel, side * 10.0, 4.2, z, 0.04, 1.3, 0.04);
  }
  for (const [u, y] of [
    [-0.8, 1.05],
    [10, 4.82],
    [10, 4.27],
  ])
    box(root, m.steel, side * u, y, 0, 0.04, 0.04, L);
  // Fascia signage lives on the actual roof edge rather than a billboard above it.
  const sign = mesh(root, new T.PlaneGeometry(L * 0.72, 0.62), m.sign, side * -1.82, 5.53, 0);
  sign.rotation.y = (-side * Math.PI) / 2;
  sign.castShadow = false;
  // Two access stairs; the same aisles are kept empty in seats and spectators.
  const columns = Math.floor(L / 0.65),
    rows = 8,
    instances: T.Matrix4[] = [],
    colors: T.Color[] = [],
    spectators: T.Matrix4[] = [],
    bodyColors: T.Color[] = [];
  const dummy = new T.Object3D(),
    random = new Random(821 + Math.round(site.s));
  const seatParts = [
    new T.BoxGeometry(0.4, 0.06, 0.39).translate(0, 0, 0),
    new T.BoxGeometry(0.055, 0.4, 0.4).translate(0.185, 0.2, 0),
  ];
  const seatGeometry = mergeGeometries(seatParts, false)!;
  seatParts.forEach((g) => g.dispose());
  const seatPalette = [0xa33c35, 0x8b3431, 0xe0dcd0, 0x394e53];
  const personPalette = [0x535b5c, 0xc7b69b, 0x323f51, 0xab4030, 0x3f665a, 0x88867d];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++) {
      const z = (col - (columns - 1) / 2) * 0.65;
      const aisle = Math.abs(z - L * 0.25) < 0.7 || Math.abs(z + L * 0.25) < 0.7;
      if (aisle) {
        if (col % 2 === 0)
          box(root, m.concrete, side * (1.6 + row * 0.98), row * 0.49 - 0.03, z, 0.95, 0.1, 0.63);
        continue;
      }
      dummy.position.set(side * (1.55 + row * 0.98), row * 0.49 + 0.5, z);
      dummy.rotation.set(0, side < 0 ? Math.PI : 0, 0);
      dummy.updateMatrix();
      instances.push(dummy.matrix.clone());
      const band = Math.floor((col + row * 2) / 12) % seatPalette.length;
      colors.push(new T.Color(seatPalette[band]));
      if (random.next() < 0.73) {
        spectators.push(dummy.matrix.clone());
        bodyColors.push(
          new T.Color(personPalette[Math.floor(random.next() * personPalette.length)]),
        );
      }
    }
  const install = (
    g: T.BufferGeometry,
    material: T.Material,
    matrices: T.Matrix4[],
    color: T.Color[],
    parent: T.Group,
    name: string,
  ) => {
    const inst = new T.InstancedMesh(g, material, matrices.length);
    inst.name = name;
    matrices.forEach((matrix, i) => {
      inst.setMatrixAt(i, matrix);
      inst.setColorAt(i, color[i]);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.computeBoundingBox();
    inst.computeBoundingSphere();
    parent.add(inst);
  };
  install(seatGeometry, m.seats, instances, colors, root, `Seats ${site.s}m`);
  const peopleRoot = new T.Group();
  peopleRoot.position.copy(root.position);
  peopleRoot.rotation.copy(root.rotation);
  crowd.add(peopleRoot);
  // Retain occupancy, aisles and clothing selections. Spatial chunks avoid a
  // single giant crowd bounding box; per-chunk LOD does not rebuild spectators.
  const ordering = spectators.map((matrix, i) => ({ matrix, color: bodyColors[i] }))
    .sort((a, b) => a.matrix.elements[14] - b.matrix.elements[14]);
  ordering.forEach((entry, i) => { spectators[i] = entry.matrix; bodyColors[i] = entry.color; });
  const chunkSize = 128;
  for (let offset = 0; offset < spectators.length; offset += chunkSize) {
    const cluster = new CrowdCluster(spectators.slice(offset, offset + chunkSize),
      bodyColors.slice(offset, offset + chunkSize), 821 + Math.round(site.s) + offset, m.people);
    peopleRoot.add(cluster.root);
    clusters?.push(cluster);
  }
  // All corners are measured against the nearest corridor, not just the centre.
  let clearance = Infinity;
  for (const u of [-1.9, 11])
    for (const v of [-L / 2, L / 2]) {
      const x = frame.x + Math.cos(frame.yaw) * side * u + Math.sin(frame.yaw) * v,
        z = frame.z - Math.sin(frame.yaw) * side * u + Math.cos(frame.yaw) * v;
      const l = track.nearest(x, z, point);
      clearance = Math.min(clearance, Math.abs(l) - track.boundary(point.s, l < 0 ? -1 : 1));
    }
  root.userData.corridorClearance = clearance;
  return root;
}
