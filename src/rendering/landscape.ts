import { tagWeatherSurface } from './weather-presentation.ts';
import { landmarkSitePlan, inLandmarkFootprint } from './venue-landmark.ts';
import { terrainHeight } from './terrain-profile.ts';
import { districtPlan, inDistrictFootprint } from './venue-districts.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import * as T from 'three';
import { installCanopyNormals } from './canopy-normals.ts';
import { Random, clamp } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { canvasTexture } from './geometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { terrainHeight } from './terrain-profile.ts';
/** Distinct planting character along the existing original circuit. These are
 * landscaping zones, NOT additional tracks or a claim of botanical simulation. */
export const PLANTING_ZONES = Object.freeze([
  { endFraction: 0.14, canopyRatio: 0.64, species: 'upright' },
  { endFraction: 0.34, canopyRatio: 0.84, species: 'broadleaf' },
  { endFraction: 0.55, canopyRatio: 1.0, species: 'spreading' },
  { endFraction: 0.76, canopyRatio: 1.13, species: 'open-crown' },
  { endFraction: 1, canopyRatio: 0.84, species: 'broadleaf' },
] as const);
export function plantingCharacter(s: number, length: number) {
  if (!Number.isFinite(s + length) || length <= 0) throw new Error('Invalid planting station');
  const fraction = (((s % length) + length) % length) / length;
  return PLANTING_ZONES.find((zone) => fraction < zone.endFraction)!;
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
): TreePlacement[] {
  const random = new Random(seed),
    result: TreePlacement[] = [],
    point = trackPoint(),
    nearest = trackPoint();
  const occupied = new Map<string, TreePlacement[]>();
  const districts = districtPlan(track, services);
  const landmark = landmarkSitePlan(track, services, districts);
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
      inDistrictFootprint(districts, x, z, 8) ||
      inLandmarkFootprint(landmark, x, z, 8)
    )
      blocked = true;
    if (blocked) continue;
    const y =
      Math.abs(l) <= nearest.width + 38
        ? nearest.y + nearest.bank * clamp(l, -12, 12) + grassApronOffset(track, nearest.s, l)
        : terrainHeight(x, z);
    const height = 6 + random.next() * 7;
    const tree = {
      x,
      y,
      z,
      height,
      width:
        height *
        (plantingCharacter(nearest.s, track.length).canopyRatio + (random.next() - 0.5) * 0.04),
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
  const blocked = (x: number, z: number, margin: number) => {
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
        y: terrainHeight(x, z),
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
        y: terrainHeight(x, z),
        z,
        height,
        width: height * (0.55 + random.next() * 0.45),
        yaw: random.next() * Math.PI * 2,
      });
    }
  return { groves, treeline };
}

/** Authored alpha foliage atlas with branch structure, a shaded inner crown
 * mass and several thousand small leaves per silhouette. Leaves are lit by an
 * authored sky/sun gradient across each cluster (lighter crowns, darker
 * undersides and interior) so the crown reads as a volume instead of a flat
 * blotch. No photograph, commercial texture or pre-lit impostor is embedded. */
