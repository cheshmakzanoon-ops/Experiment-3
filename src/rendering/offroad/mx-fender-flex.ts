import * as T from 'three';

/** A single clamped-beam mode per cantilever. Its end displacement and slope
 * vanish at the moulded mounting lands. Both faces of the thin shell receive
 * the same continuous shear and the corresponding inverse-transpose normal. */
export function prepareMxFenderFlex(g: T.BufferGeometry, front: boolean) {
  const pos = g.getAttribute('position'),
    norm = g.getAttribute('normal');
  const offsets = new Float32Array(pos.count * 3),
    normals = new Float32Array(pos.count * 3);
  const n = new T.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const aft = front && z < -0.1;
    const base = front ? (aft ? -0.1 : 0.09) : -0.77;
    const sign = front && !aft ? 1 : -1;
    const length = front ? (aft ? 0.16 : 0.39) : 0.31;
    const tip = front ? (aft ? 0.006 : 0.026) : 0.018;
    const u = T.MathUtils.clamp(((z - base) * sign) / length, 0, 1);
    const h = -tip * u * u * (1.5 - 0.5 * u);
    const slope = ((-tip * sign) / length) * u * (3 - 1.5 * u);
    offsets[i * 3 + 1] = h;
    n.fromBufferAttribute(norm, i);
    n.z -= slope * n.y;
    n.normalize();
    normals[i * 3] = n.x - norm.getX(i);
    normals[i * 3 + 1] = n.y - norm.getY(i);
    normals[i * 3 + 2] = n.z - norm.getZ(i);
  }
  g.morphTargetsRelative = true;
  g.morphAttributes.position = [new T.Float32BufferAttribute(offsets, 3)];
  g.morphAttributes.normal = [new T.Float32BufferAttribute(normals, 3)];
  g.computeBoundingBox();
  g.computeBoundingSphere();
  // Three's extrema include a unit positive morph, but rebound is negative.
  g.boundingBox!.expandByScalar(0.009);
  g.boundingSphere!.radius += 0.009;
}

/** The snapshot carries tyre support in multiples of static weight. Air
 * unloads the plastics; a landing loads them. Fork/rear bias distributes
 * the recorded impulse. A held grid, pause or rewind has no phase to drift. */
export function mxFenderLoad(
  supportG: number | undefined,
  speed: number | undefined,
  bias: number,
) {
  const g = Number.isFinite(supportG) ? T.MathUtils.clamp(supportG!, 0, 8) : 1;
  const v = Number.isFinite(speed) ? Math.abs(speed!) : 0;
  const moving = Math.max(T.MathUtils.smoothstep(v, 0.5, 4), T.MathUtils.smoothstep(g, 1.4, 2.3));
  return T.MathUtils.clamp((0.22 * (g - 1) + 0.19 * bias) * moving, -0.32, 1);
}
