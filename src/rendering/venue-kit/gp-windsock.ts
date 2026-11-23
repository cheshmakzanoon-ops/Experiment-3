import * as T from 'three';
import { mergeStatic, rod } from '../geometry.ts';
import { tagWeatherSurface } from '../weather-presentation.ts';

const DOWN = new T.Vector3(0, -1, 0),
  SIDES = 14,
  BANDS = 5,
  PANELS = 3;
const HEM = 0.25,
  LENGTH = 1.86,
  BRIDLE = 0.42;
const rings = BANDS * (PANELS + 1);
const circumference = Array.from({ length: SIDES }, (_, i) => {
  const a = (2 * Math.PI * i) / SIDES;
  return [Math.cos(a), Math.sin(a)] as const;
});

/** An open textile wind cone with a stiff mouth, five sewn bands and three
 * suspension lines to a common eye. Its centreline droops in still air and
 * straightens downwind. Presenting the same recorded wind and time reuses
 * the buffer for the main lens, reflections and shadow cameras. */
export class GpWindSleeve {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  private readonly pos: T.BufferAttribute;
  private readonly norm: T.BufferAttribute;
  private readonly last = new T.Vector4(NaN, NaN, NaN, NaN);
  private readonly head = new T.Vector3();
  private readonly end = new T.Vector3();
  private readonly tangent = new T.Vector3();
  private readonly centre = new T.Vector3();
  private readonly across = new T.Vector3();
  private readonly right = new T.Vector3();
  private readonly back = new T.Vector3();
  private readonly point = new T.Vector3();
  private readonly normal = new T.Vector3();
  private readonly frame = new T.Quaternion();

