import * as T from 'three';
import { engineeringFresh, type EngineeringSample } from '../workers/diagnostics.ts';

/** Actual last-solve contact points, queried suspension rays and Fz/normal
 * arrows. These are not invented local-up force vectors on a banked road. */
export class EngineeringView {
  readonly group = new T.Group();
  private lastSample: EngineeringSample | null = null;
  private positions = new Float32Array(4 * 2 * 3);
  private geometry = new T.BufferGeometry();
  private contacts: T.InstancedMesh;
  private arrows: T.ArrowHelper[] = [];
  private direction = new T.Vector3();
  private matrix = new T.Matrix4();
  constructor() {
    this.group.visible = false;
    this.geometry.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    const rays = new T.LineSegments(
      this.geometry,
      new T.LineBasicMaterial({
        color: 0x58cff5,
        depthTest: false,
        transparent: true,
        opacity: 0.8,
      }),
    );
    rays.frustumCulled = false;
    this.contacts = new T.InstancedMesh(
      new T.SphereGeometry(0.05, 8, 6),
      new T.MeshBasicMaterial({ color: 0xffbe59, depthTest: false }),
      4,
    );
    this.contacts.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.contacts.frustumCulled = false;
    this.group.add(rays, this.contacts);
    for (let i = 0; i < 4; i++) {
      const arrow = new T.ArrowHelper(
        new T.Vector3(0, 1, 0),
        new T.Vector3(),
        1,
        0x80eea5,
        0.14,
        0.07,
      );
      this.arrows.push(arrow);
      this.group.add(arrow);
    }
  }
  update(sample: EngineeringSample | null, time: number, visible: boolean, replay: boolean) {
    this.group.visible = visible && engineeringFresh(sample, time, replay);
    if (!this.group.visible || !sample) return;
    if (sample === this.lastSample) return;
    this.lastSample = sample;
    let count = 0;
    sample.wheels.forEach((wheel, i) => {
      const arrow = this.arrows[i];
      arrow.visible = wheel.loadN > 1;
      if (!arrow.visible) return;
      this.positions.set(wheel.origin, count * 6);
      this.positions.set(wheel.contact, count * 6 + 3);
      this.contacts.setMatrixAt(count, this.matrix.makeTranslation(...wheel.contact));
      arrow.position.fromArray(wheel.contact);
      this.direction.fromArray(wheel.normal).normalize();
      arrow.setDirection(this.direction);
      arrow.setLength(Math.max(0.03, wheel.loadN / 3500), 0.14, 0.07);
      count++;
    });
    this.contacts.count = count;
    this.contacts.instanceMatrix.needsUpdate = true;
    this.geometry.setDrawRange(0, count * 2);
    this.geometry.getAttribute('position').needsUpdate = true;
  }
}
