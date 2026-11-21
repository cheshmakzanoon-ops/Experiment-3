import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { drawnTerrain, terrainFor } from '../terrain.ts';
import { TERRAIN_SIZE } from '../terrain-surface.ts';
import { inStandFootprint } from '../grandstand.ts';
import { districtPlan, inDistrictFootprint } from '../venue-districts.ts';
import { serviceSitePlan, inServiceFootprint } from '../venue-service-plan.ts';
import { inLandmarkFootprint, landmarkSitePlan } from '../venue-landmark.ts';

interface FarmStyle {
  wall: number;
  wing: number;
  trim: number;
  roof: number;
  tiles: number;
  gable: number;
  pitch: number;
  hip: number;
  shedLength: number;
  shutter: number;
}
const styles: Record<string, FarmStyle> = {
  'poggio-alto': {
    wall: 0xc89b69,
    wing: 0xad8967,
    trim: 0xd7be96,
    roof: 0x925543,
    tiles: 0xaa6b50,
    gable: 0xbd966e,
    pitch: 0.49,
    hip: 0.42,
    shedLength: 13,
    shutter: 0x455648,
  },
  'cape-wrenna': {
    wall: 0x958b78,
    wing: 0x867e75,
    trim: 0xbbafa0,
    roof: 0x494f56,
    tiles: 0x626870,
    gable: 0xa59d8a,
    pitch: 0.81,
    hip: 0,
    shedLength: 17,
    shutter: 0x4c6367,
  },
  haarveld: {
    wall: 0x9b6550,
    wing: 0x825c4e,
    trim: 0xc8b79b,
    roof: 0x585455,
    tiles: 0x79706a,
    gable: 0x875c49,
    pitch: 0.83,
    hip: 0.3,
    shedLength: 24,
    shutter: 0x39554c,
  },
  montejaral: {
    wall: 0xd4ccb5,
    wing: 0xc6b599,
    trim: 0xb29c82,
    roof: 0x976d51,
    tiles: 0xb48760,
    gable: 0xc8bfa7,
    pitch: 0.31,
    hip: 0.25,
    shedLength: 19,
    shutter: 0x524e41,
  },
};
export interface GpFarmstead {
  x: number;
  y: number;
  z: number;
  yaw: number;
  station: number;
}
const cache = new WeakMap<Track, GpFarmstead[]>();
export function inGpFarmstead(sites: readonly GpFarmstead[], x: number, z: number, pad = 0) {
  return sites.some((site) => {
    const dx = x - site.x,
      dz = z - site.z,
      c = Math.cos(site.yaw),
      s = Math.sin(site.yaw);
    return Math.abs(c * dx - s * dz) < 24 + pad && Math.abs(s * dx + c * dz) < 20 + pad;
  });
}

/** Pick a small working farm on buildable ground in four actual approach
 * views. Look across the road ahead, preserving the inside of hairpins,
 * race facilities, the coast and the existing surveyed regional landmark. */
export function gpFarmsteadPlan(track: Track): readonly GpFarmstead[] {
  const existing = cache.get(track);
  if (existing) return existing;
  const sites: GpFarmstead[] = [];
  cache.set(track, sites);
  const style = styles[track.circuit.id];
  if (!style) return sites;
  const ground = drawnTerrain(track),
    sea = terrainFor(track).seaLevel;
  const p = trackPoint(),
    near = trackPoint();
  const services = serviceSitePlan(track),
    districts = districtPlan(track, services);
  const landmark = landmarkSitePlan(track, services, districts);
  for (const fraction of [0.12, 0.36, 0.61, 0.84]) {
    let best = -Infinity,
      selected: GpFarmstead | undefined;
    for (const delta of [-0.035, 0, 0.035]) {
      const station = (fraction + delta) * track.length;
      track.at(station, p);
      for (const fore of [175, 245, 335, 430])
        for (const lateral of [-0.54, 0.54, -0.32, 0.32]) {
          const x = p.x + fore * (p.tx + lateral * p.nx),
            z = p.z + fore * (p.tz + lateral * p.nz);
          if (Math.max(Math.abs(x), Math.abs(z)) > TERRAIN_SIZE * 0.46) continue;
          track.nearest(x, z, near);
          const distance = Math.hypot(x - near.x, z - near.z);
          if (
            distance < 100 ||
            distance > 310 ||
            inGpFarmstead(sites, x, z, 180) ||
            inStandFootprint(track, x, z, 29) ||
            inServiceFootprint(services, x, z, 29) ||
            inDistrictFootprint(districts, x, z, 29) ||
            inLandmarkFootprint(landmark, x, z, 29)
          )
            continue;
          const y = ground.height(x, z);
          if (sea !== null && y < sea + 5) continue;
          const dx = (ground.height(x + 13, z) - ground.height(x - 13, z)) / 26;
          const dz = (ground.height(x, z + 13) - ground.height(x, z - 13)) / 26;
          const slope = Math.hypot(dx, dz);
          if (slope > 0.115) continue;
          let clearance = Infinity;
          for (const t of [0.25, 0.5, 0.75, 0.9]) {
            const sight = (p.y + 1.55) * (1 - t) + (y + 4.2) * t;
            clearance = Math.min(
              clearance,
              sight - ground.height(p.x + (x - p.x) * t, p.z + (z - p.z) * t),
            );
          }
          if (clearance < 0.5) continue;
          const score = Math.min(clearance, 6) * 0.12 - slope * 5 - Math.abs(fore - 244) / 540;
          if (score <= best) continue;
          best = score;
          // Long ridges follow the contour and open to the racing approach.
          const yaw = slope > 0.024 ? Math.atan2(dx, dz) : Math.atan2(-p.tz, p.tx) + 0.22;
          selected = { x, y, z, yaw, station };
        }
    }
    if (selected) sites.push(selected);
  }
  return sites;
}

