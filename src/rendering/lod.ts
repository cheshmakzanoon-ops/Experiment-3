import { floorGeometry, wheelCoverGeometry } from './car-floor.ts';
import { sculptedLoft, wingElement, aeroPlate } from './bodywork.ts';
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
    mesh(body, floorGeometry(level === 1 ? 'mid' : 'far'), carbon);
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
      mesh(
        this.front,
        aeroPlate(
          [
            [2.04, -0.36],
            [2.64, -0.36],
            [2.68, -0.22],
            [2.51, -0.18],
            [2.11, -0.21],
            [2.02, -0.29],
          ],
          0.018,
        ),
        paint,
        side * 0.973,
      );
      mesh(
        this.rear,
        aeroPlate(
          [
            [-2.34, 0.2],
            [-1.94, 0.18],
            [-1.75, 0.39],
            [-1.77, 0.63],
            [-1.98, 0.72],
            [-2.31, 0.72],
          ],
          0.024,
        ),
        paint,
        side * 0.839,
      );
    }
    for (let i = 0; i < 4; i++)
      mesh(
        this.front,
        wingElement(
          1.94 - i * 0.018,
          i === 0 ? 0.34 : 0.2,
          0.025 + i * 0.007,
          0.015,
          0.08,
          0.028,
          detail,
        ),
        i === 3 ? paint : carbon,
        0,
        -0.325 + i * 0.043,
        2.48 - i * 0.14,
      );
    mesh(
      this.rear,
      wingElement(1.65, 0.42, 0.048, 0.022, 0.025, 0.015, detail),
      carbon,
      0,
      0.49,
      -1.99,
    );
    mesh(
      this.rear,
      wingElement(1.64, 0.22, 0.045, 0.016, 0.02, 0.012, detail),
      paint,
      0,
      0.65,
      -2.18,
    );
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
      const cover = mesh(
        spin,
        wheelCoverGeometry(detail),
        carbon,
        Math.sign(p[0]) * ((i < 2 ? 0.155 : 0.19) + 0.014),
        0,
        0,
      );
      cover.rotation.y = (Math.sign(p[0]) * Math.PI) / 2;
      spin.remove(tire);
      mergeStatic(spin);
      spin.add(tire);
    }
    mergeStatic(body);
    mergeStatic(this.front);
    mergeStatic(this.rear);
  }
}
