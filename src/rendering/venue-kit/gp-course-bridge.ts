import * as T from 'three';
import { clamp, mod } from '../../core/math.ts';
import { gpCornerShapes, isGpCourse } from '../../simulation/gp-corner-shape.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { canvasTexture, mergeStatic } from '../geometry.ts';
import { inStandFootprint } from '../grandstand.ts';
import { terrainFor } from '../terrain.ts';
import { installCircuitFinish } from '../circuit-finish.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';
import type { VenueKitContext } from './context.ts';

const COURSES: Record<string, { corner: string; accent: number; crown: number }> = {
  'poggio-alto': { corner: 'PRIMA', accent: 0x9d4438, crown: 0.75 },
  'cape-wrenna': { corner: 'COLD SPOT', accent: 0x3c7395, crown: 0.4 },
  haarveld: { corner: 'TURFSTEEK', accent: 0x345aa0, crown: 0.95 },
  montejaral: { corner: 'HORQUILLA', accent: 0xa76c36, crown: 0.55 },
  steinhorn: { corner: 'SCHLUCHT', accent: 0x2d7f8f, crown: 0.7 },
  'zafra-night': { corner: 'MUNHANA', accent: 0xa98a42, crown: 0.45 },
};

export interface GpCourseBridgeSite {
  s: number;
  corner: number;
  approachDistance: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  left: number;
  right: number;
  /** World height of the lowest overhead member. */
  underside: number;
  /** World ground heights at the two foundations. */
  ground: readonly [number, number];
}

/** Same blend as the venue's 26 m terrain skirt. Using raw terrain height
 * alone buried the base in the raised verge beside the collision boundary. */
function skirtHeight(track: Track, s: number, lateral: number, forward = 0) {
  const p = track.at(s, trackPoint()),
    x = p.x + p.nx * lateral + p.tx * forward,
    z = p.z + p.nz * lateral + p.tz * forward,
    side = lateral < 0 ? -1 : 1,
    edge = Math.max(p.width + 4, track.boundaryAt(p, side) + 1),
    t = clamp((Math.abs(lateral) - edge) / 26, 0, 1),
    blend = t * t * (3 - 2 * t),
    road = p.y + p.bank * clamp(lateral, -12, 12);
  return road - 0.05 + (terrainFor(track).height(x, z) - 0.08 - road + 0.05) * blend;
}

/** A permanent architectural landmark before one substantial straight's
 * braking approach. REF034/062/063/077 constrain layered overhead structure,
 * truss depth and long forward sightlines; dimensions and placement are
 * original design choices. It is not a timing line or an ideal brake point.
 * No collision, route geometry, grip, weather shelter or race state changes. */
