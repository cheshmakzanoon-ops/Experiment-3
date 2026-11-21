import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mod } from '../../core/math.ts';
import { Track, trackPoint } from '../../simulation/track.ts';
import { TrackTerrainSurface } from '../../simulation/offroad/course-terrain.ts';
import { inStandFootprint } from '../grandstand.ts';
import { tracksideRigs } from '../trackside.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import { mxFootprintMatrix } from './mx-ground-pose.ts';
import type { MxSpectatorPlacement } from './mx-spectators.ts';

const LENGTH = 2.16,
  DEPTH = 0.47,
  HEIGHT = 1.08;
const FRAME = 0xb1b7b5,
  WIRE = 0x929b99,
  FOOT = 0x697270;
type Point = [number, number, number];

/** A hot-dip galvanised event barrier. The continuous hoop turns around
 * the upper corners; vertical pickets weld into the lower transom. Each
 * splayed foot touches the ground at both ends rather than balancing on
 * a post submerged in the ground. Dimensions are in metres. */
export function mxViewingRailGeometry() {
  const parts: T.BufferGeometry[] = [];
  const colour = new T.Color(),
    up = new T.Vector3(0, 1, 0);
  const add = (g: T.BufferGeometry, finish: number) => {
    const n = g.getAttribute('position').count;
    colour.setHex(finish);
    const c = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = Math.round(colour.r * 255);
      c[i * 3 + 1] = Math.round(colour.g * 255);
      c[i * 3 + 2] = Math.round(colour.b * 255);
    }
    g.setAttribute('color', new T.BufferAttribute(c, 3, true));
    parts.push(g);
  };
  const tube = (a: Point, b: Point, radius: number, finish: number, sides = 8) => {
    const from = new T.Vector3(...a),
      to = new T.Vector3(...b),
      direction = to.clone().sub(from);
    const g = new T.CylinderGeometry(radius, radius, direction.length(), sides, 1, true);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(up, direction.normalize()));
    const mid = from.add(to).multiplyScalar(0.5);
    add(g.translate(mid.x, mid.y, mid.z), finish);
  };
  const x = LENGTH / 2,
    bend = 0.115,
    radius = 0.018;
  tube([-x + bend, HEIGHT, 0], [x - bend, HEIGHT, 0], radius, FRAME);
  tube([-x, 0.23, 0], [x, 0.23, 0], 0.015, WIRE);
  for (const side of [-1, 1]) {
    const end = side * x;
    tube([end, 0.1, 0], [end, HEIGHT - bend, 0], radius, FRAME);
    const quarter = new T.TorusGeometry(bend, radius, 8, 5, Math.PI / 2);
    if (side < 0) quarter.rotateZ(Math.PI / 2);
    add(quarter.translate(side * (x - bend), HEIGHT - bend, 0), FRAME);
    // Removable foot sleeves and non-slip shoes stay visibly separate.
    tube([end, 0.071, 0], [end, 0.16, 0], 0.024, FOOT);
    for (const z of [-DEPTH / 2, DEPTH / 2]) {
      tube([end, 0.097, 0], [end - side * 0.075, 0.026, z], 0.018, FOOT, 6);
      add(new T.BoxGeometry(0.082, 0.022, 0.09).translate(end - side * 0.075, 0.011, z), 0x404746);
    }
    // Reflective warning tape wraps the upper corners at the post join.
    tube([end, 0.81, 0], [end, 0.86, 0], 0.019, 0xc78c42);
  }
  for (let i = 1; i <= 9; i++) {
    const along = -x + (i * LENGTH) / 10;
    tube([along, 0.232, 0], [along, HEIGHT - 0.008, 0], 0.0095, WIRE, 5);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Put temporary rails in front of occupied public viewing areas. Check
 * every part of a module against the nearest real lane, people, camera
 * mounts, stands and service zones. The track and its runoff stay playable. */
export function mxViewingRails(
  track: Track,
  people: readonly MxSpectatorPlacement[],
  reserved: readonly { x: number; z: number; radius: number }[],
) {
  const root = new T.Group();
  root.name = 'Valley Ridge spectator rails';
  const surface = Track.offroadOf(track);
  if (!(surface instanceof TrackTerrainSurface) || surface.kind !== 'motocross') return root;
  const bins = Math.max(1, Math.floor(track.length / 2.44));
  const cells = new Map<number, number>();
  for (const person of people) {
    if (person.kind !== 'spectator') continue;
    const key =
      Math.min(bins - 1, Math.floor((mod(person.station, track.length) / track.length) * bins)) +
      (person.side > 0 ? bins : 0);
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const cameras = tracksideRigs(track);
  const point = trackPoint(),
    nearest = trackPoint(),
    centres: T.Vector3[] = [],
    poses: T.Matrix4[] = [];
  for (const [key, count] of [...cells].sort((a, b) => a[0] - b[0])) {
    if (count < 2) continue;
    const s = (((key % bins) + 0.5) * track.length) / bins,
      side = key < bins ? -1 : 1;
    track.at(s, point);
    const setback = surface.course.legalWidth(point.width, s, side) + 3.65;
    const x = point.x + side * setback * point.nx,
      z = point.z + side * setback * point.nz;
    if (
      inStandFootprint(track, x, z, 1.6) ||
      reserved.some((q) => Math.hypot(q.x - x, q.z - z) < q.radius + 1.6) ||
      cameras.some((q) => Math.hypot(q.position.x - x, q.position.z - z) < 3.1) ||
      centres.some((q) => Math.hypot(q.x - x, q.z - z) < LENGTH + 0.05)
    )
      continue;
    const obstructs = people.some((p) => {
      const dx = p.x - x,
        dz = p.z - z;
      const along = dx * point.tx + dz * point.tz;
      const behind = side * (dx * point.nx + dz * point.nz);
      return Math.abs(along) < LENGTH / 2 + 0.44 && behind > -2 && behind < 0.59;
    });
    if (obstructs) continue;
    // The rail and the tips of its feet must clear both ends of a bend
    // and any neighbouring leg of a hairpin, including the pit corridor.
    let clear = true;
    for (const along of [-1.13, 0, 1.13]) {
      const xx = x + along * point.tx - side * 0.29 * point.nx;
      const zz = z + along * point.tz - side * 0.29 * point.nz;
      const lateral = track.nearest(xx, zz, nearest);
      if (
        Math.abs(mod(nearest.s - s + track.length / 2, track.length) - track.length / 2) > 5 ||
        Math.abs(lateral) < surface.course.legalWidth(nearest.width, nearest.s, lateral) + 3.0 ||
        (track.isPitSection(nearest.s) && lateral * track.pit.side > 0)
      )
        clear = false;
    }
    if (!clear) continue;
    const yaw = Math.atan2(-point.tz, point.tx);
    const pose = mxFootprintMatrix(track, x, z, yaw, LENGTH - 0.15, DEPTH, -0.003);
    if (pose.elements[5] < 0.97) continue;
    poses.push(pose);
    centres.push(new T.Vector3().setFromMatrixPosition(pose));
  }
  if (!poses.length) return root;
  const material = new T.MeshStandardMaterial({
    name: 'Galvanised race spectator rails',
    vertexColors: true,
    metalness: 0.65,
    roughness: 0.48,
  });
  tagWeatherSurface(material, 'metal', 0.78);
  const rails = new T.InstancedMesh(mxViewingRailGeometry(), material, poses.length);
  poses.forEach((pose, i) => rails.setMatrixAt(i, pose));
  rails.name = 'Galvanised viewing barriers';
  rails.castShadow = rails.receiveShadow = true;
  rails.computeBoundingSphere();
  root.add(rails);
  return root;
}
