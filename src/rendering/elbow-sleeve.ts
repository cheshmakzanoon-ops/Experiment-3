import * as T from 'three';

/** A short cloth bridge follows the two actual IK bones instead of exposing a
 * spherical elbow bead. It overlaps both sleeve ends; it never moves a joint.
 * Topology, UVs and all working vectors are allocated once, not per frame. */
export class ElbowSleeve extends T.BufferGeometry {
  private static readonly ROWS = 8;
  private static readonly SIDES = 16;
  private previous = new Float64Array(9).fill(NaN);
  private incoming = new T.Vector3();
  private outgoing = new T.Vector3();
  private normal = new T.Vector3();
  private tangent = new T.Vector3();
  private radial = new T.Vector3();
  private along = new T.Vector3();
  private around = new T.Vector3();
  private cross = new T.Vector3();
  constructor() {
    super();
    this.name = 'IK-driven tailored elbow bridge';
    const rows = ElbowSleeve.ROWS,
      sides = ElbowSleeve.SIDES;
    const count = (rows + 1) * (sides + 1);
    this.setAttribute(
      'position',
      new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage),
    );
    this.setAttribute(
      'normal',
      new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage),
    );
    const uv = new Float32Array(count * 2),
      indices: number[] = [];
    for (let row = 0; row <= rows; row++)
      for (let side = 0; side <= sides; side++) {
        const k = row * (sides + 1) + side;
        uv[k * 2] = side / sides;
        uv[k * 2 + 1] = row / rows;
        if (row < rows && side < sides)
          indices.push(k, k + 1, k + sides + 1, k + 1, k + sides + 2, k + sides + 1);
      }
    this.setAttribute('uv', new T.BufferAttribute(uv, 2));
    this.setIndex(indices);
    // The sleeves already cap both overlapping ends. The bridge itself is an
    // intentionally open cuff, not a hidden double cap or an extra joint sphere.
    this.boundingBox = new T.Box3(
      new T.Vector3(-0.12, -0.12, -0.12),
      new T.Vector3(0.12, 0.12, 0.12),
    );
    this.boundingSphere = new T.Sphere(new T.Vector3(), 0.12);
  }
  pose(shoulder: T.Vector3, elbow: T.Vector3, wrist: T.Vector3) {
    const prev = this.previous;
    if (
      prev[0] === shoulder.x &&
      prev[1] === shoulder.y &&
      prev[2] === shoulder.z &&
      prev[3] === elbow.x &&
      prev[4] === elbow.y &&
      prev[5] === elbow.z &&
      prev[6] === wrist.x &&
      prev[7] === wrist.y &&
      prev[8] === wrist.z
    )
      return;
    this.incoming.copy(elbow).sub(shoulder);
    this.outgoing.copy(wrist).sub(elbow);
    if (
      !Number.isFinite(this.incoming.lengthSq() + this.outgoing.lengthSq()) ||
      this.incoming.lengthSq() < 1e-12 ||
      this.outgoing.lengthSq() < 1e-12
    )
      throw new Error('Invalid sleeve joints');
    this.incoming.normalize();
    this.outgoing.normalize();
    this.normal.crossVectors(this.incoming, this.outgoing);
    if (this.normal.lengthSq() < 1e-8) {
      this.normal.set(
        Math.abs(this.incoming.x) < 0.9 ? 1 : 0,
        Math.abs(this.incoming.x) < 0.9 ? 0 : 1,
        0,
      );
      this.normal.addScaledVector(this.incoming, -this.normal.dot(this.incoming));
    }
    this.normal.normalize();
    const p = this.getAttribute('position'),
      n = this.getAttribute('normal');
    const rows = ElbowSleeve.ROWS,
      sides = ElbowSleeve.SIDES;
    const bend = Math.max(0, 1 - this.incoming.dot(this.outgoing));
    for (let row = 0; row <= rows; row++) {
      const u = row / rows,
        v = 1 - u;
      // Quadratic centreline stays within 42 mm of the unchanged elbow anchor.
      const cx = -0.042 * v * v * this.incoming.x + 0.042 * u * u * this.outgoing.x;
      const cy = -0.042 * v * v * this.incoming.y + 0.042 * u * u * this.outgoing.y;
      const cz = -0.042 * v * v * this.incoming.z + 0.042 * u * u * this.outgoing.z;
      this.tangent.copy(this.incoming).multiplyScalar(v).addScaledVector(this.outgoing, u);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.copy(this.incoming);
      this.tangent.normalize();
      this.radial.crossVectors(this.tangent, this.normal).normalize();
      for (let side = 0; side <= sides; side++) {
        const a = ((side % sides) / sides) * Math.PI * 2;
        const fold =
          1 + 0.045 * bend * Math.sin(Math.PI * u) ** 2 * Math.cos(4 * Math.PI * u + 2 * a);
        const rx = (0.0455 * v + 0.0435 * u) * fold,
          rz = (0.0405 * v + 0.0395 * u) * fold;
        p.setXYZ(
          row * (sides + 1) + side,
          cx + this.normal.x * Math.cos(a) * rx + this.radial.x * Math.sin(a) * rz,
          cy + this.normal.y * Math.cos(a) * rx + this.radial.y * Math.sin(a) * rz,
          cz + this.normal.z * Math.cos(a) * rx + this.radial.z * Math.sin(a) * rz,
        );
      }
    }
    // Finite surface derivatives include bend and fold gradients. Duplicated UV
    // seam vertices get exactly the same normal; no sharp highlight down a cuff.
    for (let row = 0; row <= rows; row++)
      for (let side = 0; side < sides; side++) {
        const a = Math.max(0, row - 1) * (sides + 1) + side;
        const b = Math.min(rows, row + 1) * (sides + 1) + side;
        const c = row * (sides + 1) + ((side + sides - 1) % sides);
        const d = row * (sides + 1) + ((side + 1) % sides);
        this.along.set(p.getX(b) - p.getX(a), p.getY(b) - p.getY(a), p.getZ(b) - p.getZ(a));
        this.around.set(p.getX(d) - p.getX(c), p.getY(d) - p.getY(c), p.getZ(d) - p.getZ(c));
        this.cross.crossVectors(this.around, this.along).normalize();
        const k = row * (sides + 1) + side;
        n.setXYZ(k, this.cross.x, this.cross.y, this.cross.z);
        if (side === 0) n.setXYZ(k + sides, this.cross.x, this.cross.y, this.cross.z);
      }
    prev[0] = shoulder.x;
    prev[1] = shoulder.y;
    prev[2] = shoulder.z;
    prev[3] = elbow.x;
    prev[4] = elbow.y;
    prev[5] = elbow.z;
    prev[6] = wrist.x;
    prev[7] = wrist.y;
    prev[8] = wrist.z;
    p.needsUpdate = n.needsUpdate = true;
  }
}
