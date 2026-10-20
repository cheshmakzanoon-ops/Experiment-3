import { Vec3 } from '../core/math.ts';
import { TriangleBVH, type RayHit } from './bvh.ts';

/** Finite tire-crown envelope for the static road mesh. The shape is an
 * ellipsoid: rolling/radial semiaxes `radius`, axle semiaxis `halfWidth`.
 * Scaling only the axle coordinate turns its continuous sweep into an exact
 * sphere/triangle query (faces, edges and vertices). Each query examines whole
 * nearby triangles without a grid of footprint samples or temporal smoothing.
 * The sweep follows the suspension axis at the current vehicle pose; it does
 * not sweep the car's motion between substeps. Envelope height is continuous
 * at curb onset, while the selected unilateral support normal can change.
 *
 * The caller retains its existing centre-ray support. This envelope only adds
 * an earlier, geometrically reachable support; since halfWidth <= radius,
 * it cannot advance the old radius/cosine support on a planar road. It is a
 * reduced rounded crown, not a full tire sidewall/unsprung-mass simulation.
 * `distance` is wheel-centre travel along the unit suspension direction, not
 * the ray distance to the road. `point` is the actual triangle support point.
 */
export class TireFootprint {
  private readonly stack = new Int32Array(128);
  private readonly vertices = new Float64Array(9);
  private readonly origin = new Vec3();
  private readonly direction = new Vec3();
  private readonly axle = new Vec3();
  private dx = 0;
  private dy = 0;
  private dz = 0;
  private scale = 1;
  private inverse = 1;
  private radius = 0;
  private minimum = 0;
  private maximum = 0;
  private rx = 0;
  private ry = 0;
  private rz = 0;
  /** Candidate triangles and actual face/edge/vertex tests for cost probes. */
  trianglesTested = 0;
  featureTests = 0;

  constructor(readonly bvh: TriangleBVH) {}

  cast(
    origin: Vec3,
    direction: Vec3,
    maximum: number,
    radius: number,
    halfWidth: number,
    axle: Vec3,
    priorLength: number,
    out: RayHit,
  ): boolean {
    if (
      !origin.finite() ||
      !direction.finite() ||
      !axle.finite() ||
      !Number.isFinite(maximum) ||
      maximum < 0 ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isFinite(halfWidth) ||
      halfWidth <= 0 ||
      halfWidth > radius ||
      Number.isNaN(priorLength) ||
      priorLength === -Infinity ||
      Math.abs(direction.length() - 1) > 1e-5 ||
      Math.abs(axle.length() - 1) > 1e-5
    )
      throw new Error('Invalid tire-footprint query');
    this.origin.copy(origin);
    this.direction.copy(direction);
    this.axle.copy(axle);
    this.radius = radius;
    this.maximum = maximum;
    // Existing point contact caps its road-normal cosine at 0.15. Keep that
    // same finite penetration-recovery range; support behind the ray origin
    // is rejected independently below, so an overhead deck cannot be caught.
    this.minimum = -radius / 0.15;
    this.scale = radius / halfWidth;
    this.inverse = halfWidth / radius;
    const along = (this.scale - 1) * axle.dot(direction);
    this.dx = direction.x + along * axle.x;
    this.dy = direction.y + along * axle.y;
    this.dz = direction.z + along * axle.z;
    const difference = halfWidth * halfWidth - radius * radius;
    this.rx = Math.sqrt(radius * radius + difference * axle.x * axle.x);
    this.ry = Math.sqrt(radius * radius + difference * axle.y * axle.y);
    this.rz = Math.sqrt(radius * radius + difference * axle.z * axle.z);
    out.distance = Math.min(maximum, priorLength);
    out.triangle = -1;
    this.trianglesTested = this.featureTests = 0;
    let size = 1;
    this.stack[0] = 0;
    while (size) {
      const node = this.bvh.nodes[this.stack[--size]];
      if (!this.intersects(node, out.distance)) continue;
      if (node.left >= 0) {
        if (size + 2 > this.stack.length) throw new Error('Tire-footprint stack overflow');
        this.stack[size++] = node.left;
        this.stack[size++] = node.right;
      } else {
        for (let i = node.start; i < node.end; i++) this.triangle(this.bvh.orderedTriangle(i), out);
      }
    }
    return out.triangle !== -1;
  }

  /** Ray against a BVH box expanded by the ellipsoid's exact world-axis
   * extents. Tightening the far bound after each hit prunes hidden features. */
  private intersects(node: TriangleBVH['nodes'][number], maximum: number): boolean {
    let near = this.minimum,
      far = maximum;
    for (let axis = 0; axis < 3; axis++) {
      const origin = axis === 0 ? this.origin.x : axis === 1 ? this.origin.y : this.origin.z,
        direction =
          axis === 0 ? this.direction.x : axis === 1 ? this.direction.y : this.direction.z,
        extent = axis === 0 ? this.rx : axis === 1 ? this.ry : this.rz,
        low = node.min[axis] - extent,
        high = node.max[axis] + extent;
      if (Math.abs(direction) < 1e-12) {
        if (origin < low - 1e-9 || origin > high + 1e-9) return false;
      } else {
        const a = (low - origin) / direction,
          b = (high - origin) / direction;
        near = Math.max(near, Math.min(a, b));
        far = Math.min(far, Math.max(a, b));
        if (near > far + 1e-9) return false;
      }
    }
    return true;
  }