type Point = [number, number, number];
function roofShape(w: number, d: number, h: number, hip: number, gable: boolean) {
  const p: number[] = [],
    index: number[] = [];
  const tri = (a: Point, b: Point, c: Point) => {
    const start = p.length / 3;
    p.push(...a, ...b, ...c);
    index.push(start, start + 1, start + 2);
  };
  const a: Point = [-w / 2, 0, -d / 2],
    b: Point = [w / 2, 0, -d / 2];
  const c: Point = [w / 2, 0, d / 2],
    e: Point = [-w / 2, 0, d / 2];
  const l: Point = [-w / 2 + d * hip, h, 0],
    r: Point = [w / 2 - d * hip, h, 0];
  if (gable) {
    tri(a, e, l);
    tri(c, b, r);
  } else {
    tri(a, l, r);
    tri(a, r, b);
    tri(e, c, r);
    tri(e, r, l);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Closed silhouettes, grounded plinths, shaded openings, tile caps and
 * eaves. Each farm uses one opaque vertex-colour draw and owns no image
 * downloads, lights, shadow passes or animation state. */
export function buildGpFarmsteads(track: Track, parent: T.Group) {
  const style = styles[track.circuit.id],
    sites = gpFarmsteadPlan(track);
  if (!style || !sites.length) return;
  const ground = drawnTerrain(track),
    material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 });
  material.name = 'GP rural masonry and roof finishes';
  for (const [i, site] of sites.entries()) {
    const pieces: T.BufferGeometry[] = [];
    const c = Math.cos(site.yaw),
      s = Math.sin(site.yaw);
    const height = (x: number, z: number) =>
      ground.height(site.x + c * x + s * z, site.z - s * x + c * z) - site.y;
    const add = (g: T.BufferGeometry, x: number, y: number, z: number, colour: number) => {
      g.deleteAttribute('uv');
      g.translate(x, y, z);
      const tint = new T.Color(colour),
        colours = new Float32Array(g.getAttribute('position').count * 3);
      for (let at = 0; at < colours.length; at += 3) tint.toArray(colours, at);
      g.setAttribute('color', new T.BufferAttribute(colours, 3));
      pieces.push(g);
    };
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      colour: number,
    ) => add(new T.BoxGeometry(w, h, d), x, y, z, colour);
    const building = (
      x: number,
      z: number,
      w: number,
      d: number,
      wallHeight: number,
      barn: boolean,
    ) => {
      const levels = [
        height(x - w / 2, z - d / 2),
        height(x + w / 2, z - d / 2),
        height(x - w / 2, z + d / 2),
        height(x + w / 2, z + d / 2),
      ];
      const floor = Math.max(...levels) + 0.08,
        bottom = Math.min(...levels) - 0.3;
      box(x, (floor + bottom) / 2, z, w + 0.14, floor - bottom, d + 0.14, 0x80796b);
      const eave = floor + wallHeight,
        pitch = style.pitch * (barn ? 0.85 : 1),
        rise = d * pitch * 0.5;
      box(x, floor + wallHeight / 2, z, w, wallHeight, d, barn ? style.wing : style.wall);
      box(x, eave + 0.02, z, w + 0.5, 0.22, d + 0.55, style.trim);
      add(roofShape(w + 0.58, d + 0.62, rise, style.hip, false), x, eave + 0.13, z, style.roof);
      add(
        roofShape(w + 0.58, d + 0.62, rise, style.hip, true),
        x,
        eave + 0.13,
        z,
        style.hip ? style.tiles : style.gable,
      );
      box(x, eave + rise + 0.13, z, w + 0.59 - 2 * (d + 0.62) * style.hip, 0.14, 0.25, style.tiles);
      for (const side of [-1, 1]) {
        const face = z + side * (d * 0.5 + 0.025);
        if (barn) {
          box(x - 0.11 * w, floor + 1.55, face, w * 0.34, 3.1, 0.08, style.shutter);
          box(x - 0.11 * w, floor + 3.15, face, w * 0.37, 0.18, 0.18, style.trim);
          box(x + 0.3 * w, floor + 2.55, face, 1.3, 0.82, 0.08, 0x42494a);
        } else {
          for (const part of [-0.34, -0.12, 0.12, 0.34]) {
            const wx = x + w * part;
            box(wx, floor + wallHeight * 0.67, face, 1.26, 1.38, 0.1, style.trim);
            box(wx, floor + wallHeight * 0.67, face + side * 0.07, 0.94, 1.14, 0.1, 0x41484a);
            for (const sign of [-1, 1])
              box(
                wx + sign * 0.72,
                floor + wallHeight * 0.67,
                face + side * 0.03,
                0.32,
                1.33,
                0.1,
                style.shutter,
              );
          }
          box(x - 0.12 * w, floor + 1.14, face + side * 0.04, 1.02, 2.28, 0.13, style.shutter);
        }
      }
      if (!barn) {
        box(x + w * 0.27, eave + rise * 0.7, z - 0.13 * d, 0.72, rise + 1.3, 0.78, style.wall);
        box(x + w * 0.27, eave + rise * 1.2 + 0.65, z - 0.13 * d, 0.96, 0.23, 1.02, style.trim);
      }
    };
    const course = track.circuit.id;
    const houseLength = course === 'haarveld' ? 19 : course === 'cape-wrenna' ? 12.6 : 14;
    const houseHeight = course === 'montejaral' ? 3.85 : course === 'cape-wrenna' ? 4.35 : 5.25;
    building(-3, -5, houseLength + (i % 2) * 1.5, 8.2, houseHeight, false);
    building(3, 8.8, style.shedLength, 7.8, 3.85, true);
    if (course === 'haarveld') {
      // A short slatted cap brings air into the high polder barn.
      const h = height(3, 8.8) + 3.85 + 3.9 * style.pitch * 0.85 + 0.28;
      box(3, h + 0.35, 8.8, 6.4, 0.8, 1.45, style.shutter);
      for (const face of [-1, 1]) {
        for (let i = 0; i < 5; i++)
          box(0.6 + i * 1.2, h + 0.37, 8.8 + face * 0.74, 0.17, 0.76, 0.08, style.trim);
      }
      add(roofShape(6.9, 2, 0.61, 0, false), 3, h + 0.77, 8.8, style.tiles);
      add(roofShape(6.9, 2, 0.61, 0, true), 3, h + 0.77, 8.8, style.gable);
    } else if (course === 'montejaral') {
      // A shaded lean-to closes the east side of the working courtyard.
      const h = height(12.8, -4);
      for (const x of [10.2, 15.6])
        for (const z of [-7.6, -4.15, -0.7]) box(x, h + 1.43, z, 0.38, 2.86, 0.38, style.trim);
      const cover = new T.BoxGeometry(6.35, 0.22, 8.15);
      cover.rotateZ(-0.115);
      add(cover, 12.9, h + 2.95, -4.15, style.tiles);
    } else if (course === 'cape-wrenna') {
      // Tall stone stacks break the windward cottage's steep slate ridge.
      const h = height(-8.8, -5) + houseHeight;
      box(-8.8, h + 2.25, -5, 1.23, 4.8, 0.94, style.gable);
      box(-8.8, h + 4.62, -5, 1.52, 0.34, 1.16, style.trim);
      for (const dx of [-0.35, 0.35]) box(-8.8 + dx, h + 5, -5, 0.27, 0.58, 0.29, style.roof);
    } else if (i % 2 === 0) {
      // The rendered hill farm has an open loggia beside the plaster wall.
      const h = height(-1, -11.3);
      for (const x of [-7, -4, -1, 2]) box(x, h + 1.5, -12.45, 0.35, 3, 0.35, style.gable);
      box(-2.5, h + 2.98, -11.75, 9.75, 0.31, 2.15, style.tiles);
    }
    // Low masonry boundary with an open cart entrance. It breaks up the
    // rectangle of the farm against arable land at racing-camera distance.
    for (const [x, w] of [
      [-11, 10],
      [9, 13],
    ]) {
      const h = height(x, -13);
      box(x, h + 0.38, -13, w, 0.88, 0.42, style.trim);
    }
    const geo = mergeGeometries(pieces, false)!;
    pieces.forEach((g) => g.dispose());
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new T.Mesh(geo, material);
    mesh.name = 'GP ' + track.circuit.id + ' farmstead ' + (i + 1);
    mesh.position.set(site.x, site.y, site.z);
    mesh.rotation.y = site.yaw;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}
