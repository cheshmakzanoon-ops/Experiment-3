import * as T from 'three';
import { Random, clamp } from '../core/math.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { canvasTexture } from './geometry.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function terrainHeight(x: number, z: number) {
  const distance = Math.hypot(x, z);
  return (
    -4 +
    Math.max(0, distance - 680) * 0.033 * (0.3 + 0.7 * Math.sin(x * 0.004 + z * 0.002) ** 2) +
    Math.max(0, distance - 1000) * 0.038 * Math.cos(x * 0.003 - z * 0.004) ** 2
  );
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
export function vegetationPlan(track: Track, seed = 7109): TreePlacement[] {
  const random = new Random(seed),
    result: TreePlacement[] = [],
    point = trackPoint(),
    nearest = trackPoint();
  const occupied = new Map<string, TreePlacement[]>();
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
    // Keep grandstand roof/service areas clear, including their long ends.
    for (const [s, sign] of [
      [450, -1],
      [780, 1],
      [1220, -1],
      [1670, 1],
      [2210, -1],
      [2600, 1],
    ]) {
      track.at(s, point);
      const tx = x - point.x - point.nx * sign * (point.width + 28),
        tz = z - point.z - point.nz * sign * (point.width + 28);
      if (
        Math.abs(tx * point.tx + tz * point.tz) < 33 &&
        Math.abs(tx * point.nx + tz * point.nz) < 15
      )
        blocked = true;
    }
    if (blocked) continue;
    const y =
      Math.abs(l) <= nearest.width + 38
        ? nearest.y +
          nearest.bank * clamp(l, -12, 12) -
          0.04 -
          Math.max(0, Math.abs(l) - 15) * 0.045
        : terrainHeight(x, z);
    const height = 6 + random.next() * 7;
    const tree = {
      x,
      y,
      z,
      height,
      width: height * (0.72 + random.next() * 0.3),
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
function foliageAtlas() {
  const random = new Random(8231),
    size = 512;
  return canvasTexture(size, size, (context) => {
    context.clearRect(0, 0, size, size);
    const clusters = [
      [0.5, 0.2, 0.18, 0.16],
      [0.32, 0.39, 0.24, 0.21],
      [0.69, 0.4, 0.23, 0.23],
      [0.47, 0.59, 0.32, 0.27],
      [0.24, 0.68, 0.16, 0.15],
      [0.76, 0.67, 0.15, 0.17],
    ];
    context.strokeStyle = '#494b31';
    context.lineWidth = 4;
    for (const [cx, cy] of clusters) {
      context.beginPath();
      context.moveTo(256, 500);
      context.quadraticCurveTo(260, 330, cx * size, cy * size);
      context.stroke();
    }
    for (let i = 0; i < 4600; i++) {
      const c = clusters[i % clusters.length],
        angle = random.next() * Math.PI * 2,
        radius = Math.sqrt(random.next());
      const x = (c[0] + Math.cos(angle) * c[2] * radius) * size,
        y = (c[1] + Math.sin(angle) * c[3] * radius) * size;
      const light = random.next();
      context.fillStyle = `rgb(${48 + light * 35},${65 + light * 38},${27 + light * 23})`;
      context.beginPath();
      context.ellipse(
        x,
        y,
        2 + random.next() * 4,
        1.1 + random.next() * 1.8,
        angle,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  });
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
export function buildVegetation(track: Track, group: T.Group) {
  const placements = vegetationPlan(track),
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
  foliage.name = 'Original layered broadleaf foliage';
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
