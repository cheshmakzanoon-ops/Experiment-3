import * as T from 'three';
import { HAND_ANCHOR } from './wheel-grip.ts';

export const PADDLE_PULL = 0.12;
/** Thin manufactured paddle, with radiused edges and an enlarged finger shelf.
 * Both surfaces share a symmetric blank; their independent pivots are retained. */
export function shiftPaddleGeometry() {
  const s = new T.Shape();
  s.moveTo(-0.051, -0.035);
  s.quadraticCurveTo(-0.059, -0.034, -0.061, -0.022);
  s.lineTo(-0.061, 0.026);
  s.quadraticCurveTo(-0.06, 0.041, -0.047, 0.042);
  s.lineTo(0.047, 0.042);
  s.quadraticCurveTo(0.06, 0.041, 0.061, 0.026);
  s.lineTo(0.061, -0.022);
  s.quadraticCurveTo(0.059, -0.034, 0.051, -0.035);
  s.lineTo(0.019, -0.029);
  s.quadraticCurveTo(0, -0.023, -0.019, -0.029);
  s.closePath();
  const g = new T.ExtrudeGeometry(s, {
    depth: 0.004,
    bevelEnabled: true,
    bevelThickness: 0.0007,
    bevelSize: 0.0008,
    bevelSegments: 3,
    curveSegments: 8,
    steps: 1,
  });
  g.scale(1.25, 1, 1);
  // The face meets the distal index pad with a 0.2 mm clearance.
  // Pivot location remains the physical switch hinge; only the authored blank
  // has its original five-millimetre stand-off behind that hinge.
  g.translate(0, 0, -0.007);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = 'Radiused shift paddle and distal finger shelf';
  return g;
}

/** Distal finger deformation is driven by the very same paddle rotation. The
 * proximal finger and the other three grip fingers never detach from the wheel.
 * No per-frame geometry allocation, no history integration on replay seeks. */
export class ShiftFinger {
  private readonly rest: Float32Array;
  private readonly weights: Float32Array;
  private previous = -1;
  private average = new T.Vector3();
  private contact = new T.Vector3();
  private delta = new T.Vector3();
  readonly contactVertex: number;
  constructor(
    readonly geometry: T.BufferGeometry,
    readonly side: number,
  ) {
    if (side !== -1 && side !== 1) throw new Error('Invalid shift-finger handedness');
    const p = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv');
    this.rest = new Float32Array(p.array);
    this.weights = new Float32Array(p.count);
    // TubeGeometry has 21 rows of 17 vertices followed by two separately capped
    // ends. Track the proximal station explicitly, not a guessed world axis.
    let contact = 0,
      front = -Infinity;
    for (let i = 0; i < p.count; i++) {
      const u = i < 21 * 17 ? uv.getX(i) : i < 21 * 17 + 18 ? 0 : 1;
      this.weights[i] = T.MathUtils.smoothstep(u, 0.32, 0.82);
      if (u > 0.8 && p.getZ(i) > front) {
        front = p.getZ(i);
        contact = i;
      }
    }
    this.contactVertex = contact;
    if (!(p instanceof T.BufferAttribute))
      throw new Error('Unexpected interleaved finger geometry');
    p.setUsage(T.DynamicDrawUsage);
    geometry.computeBoundingBox();
    geometry.boundingBox!.expandByScalar(0.014);
    geometry.computeBoundingSphere();
    geometry.boundingSphere!.radius += 0.014;
  }
  pose(pull: number) {
    if (!Number.isFinite(pull) || pull < 0 || pull > 1) throw new Error('Invalid paddle pull');
    if (pull === this.previous) return;
    this.previous = pull;
    const p = this.geometry.getAttribute('position');
    this.contact.fromArray(this.rest, this.contactVertex * 3);
    const x = this.contact.x + this.side * HAND_ANCHOR.x - this.side * 0.104;
    const z = this.contact.z + HAND_ANCHOR.z - 0.041;
    const angle = this.side * pull * PADDLE_PULL,
      c = Math.cos(angle),
      s = Math.sin(angle);
    this.delta.set(x * c + z * s - x, 0, -x * s + z * c - z);
    for (let i = 0; i < p.count; i++)
      p.setXYZ(
        i,
        this.rest[i * 3] + this.delta.x * this.weights[i],
        this.rest[i * 3 + 1],
        this.rest[i * 3 + 2] + this.delta.z * this.weights[i],
      );
    p.needsUpdate = true;
    this.geometry.computeVertexNormals();
    // Weld the UV seam's geometric normals without losing texture coordinates.
    const n = this.geometry.getAttribute('normal'),
      average = this.average;
    for (let row = 0; row <= 20; row++) {
      const a = row * 17,
        b = a + 16;
      average.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, average.x, average.y, average.z);
      n.setXYZ(b, average.x, average.y, average.z);
    }
  }
}
