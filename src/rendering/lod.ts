import * as T from 'three';
import { loft, mesh, box, mergeStatic, tube } from './geometry.ts';
import { WHEEL_POSITIONS } from '../simulation/vehicle.ts';

export function carLod(
  distance: number,
  previous: number,
  quality: 'low' | 'medium' | 'high',
  player: boolean,
) {
  if (player) return 0;
  const scale = quality === 'high' ? 1.25 : quality === 'low' ? 0.7 : 1;
  const near = 55 * scale,
    far = 130 * scale,
    hysteresis = 8 * scale;
  if (previous === 0 && distance < near + hysteresis) return 0;
  if (previous === 2 && distance > far - hysteresis) return 2;
  if (distance < near - hysteresis) return 0;
  return distance > far + hysteresis ? 2 : 1;
}

/** Separate, lower-complexity meshes preserve the actual Formula silhouette.
 * Wheels remain individually articulated at every LOD, not baked into the body. */
export class ReducedCar {
  readonly root = new T.Group();
  readonly wheels: T.Group[] = [];
  readonly spins: T.Group[] = [];
  readonly front = new T.Group();
  readonly rear = new T.Group();
  constructor(level: 1 | 2, paint: T.Material, carbon: T.Material, rubber: T.Material) {
    const sides = level === 1 ? 12 : 8;
    const body = new T.Group();
    this.root.add(body, this.front, this.rear);
    mesh(
      body,
      loft(
        [
          [-2.1, -0.36, 0.55, 0.025],
          [-1, -0.34, 0.9, 0.035],
          [0.4, -0.34, 0.82, 0.025],
          [1.4, -0.32, 0.22, 0.02],
        ],
        sides,
      ),
      carbon,
    );
    mesh(
      body,
      loft(
        [
          [-1.8, -0.02, 0.12, 0.11],
          [-0.6, 0.12, 0.28, 0.37],
          [0.45, 0.01, 0.3, 0.19],
          [1.8, -0.14, 0.12, 0.07],
          [2.5, -0.24, 0.04, 0.018],
        ],
        sides,
      ),
      paint,
    );
    for (const side of [-1, 1]) {
      mesh(
        body,
        loft(
          [
            [-1.7, -0.13, 0.08, 0.11],
            [-0.85, -0.05, 0.29, 0.23],
            [0.25, -0.01, 0.26, 0.13],
          ],
          sides,
        ),
        paint,
        side * 0.53,
        0,
        0,
      );
      box(this.front, paint, side * 0.96, -0.28, 2.45, 0.035, 0.15, 0.5);
      box(this.rear, paint, side * 0.83, 0.42, -2.04, 0.035, 0.43, 0.51);
    }
    for (let i = 0; i < (level === 1 ? 3 : 1); i++)
      box(this.front, carbon, 0, -0.29 + i * 0.04, 2.4 + i * 0.09, 1.93, 0.028, 0.25);
    box(this.rear, paint, 0, 0.58, -2.02, 1.66, 0.05, 0.38);
    box(this.rear, carbon, 0, 0.02, -1.99, 0.055, 0.95, 0.05);
    if (level === 1) {
      tube(
        body,
        carbon,
        [
          [-0.3, 0.24, -0.5],
          [-0.3, 0.54, 0.2],
          [0, 0.54, 0.65],
          [0.3, 0.54, 0.2],
          [0.3, 0.24, -0.5],
        ],
        0.033,
      );
      box(body, carbon, 0, 0.35, 0.64, 0.055, 0.4, 0.055);
    }
    for (let i = 0; i < 4; i++) {
      const p = WHEEL_POSITIONS[i],
        wheel = new T.Group(),
        spin = new T.Group();
      wheel.position.set(p[0], -0.2, p[2]);
      wheel.add(spin);
      this.root.add(wheel);
      this.wheels.push(wheel);
      this.spins.push(spin);
      const tire = mesh(
        spin,
        new T.CylinderGeometry(0.335, 0.335, i < 2 ? 0.31 : 0.38, sides),
        rubber,
      );
      tire.rotation.z = Math.PI / 2;
      for (const sign of [-1, 1]) {
        const rim = mesh(
          spin,
          new T.CylinderGeometry(0.21, 0.21, 0.012, sides),
          carbon,
          sign * (i < 2 ? 0.162 : 0.197),
          0,
          0,
        );
        rim.rotation.z = Math.PI / 2;
      }
      mergeStatic(spin);
    }
    mergeStatic(body);
    mergeStatic(this.front);
    mergeStatic(this.rear);
  }
}