  private triangle(triangle: number, hit: RayHit) {
    this.trianglesTested++;
    const geometry = this.bvh.vertices,
      indices = this.bvh.indices,
      v = this.vertices,
      axis = this.axle;
    const first = indices[triangle * 3] * 3,
      second = indices[triangle * 3 + 1] * 3,
      third = indices[triangle * 3 + 2] * 3,
      abx = geometry[second] - geometry[first],
      aby = geometry[second + 1] - geometry[first + 1],
      abz = geometry[second + 2] - geometry[first + 2],
      acx = geometry[third] - geometry[first],
      acy = geometry[third + 1] - geometry[first + 1],
      acz = geometry[third + 2] - geometry[first + 2],
      normalX = aby * acz - abz * acy,
      normalY = abz * acx - abx * acz,
      normalZ = abx * acy - aby * acx,
      normalSquared = normalX * normalX + normalY * normalY + normalZ * normalZ,
      dotDirection =
        normalX * this.direction.x + normalY * this.direction.y + normalZ * this.direction.z;
    // Reject near-vertical source faces, including their internal seams. They
    // are side collisions, not suspension support. A squared comparison also
    // avoids normalizing every broad-phase candidate.
    if (normalSquared < 1e-24 || dotDirection * dotDirection < 0.0225 * normalSquared) return;
    const sign = dotDirection > 0 ? -1 : 1,
      height =
        sign *
        (normalX * (this.origin.x - geometry[first]) +
          normalY * (this.origin.y - geometry[first + 1]) +
          normalZ * (this.origin.z - geometry[first + 2])),
      alongAxle = normalX * axis.x + normalY * axis.y + normalZ * axis.z,
      support =
        this.radius *
        Math.sqrt(normalSquared + (this.inverse * this.inverse - 1) * alongAxle * alongAxle),
      bound = (support - height) / (sign * dotDirection);
    // An infinite plane is reached before any point in its triangle. Most
    // ordinary road faces lose to the retained centre ray at this cheap bound,
    // before any vertex transforms or quadratic feature solves are needed.
    if (height >= 0 && bound >= hit.distance - 1e-10) return;
    for (let corner = 0; corner < 3; corner++) {
      const at = indices[triangle * 3 + corner] * 3,
        x = geometry[at] - this.origin.x,
        y = geometry[at + 1] - this.origin.y,
        z = geometry[at + 2] - this.origin.z,
        scale = (this.scale - 1) * (x * axis.x + y * axis.y + z * axis.z);
      v[corner * 3] = x + scale * axis.x;
      v[corner * 3 + 1] = y + scale * axis.y;
      v[corner * 3 + 2] = z + scale * axis.z;
    }
    const ex = v[3] - v[0],
      ey = v[4] - v[1],
      ez = v[5] - v[2],
      fx = v[6] - v[0],
      fy = v[7] - v[1],
      fz = v[8] - v[2];
    let nx = ey * fz - ez * fy,
      ny = ez * fx - ex * fz,
      nz = ex * fy - ey * fx;
    const magnitude = Math.hypot(nx, ny, nz);
    if (magnitude > 1e-12) {
      nx /= magnitude;
      ny /= magnitude;
      nz /= magnitude;
      const normalScale = (this.scale - 1) * (nx * axis.x + ny * axis.y + nz * axis.z),
        wx = nx + normalScale * axis.x,
        wy = ny + normalScale * axis.y,
        wz = nz + normalScale * axis.z,
        incident =
          (wx * this.direction.x + wy * this.direction.y + wz * this.direction.z) /
          Math.hypot(wx, wy, wz);
      // A nearly vertical road triangle supplies no suspension support. Its
      // internal tessellation edges must not become artificial horizontal
      // ledges when the tire already intersects the side of the face.
      if (Math.abs(incident) < 0.15) return;
      let denominator = nx * this.dx + ny * this.dy + nz * this.dz;
      if (denominator > 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
        denominator = -denominator;
      }
      if (denominator < -1e-12) {
        const height = -(nx * v[0] + ny * v[1] + nz * v[2]),
          distance = (this.radius - height) / denominator;
        // No point on a triangle can be reached before its supporting plane.
        // On smooth/planar road the centre ray usually wins here, avoiding
        // all edge quadratics and contact-point transforms for this face.
        if (height >= 0 && distance >= hit.distance - 1e-10) return;
        if (distance >= this.minimum && distance < hit.distance) {
          this.featureTests++;
          const x = this.dx * distance - nx * this.radius,
            y = this.dy * distance - ny * this.radius,
            z = this.dz * distance - nz * this.radius,
            ax = x - v[0],
            ay = y - v[1],
            az = z - v[2],
            ee = ex * ex + ey * ey + ez * ez,
            ff = fx * fx + fy * fy + fz * fz,
            ef = ex * fx + ey * fy + ez * fz,
            ae = ax * ex + ay * ey + az * ez,
            af = ax * fx + ay * fy + az * fz,
            determinant = ee * ff - ef * ef,
            u = (ae * ff - af * ef) / determinant,
            w = (af * ee - ae * ef) / determinant;
          if (u >= -1e-9 && w >= -1e-9 && u + w <= 1 + 1e-9) {
            this.accept(triangle, distance, x, y, z, nx, ny, nz, hit);
            if (hit.triangle === triangle && hit.distance === distance) return;
          }
        }
      }
    }
    for (let a = 0; a < 3; a++) {
      this.edge(triangle, a * 3, ((a + 1) % 3) * 3, hit);
      this.vertex(triangle, a * 3, hit);
    }
  }

