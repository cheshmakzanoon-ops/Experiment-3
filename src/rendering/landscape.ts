import { tagWeatherSurface } from './weather-presentation.ts';
import { landmarkSitePlan, inLandmarkFootprint } from './venue-landmark.ts';
import { terrainFor } from './terrain.ts';
import { AUREL_VENUE, venuePlan, type PlantingZoneSpec } from './venue-plan.ts';
import { districtPlan, inDistrictFootprint } from './venue-districts.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import * as T from 'three';
import { installCanopyNormals } from './canopy-normals.ts';
import { installFoliageShading, installFoliageWind } from './studio/foliage-shading.ts';
import { Random, clamp } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { canvasTexture } from './geometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { terrainHeight } from './terrain-profile.ts';
/** Distinct planting character along the existing original circuit. These are
 * landscaping zones, NOT additional tracks or a claim of botanical simulation. */
export const PLANTING_ZONES = AUREL_VENUE.plantingZones;
export function plantingCharacter(
  s: number,
  length: number,
  zones: readonly PlantingZoneSpec[] = PLANTING_ZONES,
) {
  if (!Number.isFinite(s + length) || length <= 0) throw new Error('Invalid planting station');
  const fraction = (((s % length) + length) % length) / length;
  return zones.find((zone) => fraction < zone.endFraction)!;
}
export function foliageTile(ratio: number) {
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error('Invalid canopy aspect');
  return ratio < 0.73 ? 1 : ratio < 0.93 ? 0 : ratio < 1.065 ? 2 : 3;
}
export interface TreePlacement {
  x: number;
  y: number;
  z: number;
  height: number;
  width: number;
  yaw: number;
}
/** Planting rules use the NEAREST segment, not just the segment that generated
 * a candidate. This also excludes an adjacent return straight and the paddock. */
export function vegetationPlan(
  track: Track,
  seed = 7109,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  extraExclusion?: (x: number, z: number, padding: number) => boolean,
): TreePlacement[] {
  const random = new Random(seed),
    result: TreePlacement[] = [],
    point = trackPoint(),
    nearest = trackPoint();
  const occupied = new Map<string, TreePlacement[]>();
  const districts = districtPlan(track, services);
  const landmark = landmarkSitePlan(track, services, districts);
  const ground = terrainFor(track),
    zones = venuePlan(track).plantingZones;
  for (let attempt = 0; attempt < 1800 && result.length < 650; attempt++) {
    track.at(random.next() * track.length, point);
    const lateral = (random.next() < 0.5 ? -1 : 1) * (43 + random.next() * 155);
    const x = point.x + point.nx * lateral,
      z = point.z + point.nz * lateral;
    const l = track.nearest(x, z, nearest),
      side = l < 0 ? -1 : 1;
    if (Math.abs(l) < track.boundary(nearest.s, side) + 14) continue;
    if (l > 0 && (nearest.s < 335 || nearest.s > track.length - 50) && l < 65) continue;
    const cx = Math.floor(x / 7),
      cz = Math.floor(z / 7);
    let blocked = false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (
          occupied
            .get(`${cx + dx}:${cz + dz}`)
            ?.some((tree) => Math.hypot(x - tree.x, z - tree.z) < 7)
        )
          blocked = true;
      }
    if (blocked) continue;
    // Use the exact same authored site footprint as the structural builder.
    if (
      inStandFootprint(track, x, z, 8) ||
      inServiceFootprint(services, x, z, 8) ||
      extraExclusion?.(x, z, 8) ||
      inDistrictFootprint(districts, x, z, 8) ||
      inLandmarkFootprint(landmark, x, z, 8)
    )
      blocked = true;
    if (blocked) continue;
    const y =
      Math.abs(l) <= nearest.width + 38
        ? nearest.y + nearest.bank * clamp(l, -12, 12) + grassApronOffset(track, nearest.s, l)
        : ground.height(x, z);
    if (ground.seaLevel !== null && ground.height(x, z) < ground.seaLevel + 0.6) continue;
    const height = 6 + random.next() * 7;
    const tree = {
      x,
      y,
      z,
      height,
      width:
        height *
        (plantingCharacter(nearest.s, track.length, zones).canopyRatio +
          (random.next() - 0.5) * 0.04),
      yaw: random.next() * Math.PI * 2,
    };
    result.push(tree);
    const key = `${cx}:${cz}`,
      cell = occupied.get(key);
    if (cell) cell.push(tree);
    else occupied.set(key, [tree]);
  }
  return result;
}