export const FOLIAGE_ATLAS_SIZE = 1024;
export function foliageAtlas() {
  const size = FOLIAGE_ATLAS_SIZE,
    tileSize = size / 2,
    unit = 512;
  // Four distinct silhouettes occupy the SAME resource. A gutter prevents
  // mip/filter bleed. Cluster layouts are unchanged; tile choice still follows
  // each placement's authored crown aspect.
  return canvasTexture(size, size, (context) => {
    context.clearRect(0, 0, size, size);
    const variants = [
      [
        [0.5, 0.2, 0.18, 0.16],
        [0.32, 0.39, 0.24, 0.21],
        [0.69, 0.4, 0.23, 0.23],
        [0.47, 0.59, 0.32, 0.27],
        [0.24, 0.68, 0.16, 0.15],
        [0.76, 0.67, 0.15, 0.17],
      ],
      [
        [0.5, 0.16, 0.19, 0.12],
        [0.43, 0.32, 0.24, 0.18],
        [0.57, 0.47, 0.25, 0.19],
        [0.46, 0.62, 0.25, 0.2],
        [0.52, 0.76, 0.2, 0.12],
      ],
      [
        [0.45, 0.26, 0.21, 0.14],
        [0.28, 0.39, 0.22, 0.17],
        [0.72, 0.41, 0.24, 0.18],
        [0.44, 0.57, 0.29, 0.2],
        [0.24, 0.63, 0.18, 0.13],
        [0.79, 0.64, 0.14, 0.11],
      ],
      [
        [0.43, 0.19, 0.15, 0.12],
        [0.23, 0.37, 0.17, 0.14],
        [0.74, 0.34, 0.19, 0.15],
        [0.5, 0.49, 0.18, 0.17],
        [0.32, 0.67, 0.2, 0.15],
        [0.76, 0.67, 0.15, 0.16],
      ],
    ];
    for (let tile = 0; tile < 4; tile++) {
      const random = new Random(8231 + tile * 391),
        clusters = variants[tile];
      context.save();
      context.translate((tile % 2) * tileSize + 4, Math.floor(tile / 2) * tileSize + 4);
      context.scale((tileSize - 8) / unit, (tileSize - 8) / unit);
      // Branch skeleton: a trunk fork into each cluster, with lateral twigs.
      context.strokeStyle = '#3f3a2b';
      context.lineCap = 'round';
      for (const [cx, cy] of clusters) {
        context.lineWidth = 6;
        context.beginPath();
        context.moveTo(256, 505);
        context.quadraticCurveTo(250 + (cx - 0.5) * 60, 360, cx * unit, cy * unit);
        context.stroke();
        context.lineWidth = 2.2;
        for (let t = 0; t < 3; t++) {
          const a = random.next() * Math.PI * 2;
          context.beginPath();
          context.moveTo(cx * unit, cy * unit);
          context.lineTo(cx * unit + Math.cos(a) * 34, cy * unit + Math.sin(a) * 26);
          context.stroke();
        }
      }
      // Inner crown mass: dark, partly transparent so gaps remain between clusters.
      for (const [cx, cy, rx, ry] of clusters) {
        const g = context.createRadialGradient(
          cx * unit,
          cy * unit,
          0,
          cx * unit,
          cy * unit,
          Math.max(rx, ry) * unit,
        );
        g.addColorStop(0, 'rgba(22,34,14,0.95)');
        g.addColorStop(0.72, 'rgba(26,39,16,0.85)');
        g.addColorStop(1, 'rgba(26,39,16,0)');
        context.fillStyle = g;
        context.beginPath();
        context.ellipse(cx * unit, cy * unit, rx * unit * 0.86, ry * unit * 0.84, 0, 0, Math.PI * 2);
        context.fill();
      }
      // Leaves, back to front: lower/inner leaves darker, upper rim brighter.
      const leaves = 2600;
      for (let i = 0; i < leaves; i++) {
        const c = clusters[i % clusters.length],
          angle = random.next() * Math.PI * 2,
          radius = Math.sqrt(random.next()),
          hue = random.next();
        const dx = Math.cos(angle) * radius,
          dy = Math.sin(angle) * radius;
        // -1 underside .. +1 sunlit top of the cluster, plus rim brightening.
        const facing = -dy * 0.75 + radius * 0.35 + (random.next() - 0.5) * 0.35;
        const depth = i / leaves; // later leaves sit in front
        const light = Math.min(1, Math.max(0, 0.42 + facing * 0.45 + depth * 0.22));
        const r = 34 + light * 58 + hue * 16,
          gr = 52 + light * 66 + hue * 8,
          b = 20 + light * 26 - hue * 6;
        context.fillStyle = `rgb(${r | 0},${gr | 0},${b | 0})`;
        context.beginPath();
        context.ellipse(
          (c[0] + dx * c[2]) * unit,
          (c[1] + dy * c[3]) * unit,
          2.6 + random.next() * 4.2,
          1.5 + random.next() * 2.4,
          angle + random.next(),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
      context.restore();
    }
  });
}

/** Infer an immutable atlas tile from the authored width/height ratio already
 * stored in each instance matrix. Colour, depth and point-shadow materials use
 * this SAME UV mapping; no new per-instance buffer or draw submission is needed. */
export function installFoliageAtlas(material: T.Material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `
      #include <uv_vertex>
      #if defined(USE_INSTANCING) && defined(USE_MAP)
        float crownRatio=length(instanceMatrix[0].xyz)/max(.000001,length(instanceMatrix[1].xyz));
        float tile=crownRatio<.73?1.0:(crownRatio<.93?0.0:(crownRatio<1.065?2.0:3.0));
        // Canvas rows are top-down, texture V is bottom-up.
        vec2 atlasOffset=vec2(mod(tile,2.0),1.0-floor(tile/2.0))*.5;
        vMapUv=atlasOffset+vec2(4.0/1024.0)+vMapUv*(.5-8.0/1024.0);
      #endif
    `,
    );
  };
  material.customProgramCacheKey = () => 'four-original-planting-crowns-v2';
  // These normals describe a crown volume, not individual two-sided leaves.
  // Depth/distance passes keep exactly the same atlas and alpha coverage.
  if (material instanceof T.MeshStandardMaterial) installCanopyNormals(material);
}
function treeGeometry() {
  const leaves: T.BufferGeometry[] = [];
  // Three large crossed cards define the crown silhouette from any side.
  for (let i = 0; i < 3; i++) {
    const card = new T.PlaneGeometry(0.8, 0.82, 2, 3);
    card.translate(0, 0.6, 0);
    card.rotateY((i * Math.PI) / 3);
    leaves.push(card);
  }
  // Twelve smaller, tilted cards on a golden-angle spiral at three heights fill
  // the crown volume and break the single-blob outline into lobes.
  for (let i = 0; i < 12; i++) {
    const angle = i * 2.399963,
      tier = i % 3,
      radius = 0.16 + (tier === 1 ? 0.08 : 0.03),
      card = new T.PlaneGeometry(0.44 - tier * 0.04, 0.48 - tier * 0.05, 2, 2);
    card.rotateX(-0.22 + tier * 0.12);
    card.rotateY(angle);
    card.translate(Math.cos(angle) * radius, 0.42 + tier * 0.17, Math.sin(angle) * radius);
    leaves.push(card);
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
      new T.PlaneGeometry(0.86, 0.9, 1, 2)
        .translate(0, 0.55, 0)
        .rotateY((i * Math.PI) / 3),
    );
  const distantLeafGeometry = mergeGeometries(distant, false)!;
  distant.forEach((g) => g.dispose());
  const dn = distantLeafGeometry.getAttribute('normal'),
    dp = distantLeafGeometry.getAttribute('position');
  for (let i = 0; i < dp.count; i++) {
    v.set(dp.getX(i), Math.max(0.1, (dp.getY(i) - 0.45) * 0.6), dp.getZ(i)).normalize();
    dn.setXYZ(i, v.x, v.y, v.z);
  }
  return { leafGeometry, trunkGeometry, distantLeafGeometry };
}
export function buildVegetation(
  track: Track,
  group: T.Group,
  services: readonly ServiceSite[] = serviceSitePlan(track),
) {
  const placements = vegetationPlan(track, 7109, services);
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
        if (label === 'Near') instances.name = `${material === bark ? 'Branches' : 'Canopy'} ${key}`;
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
    (i, out) => out.setRGB(0.83 + (i % 5) * 0.025, 0.86 + (i % 7) * 0.018, 0.75 + (i % 3) * 0.05),
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
    (i, out) => out.setRGB(0.76 + (i % 6) * 0.03, 0.82 + (i % 5) * 0.025, 0.7 + (i % 4) * 0.04),
  );
  install(
    treeline,
    700,
    [[distantLeafGeometry, foliage]],
    'Treeline',
    false,
    (i, out) => out.setRGB(0.72 + (i % 5) * 0.03, 0.8 + (i % 4) * 0.03, 0.72 + (i % 3) * 0.04),
  );
  group.userData.treeCount = placements.length;
  group.userData.groveTrees = groves.length;
  group.userData.treelineTrees = treeline.length;
}
