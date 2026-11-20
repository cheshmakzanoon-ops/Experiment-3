import * as T from 'three';
import { valueNoise } from '../terrain-profile.ts';

/** Rounded fracture planes give an embedded stone a settled base, bedding
 * and a broken crown. Vertex relief is in local metres so it follows every
 * instance orientation; the streamed rock scan supplies the finer grain. */
export function mxFieldstoneGeometry() {
  const geometry = new T.IcosahedronGeometry(1, 3);
  const positions = geometry.getAttribute('position');
  const colours = new Float32Array(positions.count * 3);
  const normalsByPoint = new Map<string, T.Vector3>();
  const keys: string[] = [];
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const broad = valueNoise(x * 2.4 + z * 1.3 + 4.7, y * 2.6 - z + 2.3);
    const fractured = valueNoise(z * 5.8 + x * 2.2, y * 4.1 - x * 1.7 + 7.1);
    const r = 0.9 + broad * 0.18 + fractured * 0.08;
    const rx = T.MathUtils.clamp(x * r + 0.08 * y, -0.88, 0.96);
    const ry = T.MathUtils.clamp(y * r, -0.71 + 0.09 * x, 0.77 - 0.12 * x - 0.16 * z);
    const rz = T.MathUtils.clamp(z * r - y * 0.08, -0.85 + 0.12 * x, 0.88 + 0.06 * y);
    positions.setXYZ(i, rx, ry, rz);
    const strata = T.MathUtils.smoothstep(
      Math.sin((ry + 0.26 * rx - 0.17 * rz) * 14 + fractured * 2.4),
      0.35,
      0.9,
    );
    const shade = 0.74 + broad * 0.16 + fractured * 0.1 + strata * 0.035;
    colours.set([shade * (0.98 + strata * 0.02), shade, shade * (1.03 - strata * 0.06)], i * 3);
    const key = [x, y, z].map((n) => Math.round(n * 100000)).join('/');
    keys.push(key);
    if (!normalsByPoint.has(key)) normalsByPoint.set(key, new T.Vector3());
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal'),
    n = new T.Vector3();
  for (let i = 0; i < normals.count; i++)
    normalsByPoint.get(keys[i])!.add(n.fromBufferAttribute(normals, i));
  for (const normal of normalsByPoint.values()) normal.normalize();
  for (let i = 0; i < normals.count; i++) {
    n.fromBufferAttribute(normals, i).lerp(normalsByPoint.get(keys[i])!, 0.72).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  geometry.setAttribute('color', new T.BufferAttribute(colours, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'Weathered fractured fieldstone';
  return geometry;
}
