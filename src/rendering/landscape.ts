import { terrainHeight } from './terrain-profile.ts';
import { districtPlan, inDistrictFootprint } from './venue-districts.ts';
import { serviceSitePlan, inServiceFootprint, type ServiceSite } from './venue-service-plan.ts';
import { grassApronOffset } from './ground-profile.ts';
import { inStandFootprint } from './grandstand.ts';
import * as T from 'three';
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
      inDistrictFootprint(districts, x, z, 8)
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

/** Authored alpha foliage atlas with branch structure and separate small leaves.
 * No photograph, commercial texture or pre-lit impostor is embedded. */
export function foliageAtlas() {
  const size = 512,
    tileSize = size / 2;
  // Four distinct silhouettes occupy the SAME 512px resource. A gutter prevents
  // mip/filter bleed; leaf count is unchanged from the original one-tree atlas.
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
      context.translate((tile % 2) * tileSize + 3, Math.floor(tile / 2) * tileSize + 3);
      context.scale((tileSize - 6) / size, (tileSize - 6) / size);
      context.strokeStyle = '#494b31';
      context.lineWidth = 5;
      for (const [cx, cy] of clusters) {
        context.beginPath();
        context.moveTo(256, 500);
        context.quadraticCurveTo(260, 330, cx * size, cy * size);
        context.stroke();
      }
      for (let i = 0; i < 1150; i++) {
        const c = clusters[i % clusters.length],
          angle = random.next() * Math.PI * 2,
          radius = Math.sqrt(random.next()),
          light = random.next();
        const x = (c[0] + Math.cos(angle) * c[2] * radius) * size,
          y = (c[1] + Math.sin(angle) * c[3] * radius) * size;
        context.fillStyle = `rgb(${48 + light * 35},${65 + light * 38},${27 + light * 23})`;
        context.beginPath();
        context.ellipse(
          x,
          y,
          4 + random.next() * 6,
          2.2 + random.next() * 3.6,
          angle,
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
        vMapUv=atlasOffset+vec2(3.0/512.0)+vMapUv*(.5-6.0/512.0);
      #endif
    `,
    );
  };
  material.customProgramCacheKey = () => 'four-original-planting-crowns-v1';
}
function treeGeometry() {
  const leaves: T.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const card = new T.PlaneGeometry(0.78, 0.8, 2, 3);
    card.translate(0, 0.6, 0);
    card.rotateY((i * Math.PI) / 3);
    leaves.push(card);
  }
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.399963,
      card = new T.PlaneGeometry(0.48, 0.53, 2, 2);
    card.rotateX(-0.16);
    card.rotateY(angle);
    card.translate(Math.cos(angle) * 0.18, 0.55 + (i % 3) * 0.075, Math.sin(angle) * 0.18);
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
  return { leafGeometry, trunkGeometry };
}
export function buildVegetation(
  track: Track,
  group: T.Group,
  services: readonly ServiceSite[] = serviceSitePlan(track),
) {
  const placements = vegetationPlan(track, 7109, services),
    buckets = new Map<string, TreePlacement[]>();
  for (const tree of placements) {
    const key = `${Math.floor(tree.x / 80)}:${Math.floor(tree.z / 80)}`,
      bucket = buckets.get(key);
    if (bucket) bucket.push(tree);
    else buckets.set(key, [tree]);
  }
  const { leafGeometry, trunkGeometry } = treeGeometry();
  const foliage = new T.MeshStandardMaterial({
    map: foliageAtlas(),
    side: T.DoubleSide,
    alphaTest: 0.45,
    roughness: 1,
  });
  foliage.name = 'Original four-character planted foliage';
  installFoliageAtlas(foliage);
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
  const bark = new T.MeshStandardMaterial({ color: 0x655e49, roughness: 1 });
  const transform = new T.Object3D(),
    color = new T.Color();
  for (const [key, trees] of buckets)
    for (const [geometry, material] of [
      [leafGeometry, foliage],
      [trunkGeometry, bark],
    ] as const) {
      const instances = new T.InstancedMesh(geometry, material, trees.length);
      instances.name = `${material === foliage ? 'Canopy' : 'Branches'} ${key}`;
      instances.userData.fullCount = trees.length;
      if (material === foliage) {
        instances.customDepthMaterial = depth;
        instances.customDistanceMaterial = distance;
      }
      instances.castShadow = true;
      instances.receiveShadow = true;
      trees.forEach((tree, i) => {
        transform.position.set(tree.x, tree.y, tree.z);
        transform.rotation.set(0, tree.yaw, 0);
        transform.scale.set(tree.width, tree.height, tree.width);
        transform.updateMatrix();
        instances.setMatrixAt(i, transform.matrix);
        color.setRGB(0.83 + (i % 5) * 0.025, 0.86 + (i % 7) * 0.018, 0.75 + (i % 3) * 0.05);
        instances.setColorAt(i, color);
      });
      instances.computeBoundingBox();
      instances.computeBoundingSphere();
      group.add(instances);
    }
  group.userData.treeCount = placements.length;
}