export function gpCourseBridgeSite(kit: VenueKitContext): GpCourseBridgeSite | null {
  const track = kit.track;
  if (!isGpCourse(track)) return null;
  const profile = COURSES[track.circuit.id],
    shapes = gpCornerShapes(track),
    p = trackPoint(),
    sample = trackPoint(),
    order = track.circuit.corners.map((_, index) => index);
  order.sort((a, b) =>
    Number(track.circuit.corners[b].name === profile.corner) -
    Number(track.circuit.corners[a].name === profile.corner),
  );
  for (const corner of order) {
    if (shapes[corner].direction === 'straight') continue;
    const entry = track.circuit.corners[corner].s - shapes[corner].entry;
    for (const distance of [280, 300, 260, 320, 240, 340, 360, 380, 400]) {
      const s = mod(entry - distance, track.length);
      let clear = true;
      for (const offset of [-40, -20, 0, 20, 40]) {
        const station = mod(s + offset, track.length);
        track.at(station, sample);
        if (
          Math.abs(sample.curvature) > 1 / 700 ||
          Math.abs(sample.gradient) > 0.12 ||
          track.isCovered(station) ||
          station < track.pit.mergeEnd + 25 ||
          station > track.length - track.pit.divergeStart - 25
        )
          clear = false;
      }
      if (!clear) continue;
      track.at(s, p);
      const left = track.boundaryAt(p, -1) + 4.8,
        right = track.boundaryAt(p, 1) + 4.8;
      // A compact, plausible span, with no support in another section, a
      // grandstand, paddock or previously registered piece of course furniture.
      if (left + right > 72) continue;
      for (const lateral of [-left, right])
        for (const across of [-1.4, 0, 1.4])
          for (const forward of [-2.7, 0, 2.7]) {
            const x = p.x + p.nx * (lateral + across) + p.tx * forward,
              z = p.z + p.nz * (lateral + across) + p.tz * forward;
            if (
              kit.overOtherSection(x, z, s, 4) ||
              inStandFootprint(track, x, z, 2) ||
              kit.blocks(x, z, 2)
            )
              clear = false;
          }
      // The entire overhead span also avoids a separate road corridor.
      for (let lateral = -left; lateral <= right; lateral += 4) {
        const x = p.x + p.nx * lateral,
          z = p.z + p.nz * lateral;
        if (kit.overOtherSection(x, z, s, 2)) clear = false;
      }
      if (!clear) continue;
      let roadTop = -Infinity;
      for (const forward of [-4, 0, 4]) {
        track.at(s + forward, sample);
        roadTop = Math.max(roadTop, sample.y + Math.abs(sample.bank) * sample.width);
      }
      const ground = [-left, right].map((lateral) =>
        Math.max(...[-2.4, 0, 2.4].map((forward) => skirtHeight(track, s, lateral, forward))),
      ) as [number, number];
      return {
        s,
        corner,
        approachDistance: distance,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: Math.atan2(p.tx, p.tz),
        left,
        right,
        underside: roadTop + 6.7,
        ground,
      };
    }
  }
  return null;
}

function box(
  root: T.Group,
  material: T.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

function tube(root: T.Group, material: T.Material, a: T.Vector3, b: T.Vector3, radius: number) {
  const delta = b.clone().sub(a),
    mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, delta.length(), 8), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
}

