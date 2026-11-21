import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BikeMaterials } from './bike.ts';

// Steering-head frame, with Y along the fork axis. Dimensions are in metres.
const FIXED = new T.Vector3(-0.108, 0.028, -0.091);
const YOKE = new T.Vector3(0.065, 0.028, -0.02);
const SEAL = 0.124;
const ROD = 0.106;

function shaft(profile: readonly (readonly [number, number])[]) {
  return new T.LatheGeometry(
    profile.map(([x, r]) => new T.Vector2(r, x)),
    8,
  ).rotateZ(-Math.PI / 2);
}
function eye() {
  return new T.LatheGeometry(
    [
      new T.Vector2(0.004, -0.004),
      new T.Vector2(0.01, -0.004),
      new T.Vector2(0.011, 0.0025),
      new T.Vector2(0.0095, 0.004),
      new T.Vector2(0.004, 0.004),
      new T.Vector2(0.004, -0.004),
    ],
    7,
  );
}
function assembly(parts: T.BufferGeometry[], material: T.Material, name: string) {
  const geo = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  geo.computeBoundingSphere();
  const mesh = new T.Mesh(geo, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/** Measured in the fixed steering-head frame, so suspension compression
 * moves neither eye relative to the top yoke. A rigid steel plunger slides
 * inside a rigid hydraulic barrel; both pivots remain circular at full lock. */
export class GpSteeringDamper {
  readonly root = new T.Group();
  readonly slider: T.Mesh;
  readonly frameMount: T.Mesh;
  readonly yokeMount: T.Mesh;
  private readonly end = new T.Vector3();
  constructor(materials: Pick<BikeMaterials, 'forkUpper' | 'steel'>) {
    const stud = (p: T.Vector3) =>
      new T.CylinderGeometry(0.0042, 0.0042, 0.023, 6).translate(p.x, p.y - 0.003, p.z);
    const base = new T.Vector3(-0.116, -0.042, -0.043);
    const tip = new T.Vector3(FIXED.x, FIXED.y - 0.01, FIXED.z);
    const span = tip.clone().sub(base);
    const support = new T.CylinderGeometry(0.008, 0.011, span.length(), 5);
    support.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), span.normalize()),
    );
    support.translate((tip.x + base.x) / 2, (tip.y + base.y) / 2, (tip.z + base.z) / 2);
    this.frameMount = assembly([support, stud(FIXED)], materials.steel, 'GP damper frame pedestal');
    this.yokeMount = new T.Mesh(stud(YOKE), materials.steel);
    this.yokeMount.name = 'GP damper yoke stud';
    this.yokeMount.castShadow = this.yokeMount.receiveShadow = true;
    this.root.name = 'GP steering damper';
    this.root.position.copy(FIXED);
    const body = assembly(
      [
        eye(),
        shaft([
          [0.007, 0.005],
          [0.016, 0.008],
          [0.021, 0.0115],
          [0.097, 0.0115],
          [0.1, 0.01],
          [0.115, 0.01],
          [SEAL, 0.007],
        ]),
      ],
      materials.forkUpper,
      'GP hydraulic steering barrel',
    );
    this.slider = assembly(
      [
        eye(),
        shaft([
          [-ROD, 0.0042],
          [-0.018, 0.0042],
          [-0.014, 0.0063],
          [-0.006, 0.0063],
        ]),
      ],
      materials.steel,
      'GP sliding steering shaft',
    );
    this.root.add(body, this.slider);
    this.update(0);
  }
  update(steer: number) {
    const c = Math.cos(steer),
      s = Math.sin(steer);
    this.end.set(c * YOKE.x + s * YOKE.z, YOKE.y, -s * YOKE.x + c * YOKE.z).sub(FIXED);
    const length = this.end.length();
    this.root.rotation.y = -Math.atan2(this.end.z, this.end.x);
    this.slider.position.x = length;
  }
}
