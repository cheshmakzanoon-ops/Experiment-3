import * as T from 'three';
import { Random, clamp } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { CrowdCluster } from '../crowd.ts';
import { crowdFlagMaterial } from '../grandstand.ts';
import { buildCrowdFlags, crowdColour } from '../studio/crowd-flags.ts';
import { cataloguePlantingGround } from './planting-ground.ts';
import type { GpSpectatorBank } from './gp-spectator-bank-sites.ts';

/** The berm is an indexed lawn surface. Keep the two authored crossfall
 * triangles per cell so both soles and the access rail sit on the drawn mesh. */
export function gpBankSurface(track: Track, site: GpSpectatorBank) {
  const rows = 16,
    cols = 8,
    stride = cols + 1,
    pos: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const terrain = cataloguePlantingGround(track),
    near = trackPoint();
  const c = Math.cos(site.yaw),
    n = Math.sin(site.yaw);
  for (let row = 0; row <= rows; row++) {
    const along = row / rows,
      z = (along - 0.5) * site.length;
    const end = T.MathUtils.smoothstep(Math.min(along, 1 - along), 0, 0.19);
    for (let col = 0; col <= cols; col++) {
      const across = col / cols,
        x = site.side * (across - 0.5) * site.width;
      const wx = site.x + c * x + n * z,
        wz = site.z - n * x + c * z;
      const l = track.nearest(wx, wz, near);
      const profile =
        T.MathUtils.smoothstep(across, 0, 0.66) * (1 - T.MathUtils.smoothstep(across, 0.74, 1));
      const y = terrain(near.s, l, wx, wz) - 0.17 + site.rise * end * profile;
      pos.push(x, y, z);
      uv.push(wx * 0.12, wz * 0.12);
      if (row === rows || col === cols) continue;
      const a = row * stride + col,
        b = a + 1,
        d = a + stride,
        e = d + 1;
      if (site.side > 0) index.push(a, d, b, b, d, e);
      else index.push(a, b, d, b, e, d);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const height = (x: number, z: number) => {
    const u = clamp((x * site.side) / site.width + 0.5, 0, 1) * cols,
      v = clamp(z / site.length + 0.5, 0, 1) * rows;
    const i = Math.min(cols - 1, Math.floor(u)),
      j = Math.min(rows - 1, Math.floor(v));
    const fx = u - i,
      fz = v - j,
      a = j * stride + i,
      y = (k: number) => pos[3 * k + 1];
    return fx + fz <= 1
      ? y(a) * (1 - fx - fz) + y(a + 1) * fx + y(a + stride) * fz
      : y(a + stride + 1) * (fx + fz - 1) + y(a + 1) * (1 - fz) + y(a + stride) * (1 - fx);
  };
  return { geometry, height };
}

export function buildGpSpectatorBank(
  track: Track,
  site: GpSpectatorBank,
  props: T.Group,
  crowd: T.Group,
  clusters: CrowdCluster[],
  lawn: T.Material,
  people: T.MeshStandardMaterial,
  steel: T.Material,
) {
  const land = new T.Group(),
    fans = new T.Group();
  land.name = 'GP general-admission bank';
  fans.name = 'GP bank supporters';
  for (const root of [land, fans]) {
    root.position.set(site.x, 0, site.z);
    root.rotation.y = site.yaw;
  }
  props.add(land);
  crowd.add(fans);
  const { geometry, height } = gpBankSurface(track, site);
  const turf = new T.Mesh(geometry, lawn);
  turf.name = 'GP viewing bank turf';
  turf.receiveShadow = true;
  land.add(turf);
  const rng = new Random(7625 + Math.round(site.station)),
    pose = new T.Object3D();
  const peopleMatrices: T.Matrix4[] = [],
    shirts: T.Color[] = [],
    holders: T.Matrix4[] = [];
  const half = site.length * 0.38,
    cols = Math.floor((2 * half) / 1.05);
  // Friends arrive in groups, leave a walk-through at either end and a path
  // between the two middle groups. Faces point towards the live racing line.
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < cols; col++) {
      const z = (col - (cols - 1) * 0.5) * 1.05 + 0.38 * (rng.next() - 0.5);
      if (Math.abs(z - 3) < 1.7 || (col + row * 2) % 14 > 10 || rng.next() < 0.24) continue;
      const x = site.side * ((0.34 + 0.106 * row - 0.5) * site.width + 0.4 * (rng.next() - 0.5));
      const scale = 0.9 + 0.18 * rng.next(),
        yaw = (site.side < 0 ? Math.PI : 0) + 0.4 * (rng.next() - 0.5) - (0.36 * z) / site.length;
      const soleX = x - 0.47 * scale * Math.cos(yaw),
        soleZ = z + 0.47 * scale * Math.sin(yaw);
      pose.position.set(x, height(soleX, soleZ) + 0.3 * scale, z);
      pose.rotation.set(0, yaw, 0);
      pose.scale.setScalar(scale);
      pose.updateMatrix();
      peopleMatrices.push(pose.matrix.clone());
      shirts.push(new T.Color(crowdColour(rng.next(), rng.next())));
      const hand = new T.Matrix4().makeTranslation(-0.51, 0.43, 0.15);
      holders.push(pose.matrix.clone().multiply(hand));
    }
  }
  const seed = Math.round(site.station);
  const cluster = new CrowdCluster(
    peopleMatrices,
    shirts,
    seed,
    people,
    undefined,
    site.side,
    true,
  );
  fans.add(cluster.root);
  clusters.push(cluster);
  const flags = buildCrowdFlags(holders, seed, crowdFlagMaterial(true), true);
  if (flags) fans.add(flags);
  // Low crowd rail along the front aisle. Metal posts and spans in one draw.
  const bars: T.Matrix4[] = [],
    a = new T.Vector3(),
    b = new T.Vector3(),
    axis = new T.Vector3(),
    up = new T.Vector3(0, 1, 0);
  const segments = Math.ceil((2 * half) / 3);
  const railX = -site.side * site.width * 0.215;
  for (let i = 0; i <= segments; i++) {
    const z = -half + (2 * half * i) / segments,
      y = height(railX, z);
    pose.position.set(railX, y + 0.49, z);
    pose.quaternion.identity();
    pose.scale.set(0.068, 0.98, 0.068);
    pose.updateMatrix();
    bars.push(pose.matrix.clone());
    if (i === segments) continue;
    const next = -half + (2 * half * (i + 1)) / segments;
    a.set(railX, y + 0.94, z);
    b.set(railX, height(railX, next) + 0.94, next);
    axis.subVectors(b, a);
    pose.scale.set(0.056, axis.length(), 0.056);
    pose.position.lerpVectors(a, b, 0.5);
    pose.quaternion.setFromUnitVectors(up, axis.normalize());
    pose.updateMatrix();
    bars.push(pose.matrix.clone());
  }
  const rail = new T.InstancedMesh(new T.CylinderGeometry(0.5, 0.5, 1, 6), steel, bars.length);
  rail.name = 'GP bank crowd rail';
  bars.forEach((m, i) => rail.setMatrixAt(i, m));
  rail.computeBoundingSphere();
  rail.castShadow = rail.receiveShadow = true;
  land.add(rail);
}