export function buildGpCourseBridge(kit: VenueKitContext) {
  const site = gpCourseBridgeSite(kit);
  if (!site) return null;
  const track = kit.track,
    profile = COURSES[track.circuit.id],
    root = new T.Group(),
    m = kit.materials,
    width = site.left + site.right,
    mid = (site.right - site.left) / 2,
    deck = site.underside - site.y + 0.26,
    roof = deck + 2.25;
  root.name = 'GP course bridge · ' + track.circuit.short;
  root.userData.gpCourseBridge = site;
  root.position.set(site.x, site.y, site.z);
  root.rotation.y = site.yaw;

  const finish = new T.MeshStandardMaterial({
    color: profile.accent,
    roughness: 0.63,
    metalness: 0.12,
  });
  finish.name = 'GP course bridge formed cladding';
  installCircuitFinish(finish, 'paint');
  tagWeatherSurface(finish, 'paint');
  const map = canvasTexture(1024, 128, (c) => {
    c.fillStyle = '#deded4';
    c.fillRect(0, 0, 1024, 128);
    c.fillStyle = '#' + profile.accent.toString(16).padStart(6, '0');
    c.fillRect(0, 0, 22, 128);
    c.fillRect(1002, 0, 22, 128);
    c.textBaseline = 'middle';
    c.textAlign = 'center';
    c.fillStyle = '#263037';
    c.font = '800 65px Arial';
    c.fillText(track.circuit.short, 512, 48, 920);
    c.font = '600 21px Arial';
    c.fillText(track.circuit.corners[site.corner].name + ' APPROACH', 512, 103, 900);
  });
  map.name = 'GP course bridge venue identity';
  const print = new T.MeshStandardMaterial({
    map,
    roughness: 0.75,
    metalness: 0.02,
  });
  print.name = 'GP course bridge printed fascia';
  installCircuitFinish(print, 'paint');
  tagWeatherSurface(print, 'paint');

  for (const [index, x] of [-site.left, site.right].entries()) {
    const ground = site.ground[index] - site.y,
      footingTop = ground + 0.32;
    box(root, m.concrete, 2.7, 0.9, 5.2, x, ground - 0.13, 0);
    for (const z of [-1.6, 1.6]) {
      box(root, m.darkSteel, 0.85, 0.12, 0.85, x, footingTop + 0.06, z);
      tube(root, m.steel, new T.Vector3(x, footingTop + 0.12, z), new T.Vector3(x, roof, z), 0.2);
      for (const dx of [-0.31, 0.31])
        for (const dz of [-0.31, 0.31])
          box(root, m.steel, 0.08, 0.12, 0.08, x + dx, footingTop + 0.18, z + dz);
    }
    tube(root, m.darkSteel, new T.Vector3(x, footingTop + 0.3, -1.6), new T.Vector3(x, deck, 1.6), 0.075);
    tube(root, m.darkSteel, new T.Vector3(x, footingTop + 0.3, 1.6), new T.Vector3(x, deck, -1.6), 0.075);
    // Maintenance ladder is outside the boundary, never over the riding lane.
    const ladderX = x + Math.sign(x) * 0.48;
    for (const z of [-0.36, 0.36])
      tube(root, m.steel, new T.Vector3(ladderX, footingTop, z), new T.Vector3(ladderX, deck + 0.9, z), 0.035);
    for (let y = footingTop + 0.3; y < deck + 0.8; y += 0.3)
      tube(root, m.steel, new T.Vector3(ladderX, y, -0.36), new T.Vector3(ladderX, y, 0.36), 0.025);
    const p = track.at(site.s, trackPoint());
    kit.occupy(p.x + p.nx * x, p.z + p.nz * x, 3.4);
  }

  // Two continuous box chords, triangulated webs and transverse floor beams:
  // an open structural interior, with a dark underside and visible depth.
  const bays = Math.ceil(width / 4);
  for (const z of [-1.6, 1.6]) {
    box(root, m.darkSteel, width + 0.7, 0.52, 0.36, mid, deck, z);
    tube(root, m.steel, new T.Vector3(-site.left, roof - 0.16, z), new T.Vector3(site.right, roof - 0.16, z), 0.1);
    for (let i = 0; i < bays; i++) {
      const a = -site.left + (width * i) / bays,
        b = -site.left + (width * (i + 1)) / bays;
      tube(root, m.steel, new T.Vector3(a, deck + 0.24, z), new T.Vector3(b, roof - 0.16, z), 0.075);
      tube(root, m.steel, new T.Vector3(b, deck + 0.24, z), new T.Vector3(b, roof - 0.16, z), 0.065);
    }
  }
  for (let i = 0; i <= bays; i++) {
    const x = -site.left + (width * i) / bays;
    box(root, m.darkSteel, 0.18, 0.32, 3.55, x, deck + 0.02, 0);
    const u = ((x - mid) * 2) / (width + 1.6),
      supportY = roof - 0.05 + profile.crown * (1 - u * u);
    for (const z of [-1.6, 1.6])
      tube(root, m.steel, new T.Vector3(x, roof - 0.16, z), new T.Vector3(x, supportY, z), 0.055);
    tube(root, m.steel, new T.Vector3(x, supportY, -2), new T.Vector3(x, supportY, 2), 0.055);
  }
  box(root, m.darkSteel, width + 0.3, 0.12, 3.1, mid, deck + 0.32, 0);
  const canopy = new T.BoxGeometry(width + 1.6, 0.16, 4.3, 24, 1, 1),
    positions = canopy.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const u = (positions.getX(i) * 2) / (width + 1.6);
    positions.setY(i, positions.getY(i) + profile.crown * (1 - u * u));
  }
  canopy.computeVertexNormals();
  const roofMesh = new T.Mesh(canopy, finish);
  roofMesh.position.set(mid, roof + 0.05, 0);
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  root.add(roofMesh);

  const faceWidth = Math.min(32, width - 5);
  box(root, finish, faceWidth + 0.2, 1.55, 0.12, mid, deck + 1.08, -1.9);
  const face = new T.Mesh(new T.PlaneGeometry(faceWidth, 1.4), print);
  face.rotation.y = Math.PI;
  face.position.set(mid, deck + 1.08, -1.968);
  face.receiveShadow = true;
  root.add(face);
  mergeStatic(root);
  // One local cell, five material draws, no animated state or extra lights.
  // The ordinary weather pass sees both paint surfaces and keeps wetness last.
  kit.detail(root, 1100);
  return root;
}