/** A58/A54 grove and treeline layer. Separate from the near-track planting
 * plan (whose count and corridor rules are unchanged): overlapping clumps of
 * trees between ~90 m and ~520 m from the circuit, and a broken ridge treeline
 * on the rising ground beyond the venue. Clumping, species mixing and gaps
 * create depth; nothing is placed inside a structure footprint or near the
 * racing, pit or service corridors. */
export interface GrovePlan {
  groves: TreePlacement[];
  treeline: TreePlacement[];
}
export function grovePlan(
  track: Track,
  seed = 40913,
  services: readonly ServiceSite[] = serviceSitePlan(track),
): GrovePlan {
  const random = new Random(seed),
    point = trackPoint(),
    nearest = trackPoint();
  const districts = districtPlan(track, services);
  const landmark = landmarkSitePlan(track, services, districts);
  const terrain = terrainFor(track);
  const blocked = (x: number, z: number, margin: number) => {
    // Nothing grows below the waterline on a coastal venue.
    if (terrain.seaLevel !== null && terrain.height(x, z) < terrain.seaLevel + 0.6) return true;
    const l = track.nearest(x, z, nearest);
    if (Math.abs(l) < track.boundary(nearest.s, l < 0 ? -1 : 1) + 60) return true;
    return (
      inStandFootprint(track, x, z, margin) ||
      inServiceFootprint(services, x, z, margin) ||
      inDistrictFootprint(districts, x, z, margin) ||
      inLandmarkFootprint(landmark, x, z, margin)
    );
  };
  const occupied = new Map<string, TreePlacement[]>();
  const spaced = (x: number, z: number, spacing: number) => {
    const cx = Math.floor(x / 8),
      cz = Math.floor(z / 8);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        if (
          occupied
            .get(`${cx + dx}:${cz + dz}`)
            ?.some((tree) => Math.hypot(x - tree.x, z - tree.z) < spacing)
        )
          return false;
    return true;
  };
  const place = (list: TreePlacement[], tree: TreePlacement) => {
    list.push(tree);
    const key = `${Math.floor(tree.x / 8)}:${Math.floor(tree.z / 8)}`,
      cell = occupied.get(key);
    if (cell) cell.push(tree);
    else occupied.set(key, [tree]);
  };
  const groves: TreePlacement[] = [];
  for (let attempt = 0; attempt < 220 && groves.length < 900; attempt++) {
    track.at(random.next() * track.length, point);
    const lateral = (random.next() < 0.5 ? -1 : 1) * (90 + random.next() * 430);
    const gx = point.x + point.nx * lateral,
      gz = point.z + point.nz * lateral;
    if (blocked(gx, gz, 25)) continue;
    const conifer = random.next() < 0.28;
    // Dense clumps: overlapping crowns read as woodland, not scattered specimens.
    const radius = 9 + random.next() * 16,
      members = 7 + Math.floor(random.next() * 14);
    for (let m = 0; m < members && groves.length < 900; m++) {
      const a = random.next() * Math.PI * 2,
        r = radius * Math.sqrt(random.next());
      const x = gx + Math.cos(a) * r,
        z = gz + Math.sin(a) * r;
      if (blocked(x, z, 10) || !spaced(x, z, conifer ? 3.2 : 4.2)) continue;
      const height = conifer ? 10 + random.next() * 8 : 7 + random.next() * 8;
      place(groves, {
        x,
        y: terrain.height(x, z),
        z,
        height,
        width: height * (conifer ? 0.34 + random.next() * 0.1 : 0.8 + random.next() * 0.26),
        yaw: random.next() * Math.PI * 2,
      });
    }
  }
  // Broken treeline on the foothills: two jittered rows with noise gaps.
  const treeline: TreePlacement[] = [];
  for (let row = 0; row < 2; row++)
    for (let a = 0; a < Math.PI * 2; a += 9.5 / (760 + row * 70)) {
      const gap = Math.sin(a * 7 + row) * Math.sin(a * 3.3 + 1.7);
      if (gap > 0.35) continue;
      const radius = 760 + row * 70 + (random.next() - 0.5) * 40;
      const x = Math.cos(a) * radius,
        z = Math.sin(a) * radius;
      if (blocked(x, z, 20) || !spaced(x, z, 5)) continue;
      const height = 9 + random.next() * 9;
      place(treeline, {
        x,
        y: terrain.height(x, z),
        z,
        height,
        width: height * (0.55 + random.next() * 0.45),
        yaw: random.next() * Math.PI * 2,
      });
    }
  return { groves, treeline };
}