  constructor() {
    const vertices = rings * SIDES + 3 * 6,
      geom = new T.BufferGeometry(),
      colour = new Float32Array(vertices * 3);
    this.pos = new T.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      T.DynamicDrawUsage,
    );
    this.norm = new T.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      T.DynamicDrawUsage,
    );
    const index: number[] = [],
      orange = new T.Color(0xc74e24),
      pale = new T.Color(0xe4decb);
    for (let band = 0; band < BANDS; band++) {
      for (let row = 0; row <= PANELS; row++) {
        const start = (band * (PANELS + 1) + row) * SIDES;
        for (let j = 0; j < SIDES; j++) {
          (band % 2 ? pale : orange).toArray(colour, 3 * (start + j));
          if (row === PANELS) continue;
          const k = (j + 1) % SIDES;
          index.push(
            start + j,
            start + k,
            start + j + SIDES,
            start + k,
            start + k + SIDES,
            start + j + SIDES,
          );
        }
      }
    }
    const thread = new T.Color(0xbab3a0);
    for (let line = 0; line < 3; line++) {
      const first = rings * SIDES + line * 6;
      for (let j = 0; j < 6; j++) thread.toArray(colour, (first + j) * 3);
      for (let j = 0; j < 3; j++) {
        const k = (j + 1) % 3;
        index.push(first + j, first + k, first + j + 3, first + k, first + k + 3, first + j + 3);
      }
    }
    geom.setAttribute('position', this.pos);
    geom.setAttribute('normal', this.norm);
    geom.setAttribute('color', new T.BufferAttribute(colour, 3));
    geom.setIndex(index);
    // Bound every attitude, including the fully drooped outlet.
    geom.boundingSphere = new T.Sphere(new T.Vector3(), BRIDLE + LENGTH + HEM + 0.09);
    const mat = tagWeatherSurface(
      new T.MeshStandardMaterial({
        name: 'GP woven weather indicator',
        vertexColors: true,
        roughness: 0.86,
        side: T.DoubleSide,
      }),
      'fabric',
      1,
    );
    this.mesh = new T.Mesh(geom, mat);
    this.mesh.name = 'GP sector wind sleeve';
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.present(0, 0, 0, 0);
  }
  /** Upload the presented pose before Three collects geometry for any pass. */
  presentWorld(wind: T.Vector4) {
    this.mesh.updateWorldMatrix(true,false);
    const e = this.mesh.matrixWorld.elements;
    this.present(wind.x*e[0]+wind.y*e[2], wind.x*e[8]+wind.y*e[10], wind.z,wind.w);
  }
  present(x: number, z: number, time: number, gust: number) {
    if (!Number.isFinite(x + z + time + gust)) x = z = time = gust = 0;
    const last = this.last;
    if (last.x === x && last.y === z && last.z === time && last.w === gust) return;
    last.set(x, z, time, gust);
    const speed = Math.hypot(x, z),
      lift = speed / Math.hypot(speed, 4.6);
    this.head.set(x, -1.1, z).normalize();
    this.end.set(x, -4.8, z).normalize();
    this.across.set(z, 0, -x).multiplyScalar(1 / Math.hypot(speed, 2));
    const phase = (2.8 + 0.18 * Math.min(20, speed)) * time;
    const amp = (0.015 + 0.055 * T.MathUtils.clamp(gust, 0, 1)) * lift;
    for (let row = 0; row < rings; row++) {
      const band = Math.floor(row / (PANELS + 1)),
        sub = row % (PANELS + 1);
      const u = (band + sub / PANELS) / BANDS,
        bow = u * u * 0.5;
      this.centre
        .copy(this.head)
        .multiplyScalar(BRIDLE + LENGTH * (u - bow))
        .addScaledVector(this.end, LENGTH * bow);
      const wave = Math.sin(7 * u - phase) + 0.32 * Math.sin(12 * u - 1.37 * phase);
      this.centre.addScaledVector(this.across, amp * u * wave);
      this.tangent
        .copy(this.head)
        .lerp(this.end, u)
        .addScaledVector(
          this.across,
          (amp / LENGTH) *
            (wave + u * (7 * Math.cos(7 * u - phase) + 3.84 * Math.cos(12 * u - 1.37 * phase))),
        )
        .normalize();
      this.frame.setFromUnitVectors(DOWN, this.tangent);
      this.right.set(1, 0, 0).applyQuaternion(this.frame);
      this.back.set(0, 0, 1).applyQuaternion(this.frame);
      const radius = HEM * (1 - 0.64 * u),
        flat = 1 - 0.77 * (1 - lift) * T.MathUtils.smoothstep(u, 0, 0.36);
      for (let j = 0; j < SIDES; j++) {
        const [cs, sn] = circumference[j],
          a = row * SIDES + j;
        const pleat = 1 + (1 - lift) * 0.14 * u * Math.cos((j * 6 * Math.PI) / SIDES + 0.8 * u);
        this.point
          .copy(this.centre)
          .addScaledVector(this.right, radius * pleat * cs)
          .addScaledVector(this.back, radius * pleat * flat * sn);
        this.normal
          .copy(this.right)
          .multiplyScalar(cs * flat)
          .addScaledVector(this.back, sn)
          .addScaledVector(this.tangent, ((HEM * 0.64) / LENGTH) * flat)
          .normalize();
        this.pos.setXYZ(a, this.point.x, this.point.y, this.point.z);
        this.norm.setXYZ(a, this.normal.x, this.normal.y, this.normal.z);
      }
    }
    for (let line = 0; line < 3; line++) {
      const anchor = Math.round((line * SIDES) / 3);
      this.end.fromBufferAttribute(this.pos, anchor);
      this.frame.setFromUnitVectors(DOWN, this.tangent.copy(this.end).normalize());
      for (let j = 0; j < 3; j++) {
        const a = (j * Math.PI * 2) / 3,
          vertex = rings * SIDES + line * 6 + j;
        this.normal.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(this.frame);
        this.point.copy(this.normal).multiplyScalar(0.0035);
        this.pos.setXYZ(vertex, this.point.x, this.point.y, this.point.z);
        this.point.add(this.end);
        this.pos.setXYZ(vertex + 3, this.point.x, this.point.y, this.point.z);
        this.norm.setXYZ(vertex, this.normal.x, this.normal.y, this.normal.z);
        this.norm.setXYZ(vertex + 3, this.normal.x, this.normal.y, this.normal.z);
      }
    }
    this.pos.needsUpdate = this.norm.needsUpdate = true;
  }
}

export function gpWindMast(steel: T.Material) {
  const group = new T.Group(),
    metal = new T.Group();
  group.name = 'GP sector weather mast';
  group.add(metal);
  const base = new T.Vector3(0, -0.18, 0),
    mast = new T.Vector3(0, 4.35, 0),
    eye = new T.Vector3(0.94, 4.95, 0);
  rod(metal, steel, base, mast, 0.062);
  rod(metal, steel, mast, eye, 0.029);
  rod(metal, steel, new T.Vector3(0, 3.9, 0), new T.Vector3(0.75, 4.82, 0), 0.016);
  mergeStatic(metal);
  const sock = new GpWindSleeve();
  sock.mesh.position.copy(eye);
  group.add(sock.mesh);
  return {root: group, sleeve: sock};
}