  private edge(triangle: number, a: number, b: number, hit: RayHit) {
    this.featureTests++;
    const v = this.vertices,
      ex = v[b] - v[a],
      ey = v[b + 1] - v[a + 1],
      ez = v[b + 2] - v[a + 2],
      ee = ex * ex + ey * ey + ez * ez;
    if (ee < 1e-18) return;
    const de = (this.dx * ex + this.dy * ey + this.dz * ez) / ee,
      ae = (v[a] * ex + v[a + 1] * ey + v[a + 2] * ez) / ee,
      dx = this.dx - de * ex,
      dy = this.dy - de * ey,
      dz = this.dz - de * ez,
      x = -v[a] + ae * ex,
      y = -v[a + 1] + ae * ey,
      z = -v[a + 2] + ae * ez,
      aa = dx * dx + dy * dy + dz * dz,
      bb = x * dx + y * dy + z * dz,
      cc = x * x + y * y + z * z - this.radius * this.radius;
    if (aa < 1e-18) return;
    const discriminant = bb * bb - aa * cc;
    if (discriminant < 0) return;
    const distance = (-bb - Math.sqrt(discriminant)) / aa;
    if (distance < this.minimum || distance >= hit.distance) return;
    const u = de * distance - ae;
    if (u < 0 || u > 1) return;
    const px = v[a] + ex * u,
      py = v[a + 1] + ey * u,
      pz = v[a + 2] + ez * u;
    this.accept(
      triangle,
      distance,
      px,
      py,
      pz,
      (this.dx * distance - px) / this.radius,
      (this.dy * distance - py) / this.radius,
      (this.dz * distance - pz) / this.radius,
      hit,
    );
  }

  private vertex(triangle: number, at: number, hit: RayHit) {
    this.featureTests++;
    const v = this.vertices,
      x = v[at],
      y = v[at + 1],
      z = v[at + 2],
      aa = this.dx * this.dx + this.dy * this.dy + this.dz * this.dz,
      bb = -(x * this.dx + y * this.dy + z * this.dz),
      cc = x * x + y * y + z * z - this.radius * this.radius,
      discriminant = bb * bb - aa * cc;
    if (discriminant < 0) return;
    const distance = (-bb - Math.sqrt(discriminant)) / aa;
    if (distance < this.minimum || distance >= hit.distance) return;
    this.accept(
      triangle,
      distance,
      x,
      y,
      z,
      (this.dx * distance - x) / this.radius,
      (this.dy * distance - y) / this.radius,
      (this.dz * distance - z) / this.radius,
      hit,
    );
  }

  private accept(
    triangle: number,
    distance: number,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    hit: RayHit,
  ) {
    const a = this.axle,
      unscale = (this.inverse - 1) * (x * a.x + y * a.y + z * a.z);
    x += unscale * a.x;
    y += unscale * a.y;
    z += unscale * a.z;
    const pointDistance = x * this.direction.x + y * this.direction.y + z * this.direction.z;
    // Keep the old station-to-road reach contract, including layered roads:
    // never turn geometry above the station or beyond its cast into support.
    if (pointDistance < -1e-9 || pointDistance > this.maximum + 1e-9) return;
    const normalScale = (this.scale - 1) * (nx * a.x + ny * a.y + nz * a.z);
    nx += normalScale * a.x;
    ny += normalScale * a.y;
    nz += normalScale * a.z;
    const magnitude = Math.hypot(nx, ny, nz);
    if (magnitude < 1e-12) return;
    nx /= magnitude;
    ny /= magnitude;
    nz /= magnitude;
    // Near-vertical features belong to chassis/side collision, not an
    // unbounded tire support division at the suspension's cosine limit.
    if (nx * this.direction.x + ny * this.direction.y + nz * this.direction.z > -0.15) return;
    hit.distance = distance;
    hit.triangle = triangle;
    hit.point.set(this.origin.x + x, this.origin.y + y, this.origin.z + z);
    hit.normal.set(nx, ny, nz);
  }
}