/** Authored alpha foliage atlas: three broadleaf crowns and one conifer. A
 * broadleaf crown is built from leaf clumps grouped into lobes, with gaps
 * between clumps that show the branch structure behind; the conifer is a
 * leader with whorls of drooping, needled branch sprays. Leaves and needles
 * carry an authored sky/sun gradient (lit tops and rims, dark undersides and
 * interior) so a card reads as a volume. No photograph, commercial texture or
 * pre-lit impostor is embedded. */
export const FOLIAGE_ATLAS_SIZE = 1024;
/** Crown lobes [x, y, rx, ry] in tile units (y down) for the broadleaf tiles:
 * 0 broadleaf, 2 spreading, 3 open crown (a wide, flat-topped canopy). */
const BROADLEAF_LOBES: Record<0 | 2 | 3, readonly (readonly number[])[]> = {
  0: [
    [0.5, 0.22, 0.2, 0.15],
    [0.31, 0.33, 0.19, 0.16],
    [0.69, 0.32, 0.2, 0.17],
    [0.5, 0.46, 0.28, 0.2],
    [0.26, 0.58, 0.18, 0.16],
    [0.75, 0.56, 0.18, 0.16],
    [0.47, 0.69, 0.26, 0.16],
    [0.34, 0.82, 0.15, 0.1],
    [0.63, 0.81, 0.15, 0.1],
  ],
  2: [
    [0.42, 0.19, 0.17, 0.13],
    [0.63, 0.24, 0.19, 0.14],
    [0.22, 0.38, 0.17, 0.14],
    [0.5, 0.42, 0.23, 0.17],
    [0.78, 0.41, 0.15, 0.14],
    [0.3, 0.6, 0.21, 0.14],
    [0.69, 0.61, 0.21, 0.15],
    [0.16, 0.63, 0.1, 0.09],
    [0.85, 0.62, 0.1, 0.09],
    [0.5, 0.76, 0.19, 0.11],
  ],
  3: [
    [0.5, 0.19, 0.28, 0.11],
    [0.25, 0.25, 0.19, 0.1],
    [0.75, 0.24, 0.19, 0.1],
    [0.14, 0.35, 0.1, 0.07],
    [0.86, 0.34, 0.1, 0.07],
    [0.37, 0.37, 0.21, 0.11],
    [0.64, 0.38, 0.21, 0.11],
    [0.5, 0.5, 0.17, 0.09],
    [0.29, 0.53, 0.12, 0.07],
    [0.72, 0.54, 0.13, 0.07],
  ],
};
function drawBroadleaf(
  context: CanvasRenderingContext2D,
  random: Random,
  unit: number,
  lobes: readonly (readonly number[])[],
) {
  // One trunk rises to a fork just below the crown; tapering limbs climb from
  // the fork into every lobe, with thin twigs fanning out inside it. They
  // show through the gaps between clumps.
  context.strokeStyle = '#3d3829';
  context.lineCap = 'round';
  const fork = Math.min(0.9, Math.max(...lobes.map((l) => l[1] + l[3] * 0.4)) + 0.04) * unit,
    forkX = 256 + (random.next() - 0.5) * 10;
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(256, unit);
  context.quadraticCurveTo(254, (unit + fork) / 2, forkX, fork);
  context.stroke();
  for (const [x, y] of lobes) {
    const tipX = x * unit,
      tipY = y * unit;
    for (const [width, from] of [
      [6, 0],
      [3.5, 0.45],
    ] as const) {
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(forkX + (tipX - forkX) * from, fork + (tipY - fork) * from);
      context.quadraticCurveTo(
        forkX + (tipX - forkX) * 0.35,
        fork + (tipY - fork) * 0.75,
        tipX,
        tipY,
      );
      context.stroke();
    }
    context.lineWidth = 1.8;
    for (let t = 0; t < 4; t++) {
      const a = -Math.PI / 2 + (random.next() - 0.5) * 2.6;
      context.beginPath();
      context.moveTo(tipX, tipY);
      context.lineTo(tipX + Math.cos(a) * 46, tipY + Math.sin(a) * 34);
      context.stroke();
    }
  }
  const top = Math.min(...lobes.map((l) => l[1] - l[3])),
    bottom = Math.max(...lobes.map((l) => l[1] + l[3]));
  // Clumps, back to front. Each clump has a dark core and a shell of leaves
  // lit from above; clumps high and on the rim of the crown are brighter.
  const clumps: number[][] = [];
  for (const [x, y, rx, ry] of lobes) {
    const count = 5 + Math.round((rx * ry) / 0.0035);
    for (let i = 0; i < count; i++) {
      const a = random.next() * Math.PI * 2,
        r = Math.sqrt(random.next()) * 0.78;
      const radius = (0.3 + random.next() * 0.22) * Math.min(rx, ry);
      clumps.push([x + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r, radius, random.next()]);
    }
  }
  clumps.sort((a, b) => a[3] - b[3]);
  for (const [x, y, radius, depth] of clumps) {
    const height = 1 - (y - top) / (bottom - top),
      rim = Math.min(1, Math.hypot(x - 0.5, (y - (top + bottom) / 2) * 1.3) / 0.42);
    const core = context.createRadialGradient(
      x * unit,
      y * unit,
      0,
      x * unit,
      y * unit,
      radius * unit,
    );
    core.addColorStop(0, 'rgba(17,27,11,0.96)');
    core.addColorStop(0.7, 'rgba(21,32,13,0.9)');
    core.addColorStop(1, 'rgba(21,32,13,0)');
    context.fillStyle = core;
    context.beginPath();
    context.arc(x * unit, y * unit, radius * unit * 0.9, 0, Math.PI * 2);
    context.fill();
    const leaves = 24 + Math.round(radius * 900);
    for (let i = 0; i < leaves; i++) {
      const a = random.next() * Math.PI * 2,
        r = Math.sqrt(random.next()),
        hue = random.next();
      const dx = Math.cos(a) * r,
        dy = Math.sin(a) * r;
      // -1 underside .. +1 sunlit top of the clump, then the crown position.
      const facing = -dy * 0.7 + r * 0.25 + (random.next() - 0.5) * 0.4;
      const light = Math.min(
        1,
        Math.max(0, 0.3 + facing * 0.32 + height * 0.3 + rim * 0.14 + depth * 0.12),
      );
      const red = 30 + light * 66 + hue * 18,
        green = 47 + light * 72 + hue * 8,
        blue = 17 + light * 24 - hue * 7;
      context.fillStyle = `rgb(${red | 0},${green | 0},${blue | 0})`;
      context.beginPath();
      context.ellipse(
        (x + dx * radius) * unit,
        (y + dy * radius) * unit,
        2.4 + random.next() * 3.8,
        1.4 + random.next() * 2.2,
        a + random.next(),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }
  // A ragged fringe of single leaves breaks the edge of every lobe.
  for (const [x, y, rx, ry] of lobes)
    for (let i = 0; i < 60; i++) {
      const a = random.next() * Math.PI * 2,
        r = 0.84 + random.next() * 0.2;
      const light = 0.35 + Math.max(0, -Math.sin(a)) * 0.45 + random.next() * 0.2;
      context.fillStyle = `rgb(${(32 + light * 60) | 0},${(50 + light * 66) | 0},${(18 + light * 22) | 0})`;
      context.beginPath();
      context.ellipse(
        (x + Math.cos(a) * rx * r) * unit,
        (y + Math.sin(a) * ry * r) * unit,
        2 + random.next() * 2.6,
        1.2 + random.next() * 1.6,
        random.next() * Math.PI,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
}
function drawConifer(context: CanvasRenderingContext2D, random: Random, unit: number) {
  const axis = unit / 2,
    top = 10,
    bottom = unit - 40;
  context.lineCap = 'round';
  context.strokeStyle = '#3a3125';
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(axis, unit);
  context.lineTo(axis, top + 12);
  context.stroke();
  // Whorls from the top down: each a pair of sprays that leave the leader,
  // droop and turn up slightly at the tip. Width grows towards the base.
  for (let y = top + 4; y < bottom; y += 8 + random.next() * 6) {
    const t = (y - top) / (bottom - top);
    for (const side of [-1, 1]) {
      const reach = (16 + 214 * Math.pow(t, 0.9)) * (0.82 + random.next() * 0.3),
        droop = 6 + 34 * t * (0.7 + random.next() * 0.6),
        thick = 7 + 16 * t;
      const tipX = axis + side * reach,
        tipY = y + droop * 0.75,
        midX = axis + side * reach * 0.55,
        midY = y + droop;
      // Dense, dark branch mass.
      context.fillStyle = 'rgba(24,42,29,0.97)';
      context.beginPath();
      context.moveTo(axis, y - thick * 0.3);
      context.quadraticCurveTo(midX, midY - thick, tipX, tipY - thick * 0.25);
      context.quadraticCurveTo(midX, midY + thick * 0.55, axis, y + thick * 0.8);
      context.closePath();
      context.fill();
      // A rounded, lit tuft at the tip instead of a hard point.
      context.fillStyle = `rgb(${(40 + (1 - t) * 18) | 0},${(66 + (1 - t) * 22) | 0},${(42 + (1 - t) * 10) | 0})`;
      context.beginPath();
      context.ellipse(
        tipX - side * 4,
        tipY - thick * 0.15,
        6 + 6 * t,
        3.5 + 4 * t,
        side * 0.4,
        0,
        Math.PI * 2,
      );
      context.fill();
      // Needled shoots along the spray: lit on top, dark beneath.
      const shoots = 14 + Math.round(reach / 3.2);
      for (let k = 0; k < shoots; k++) {
        const u = random.next(),
          v = 1 - u;
        const px = v * v * axis + 2 * u * v * midX + u * u * tipX,
          py = v * v * y + 2 * u * v * (midY - thick * 0.4) + u * u * tipY;
        const upper = random.next() < 0.62;
        const light = Math.min(
          1,
          Math.max(
            0,
            (upper ? 0.55 : 0.12) + (1 - t) * 0.22 + u * 0.18 + (random.next() - 0.5) * 0.3,
          ),
        );
        context.strokeStyle = `rgb(${(30 + light * 52) | 0},${(52 + light * 68) | 0},${(34 + light * 34) | 0})`;
        context.lineWidth = 1.5 + random.next() * 1.4;
        const angle = (upper ? -0.5 : 0.9) + (random.next() - 0.5) * 0.9,
          length = 6 + random.next() * (5 + 7 * t);
        context.beginPath();
        context.moveTo(px, py + (upper ? -thick * 0.25 : thick * 0.3));
        context.lineTo(px + side * Math.cos(angle) * length, py + Math.sin(angle) * length);
        context.stroke();
      }
    }
  }
}
export function foliageAtlas() {
  const size = FOLIAGE_ATLAS_SIZE,
    tileSize = size / 2,
    unit = 512;
  // Four distinct silhouettes occupy the SAME resource. A gutter prevents
  // mip/filter bleed; tile choice still follows each placement's authored
  // crown aspect (narrow placements are conifers).
  return canvasTexture(size, size, (context) => {
    context.clearRect(0, 0, size, size);
    for (let tile = 0; tile < 4; tile++) {
      const random = new Random(8231 + tile * 391);
      context.save();
      context.translate((tile % 2) * tileSize + 4, Math.floor(tile / 2) * tileSize + 4);
      context.scale((tileSize - 8) / unit, (tileSize - 8) / unit);
      context.beginPath();
      context.rect(0, 0, unit, unit);
      context.clip();
      if (tile === 1) drawConifer(context, random, unit);
      else drawBroadleaf(context, random, unit, BROADLEAF_LOBES[tile as 0 | 2 | 3]);
      context.restore();
    }
  });
}

/** Per-instance crown shaping shared by the colour, depth and distance
 * materials, so shadows match what is drawn. Every card carries its centre
 * (`cardCentre`), which moves rigidly: the crown base is set per tree
 * (conifers carry foliage to the ground, open crowns sit on a clear trunk),
 * conifer lobes close in towards the leader, lobes on one side of a crown
 * reach further than on the other and the crown is displaced towards that
 * side. Inner clump cards fade out at their own edge (`cardMask`), so they
 * add volume without showing a card outline. The tree's variation comes from
 * a hash of its position: no per-instance buffer or extra draw. */
const FOLIAGE_GLSL = `
attribute vec3 cardCentre;
attribute vec2 cardMask;
float foliageTile(mat4 m) {
  float ratio = length(m[0].xyz) / max(.000001, length(m[1].xyz));
  return ratio < .73 ? 1. : (ratio < .93 ? 0. : (ratio < 1.065 ? 2. : 3.));
}
vec3 foliageHash(vec3 p) {
  vec3 q = fract(p * vec3(.1031, .1030, .0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
float foliageReach(float tile, float h) {
  return tile == 1. ? 1.18 : (tile == 3. ? .66 + .16 * h : .92 + .2 * h);
}
vec3 foliageCrown(vec3 p, vec3 centre, mat4 m) {
  float tile = foliageTile(m);
  vec3 h = foliageHash(m[3].xyz);
  float reach = foliageReach(tile, h.x);
  vec3 local = p - centre;
  centre.y = 1.02 - (1.02 - centre.y) * reach;
  local.y *= reach;
  if (tile == 1. && dot(centre.xz, centre.xz) > .0001) {
    // Inner clump cards of a conifer close in towards the leader near the top.
    float cone = clamp((1.02 - centre.y) / .98, .2, 1.);
    centre.xz *= cone;
    local.xz *= mix(.55, 1., cone);
  }
  vec2 open = normalize(h.yz - .5 + .001);
  centre.xz *= 1. + (tile == 1. ? .06 : .18) * dot(normalize(centre.xz + .00001), open);
  centre.xz += open * (.03 + .04 * h.x) * smoothstep(.15, 1., centre.y);
  // A lowered crown never reaches below the ground at the trunk.
  vec3 shaped = centre + local;
  shaped.y = max(shaped.y, 0.);
  return shaped;
}
`;
/** Infer an immutable atlas tile from the authored width/height ratio already
 * stored in each instance matrix. Colour, depth and point-shadow materials use
 * this SAME UV mapping and crown shaping; no new per-instance buffer or draw
 * submission is needed. */
export function installFoliageAtlas(material: T.Material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec2 vCardMask;\n#ifdef USE_INSTANCING\n${FOLIAGE_GLSL}\n#endif`,
      )
      .replace(
        '#include <uv_vertex>',
        `
      #include <uv_vertex>
      #if defined(USE_INSTANCING) && defined(USE_MAP)
        float tile=foliageTile(instanceMatrix);
        // Canvas rows are top-down, texture V is bottom-up.
        vec2 atlasOffset=vec2(mod(tile,2.0),1.0-floor(tile/2.0))*.5;
        vMapUv=atlasOffset+vec2(4.0/1024.0)+clamp(vMapUv,0.0,1.0)*(.5-8.0/1024.0);
      #endif
    `,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
      vCardMask = vec2(0.);
      #ifdef USE_INSTANCING
        // Geometry without card centres (any other use of this material) is
        // drawn unshaped.
        if (cardCentre.y > 0.) transformed = foliageCrown(transformed, cardCentre, instanceMatrix);
        vCardMask = cardMask;
      #endif`,
      )
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
      #if defined(USE_INSTANCING) && defined(USE_INSTANCING_COLOR)
        if (cardCentre.y > 0.) {
          // Crown occlusion: the underside and the interior of a crown see
          // less sky than its top and rim.
          vec3 crown = foliageCrown(position, cardCentre, instanceMatrix);
          float base = 1.02 - .83 * foliageReach(foliageTile(instanceMatrix), foliageHash(instanceMatrix[3].xyz).x);
          float height = clamp((crown.y - base) / (1.02 - base), 0., 1.);
          vColor *= mix(.74, 1., sqrt(height)) * mix(.88, 1., clamp(length(crown.xz) / .4, 0., 1.));
        }
      #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCardMask;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
      // Inner clump cards fade out towards their edge (zero on silhouette
      // cards). Lit leaves survive further out than the dark gaps between
      // them, so the edge follows the foliage instead of a smooth oval.
      diffuseColor.a *= 1. - smoothstep(.45, .85, length(vCardMask) - 2. * dot(diffuseColor.rgb, vec3(.3, .59, .11)));`,
      );
  };
  material.customProgramCacheKey = () => 'four-original-planting-crowns-v3';
  // These normals describe a crown volume, not individual two-sided leaves.
  // Depth/distance passes keep exactly the same atlas and alpha coverage.
  if (material instanceof T.MeshStandardMaterial) installCanopyNormals(material);
}
/** A foliage card with its centre and, for an inner clump card, a UV window
 * into the crown and an edge mask. */
function crownCard(
  width: number,
  height: number,
  columns: number,
  rows: number,
  place: (card: T.BufferGeometry) => T.Vector3,
  window?: readonly [number, number, number],
) {
  const card = new T.PlaneGeometry(width, height, columns, rows);
  const uv = card.getAttribute('uv'),
    mask = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++)
    if (window) {
      const u = uv.getX(i),
        v = uv.getY(i);
      mask[i * 2] = u * 2 - 1;
      mask[i * 2 + 1] = v * 2 - 1;
      uv.setXY(i, window[0] + (u - 0.5) * window[2], window[1] + (v - 0.5) * window[2]);
    }
  const centre = place(card);
  const centres = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) centre.toArray(centres, i * 3);
  card.setAttribute('cardCentre', new T.BufferAttribute(centres, 3));
  card.setAttribute('cardMask', new T.BufferAttribute(mask, 2));
  return card;
}
export function treeGeometry() {
  const leaves: T.BufferGeometry[] = [];
  // Three large crossed cards define the crown silhouette from any side.
  for (let i = 0; i < 3; i++)
    leaves.push(
      crownCard(0.8, 0.82, 2, 3, (card) => {
        card.translate(0, 0.6, 0).rotateY((i * Math.PI) / 3);
        return new T.Vector3(0, 0.6, 0);
      }),
    );
  // Twelve smaller, tilted clump cards on a golden-angle spiral at three
  // heights fill the crown volume. Each shows the part of the crown at its
  // height (not a whole miniature tree) and fades out at its edge.
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.399963,
      tier = i % 3,
      radius = 0.16 + (tier === 1 ? 0.08 : 0.03),
      y = 0.42 + tier * 0.17;
    leaves.push(
      crownCard(
        0.44 - tier * 0.04,
        0.48 - tier * 0.05,
        2,
        2,
        (card) => {
          card.rotateX(-0.22 + tier * 0.12);
          card.rotateY(angle);
          card.translate(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
          return new T.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        },
        [0.5 + ((i % 3) - 1) * 0.17, (y - 0.19) / 0.82, 0.5],
      ),
    );
  }
  const leafGeometry = mergeGeometries(leaves, false)!;
  // Curved vertex normals approximate the aggregate canopy rather than exposing
  // the hard lighting seams of crossed flat cards at every viewing angle.
  const p = leafGeometry.getAttribute('position'),
    n = leafGeometry.getAttribute('normal');
  const v = new T.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), Math.max(0.08, (p.getY(i) - 0.48) * 0.6), p.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  leaves.forEach((g) => g.dispose());
  const wood: T.BufferGeometry[] = [
    new T.CylinderGeometry(0.009, 0.027, 0.67, 7).translate(0, 0.335, 0),
  ];
  for (let i = 0; i < 6; i++) {
    const angle = i * 2.4,
      a = new T.Vector3(0, 0.28 + i * 0.055, 0),
      b = new T.Vector3(Math.cos(angle) * 0.22, 0.55 + i * 0.045, Math.sin(angle) * 0.22);
    const branch = new T.CylinderGeometry(0.003, 0.009, a.distanceTo(b), 5);
    branch.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
    );
    branch.translate(...a.add(b).multiplyScalar(0.5).toArray());
    wood.push(branch);
  }
  const trunkGeometry = mergeGeometries(wood, false)!;
  wood.forEach((g) => g.dispose());
  // Distant treeline crowns: the three silhouette cards only (no trunk).
  const distant: T.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++)
    distant.push(
      crownCard(0.86, 0.9, 1, 2, (card) => {
        card.translate(0, 0.55, 0).rotateY((i * Math.PI) / 3);
        return new T.Vector3(0, 0.55, 0);
      }),
    );
  const distantLeafGeometry = mergeGeometries(distant, false)!;
  distant.forEach((g) => g.dispose());
  const dn = distantLeafGeometry.getAttribute('normal'),
    dp = distantLeafGeometry.getAttribute('position');
  for (let i = 0; i < dp.count; i++) {
    v.set(dp.getX(i), Math.max(0.1, (dp.getY(i) - 0.45) * 0.6), dp.getZ(i)).normalize();
    dn.setXYZ(i, v.x, v.y, v.z);
  }
  // Culling bounds cover the shaped crown (lowered bases, displaced lobes).
  for (const geometry of [leafGeometry, distantLeafGeometry]) {
    geometry.boundingBox = new T.Box3(
      new T.Vector3(-0.62, 0, -0.62),
      new T.Vector3(0.62, 1.06, 0.62),
    );
    geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new T.Sphere());
  }
  return { leafGeometry, trunkGeometry, distantLeafGeometry };
}
/** Per-tree foliage tints: fresh, deep, olive and blue summer greens with a
 * brightness spread, so neighbouring crowns differ. */
const FOLIAGE_TINTS = [
  [0.86, 0.9, 0.78],
  [0.95, 0.97, 0.7],
  [0.72, 0.8, 0.7],
  [0.8, 0.89, 0.86],
  [0.93, 0.89, 0.7],
] as const;
function foliageTint(i: number, seed: number, scale: number, out: T.Color) {
  const h = (Math.imul(i + 1, 0x9e3779b1) ^ seed) >>> 0;
  const tint = FOLIAGE_TINTS[(h >>> 7) % FOLIAGE_TINTS.length],
    brightness = scale * (0.9 + ((h >>> 13) % 16) / 100);
  return out.setRGB(tint[0] * brightness, tint[1] * brightness, tint[2] * brightness);
}
export function buildVegetation(
  track: Track,
  group: T.Group,
  services: readonly ServiceSite[] = serviceSitePlan(track),
  extraExclusion?: (x: number, z: number, padding: number) => boolean,
) {
  const placements = vegetationPlan(track, 7109, services, extraExclusion);
  const { groves, treeline } = grovePlan(track, 40913, services);
  const { leafGeometry, trunkGeometry, distantLeafGeometry } = treeGeometry();
  const foliage = new T.MeshStandardMaterial({
    map: foliageAtlas(),
    side: T.DoubleSide,
    alphaTest: 0.45,
    roughness: 1,
  });
  foliage.name = 'Original four-character planted foliage';
  installFoliageAtlas(foliage);
  installFoliageShading(foliage);
  installFoliageWind(foliage);
  tagWeatherSurface(foliage, 'foliage');
  const depth = new T.MeshDepthMaterial({
    depthPacking: T.RGBADepthPacking,
    map: foliage.map,
    alphaTest: foliage.alphaTest,
    side: T.DoubleSide,
  });
  const distance = new T.MeshDistanceMaterial({
    map: foliage.map,
    alphaTest: foliage.alphaTest,
    side: T.DoubleSide,
  });
  installFoliageAtlas(depth);
  installFoliageAtlas(distance);
  installFoliageWind(depth);
  installFoliageWind(distance);
  const bark = tagWeatherSurface(
    new T.MeshStandardMaterial({ color: 0x655e49, roughness: 1 }),
    'timber',
  );
  const transform = new T.Object3D(),
    color = new T.Color();
  /** One instanced draw per (bucket, part). Larger buckets for distant layers
   * trade a little off-screen vertex work for far fewer draw submissions. */
  const install = (
    trees: readonly TreePlacement[],
    bucketSize: number,
    parts: readonly (readonly [T.BufferGeometry, T.Material])[],
    label: string,
    shadows: boolean,
    tint: (i: number, out: T.Color) => T.Color,
  ) => {
    const buckets = new Map<string, TreePlacement[]>();
    for (const tree of trees) {
      const key = `${Math.floor(tree.x / bucketSize)}:${Math.floor(tree.z / bucketSize)}`,
        bucket = buckets.get(key);
      if (bucket) bucket.push(tree);
      else buckets.set(key, [tree]);
    }
    for (const [key, list] of buckets)
      for (const [geometry, material] of parts) {
        const instances = new T.InstancedMesh(geometry, material, list.length);
        instances.name = `${label} ${material === bark ? 'branches' : 'canopy'} ${key}`;
        if (label === 'Near')
          instances.name = `${material === bark ? 'Branches' : 'Canopy'} ${key}`;
        instances.userData.fullCount = list.length;
        if (material === foliage) {
          instances.customDepthMaterial = depth;
          instances.customDistanceMaterial = distance;
        }
        instances.castShadow = shadows;
        instances.receiveShadow = true;
        list.forEach((tree, i) => {
          transform.position.set(tree.x, tree.y, tree.z);
          transform.rotation.set(0, tree.yaw, 0);
          transform.scale.set(tree.width, tree.height, tree.width);
          transform.updateMatrix();
          instances.setMatrixAt(i, transform.matrix);
          instances.setColorAt(i, tint(i, color));
        });
        instances.computeBoundingBox();
        instances.computeBoundingSphere();
        group.add(instances);
      }
  };
  // 160 m buckets: frustum culling still rejects most of the lap, while the
  // draw count is roughly a quarter of the former 80 m grid.
  install(
    placements,
    160,
    [
      [leafGeometry, foliage],
      [trunkGeometry, bark],
    ],
    'Near',
    true,
    (i, out) => foliageTint(i, 0x51ed, 1, out),
  );
  // Groves sit beyond the moving shadow frustum; they receive but never cast.
  install(
    groves,
    240,
    [
      [leafGeometry, foliage],
      [trunkGeometry, bark],
    ],
    'Grove',
    false,
    (i, out) => foliageTint(i, 0x3c17, 0.95, out),
  );
  install(treeline, 700, [[distantLeafGeometry, foliage]], 'Treeline', false, (i, out) =>
    foliageTint(i, 0x7a2b, 0.92, out),
  );
  group.userData.treeCount = placements.length;
  group.userData.groveTrees = groves.length;
  group.userData.treelineTrees = treeline.length;
}
