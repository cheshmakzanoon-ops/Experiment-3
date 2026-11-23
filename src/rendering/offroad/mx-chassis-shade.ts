import * as T from 'three';
import { clamp } from '../../core/math.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { markItems } from '../attribute-ranges.ts';
import type { StartGate } from './start-gate.ts';

const ROWS = 5,
  COLS = 3,
  VERTICES = ROWS * COLS;
const INDICES = (ROWS - 1) * (COLS - 1) * 6,
  CAPACITY = 64;

/** Diffuse ground occlusion beneath the motor and rider. All bikes share one
 * mesh. Each footprint follows the actual rendered rut or steel grid under it. */
export class MxChassisShade {
  private readonly positions = new T.Float32BufferAttribute(CAPACITY * VERTICES * 3, 3).setUsage(
    T.DynamicDrawUsage,
  );
  private readonly colours = new T.Uint8BufferAttribute(
    new Uint8Array(CAPACITY * VERTICES * 4).fill(255),
    4,
    true,
  ).setUsage(T.DynamicDrawUsage);
  private readonly point = trackPoint();
  private readonly cornerPoint = trackPoint();
  private readonly keel = new T.Vector3();
  private readonly heading = new T.Vector3();
  private count = 0;
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;

  constructor(map: T.Texture) {
    const geometry = new T.BufferGeometry();
    const uv = new Float32Array(CAPACITY * VERTICES * 2),
      index = new Uint16Array(CAPACITY * INDICES);
    let cursor = 0;
    for (let bike = 0; bike < CAPACITY; bike++) {
      for (let row = 0; row < ROWS; row++)
        for (let col = 0; col < COLS; col++) {
          const vertex = bike * VERTICES + row * COLS + col;
          uv[vertex * 2] = col / (COLS - 1);
          uv[vertex * 2 + 1] = row / (ROWS - 1);
          if (row + 1 < ROWS && col + 1 < COLS) {
            index.set(
              [vertex, vertex + COLS, vertex + 1, vertex + 1, vertex + COLS, vertex + COLS + 1],
              cursor,
            );
            cursor += 6;
          }
        }
    }
    geometry.setIndex(new T.BufferAttribute(index, 1));
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('color', this.colours);
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    this.mesh = new T.Mesh(
      geometry,
      new T.MeshBasicMaterial({
        map,
        color: 0x19150e,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        toneMapped: false,
      }),
    );
    this.mesh.name = 'MX under-engine ground shade';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.end();
  }

  begin() {
    this.count = 0;
  }

  add(
    x: number,
    y: number,
    z: number,
    orientation: T.Quaternion,
    wheelbase: number,
    track: Track,
    height: (s: number, lateral: number) => number,
    pad: Pick<StartGate, 'padHeightAt'> | null,
  ) {
    if (this.count >= CAPACITY) return;
    const keel = this.keel.set(0, -0.39, -0.04).applyQuaternion(orientation);
    const cx = x + keel.x,
      cz = z + keel.z,
      p = this.point;
    const lateral = track.nearest(cx, cz, p);
    const road = Math.max(height(p.s, lateral), pad?.padHeightAt(cx, cz) ?? -Infinity);
    const gap = Math.max(0, y + keel.y - road);
    const fade = clamp(1 - gap / 1.55, 0, 1);
    const alpha = Math.round(255 * 0.42 * fade * fade * (3 - 2 * fade));
    if (!alpha) return;
    const forward = this.heading.set(0, 0, 1).applyQuaternion(orientation);
    const length = Math.hypot(forward.x, forward.z);
    const fx = length > 0.1 ? forward.x / length : p.tx,
      fz = length > 0.1 ? forward.z / length : p.tz;
    const halfWidth = 0.49 + gap * 0.27,
      halfLength = wheelbase * 0.58 + gap * 0.21;
    for (let row = 0; row < ROWS; row++)
      for (let col = 0; col < COLS; col++) {
        const across = ((2 * col) / (COLS - 1) - 1) * halfWidth;
        const along = ((2 * row) / (ROWS - 1) - 1) * halfLength;
        const dx = fx * along + fz * across,
          dz = fz * along - fx * across;
        const wx = cx + dx,
          wz = cz + dz;
        // The graph can change tangent between two adjacent stations, even at
        // the mouth of a straight. Sample the displayed bank under each vertex.
        const offset = track.nearest(wx, wz, this.cornerPoint);
        const h = Math.max(height(this.cornerPoint.s, offset), pad?.padHeightAt(wx, wz) ?? -Infinity);
        const vertex = this.count * VERTICES + row * COLS + col;
        this.positions.setXYZ(vertex, wx, h + 0.014, wz);
        this.colours.array[vertex * 4 + 3] = alpha;
      }
    this.count++;
  }

  end() {
    this.mesh.geometry.setDrawRange(0, this.count * INDICES);
    this.mesh.visible = this.count > 0;
    markItems(this.positions, 0, this.count * VERTICES - 1);
    markItems(this.colours, 0, this.count * VERTICES - 1);
  }
}
