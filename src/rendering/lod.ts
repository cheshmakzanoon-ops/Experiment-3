import { sculptedLoft } from './bodywork.ts';
import { NOSE_SECTIONS, POD_SECTIONS, ENGINE_SECTIONS } from './car-surfaces.ts';
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
  readonly tires: T.Mesh[] = [];
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
    // Share the hero envelopes. Lower tessellation must not restore the old
    // swollen sidepod or broad nose when an opponent crosses its LOD threshold.
    const detail = level === 1 ? 'mid' : 'far';
    mesh(body, sculptedLoft(NOSE_SECTIONS, 0, 0.32, [], detail), paint);
    mesh(body, sculptedLoft(ENGINE_SECTIONS, 0, 0.18, [], detail), paint);
    mesh(
      body,
      loft(
        [
          [-0.72, 0.03, 0.285, 0.18],
          [-0.05, 0.04, 0.29, 0.15],
          [0.4, 0.025, 0.3, 0.17],
        ],
        sides,
      ),
      paint,
    );
    for (const side of [-1, 1]) {
      const pod = mesh(
        body,
        sculptedLoft(POD_SECTIONS, 0.58, 0.65, [], detail),
        paint,
        side * 0.53,
      );
      pod.rotation.z = side * -0.08;
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
      this.tires.push(tire);
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
      spin.remove(tire);
      mergeStatic(spin);
      spin.add(tire);
    }
    mergeStatic(body);
    mergeStatic(this.front);
    mergeStatic(this.rear);
  }
}
