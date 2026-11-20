import * as T from 'three';
import { canvasTexture } from './geometry.ts';
import { batchBikeRigidMeshes } from './bike-rigid-batch.ts';
import type { BikeInstrumentValues } from './bike-cockpit.ts';

type Unit = 'rpm' | 'speed';
const START = (135 * Math.PI) / 180;
const SWEEP = (270 * Math.PI) / 180;

/** Screen-printed faces are immutable. Every machine of the same type shares
 * the artwork, while the pointers and their recorded transforms belong to the rider. */
const faces = new Map<string, { material: T.MeshStandardMaterial; users: number }>();
function acquireFace(unit: Unit, classic: boolean, maximum: number) {
  const key = `${unit}/${classic}/${maximum}`;
  let face = faces.get(key);
  if (!face) {
    const map = canvasTexture(256, 256, (c) => {
      c.fillStyle = classic ? '#e8debf' : '#1b252e';
      c.fillRect(0, 0, 256, 256);
      c.translate(128, 128);
      const ink = classic ? '#202324' : '#f0f3eb';
      const major = unit === 'rpm' ? Math.round(maximum / 1000) : 12;
      for (let i = 0; i <= major * 4; i++) {
        const t = i / (major * 4),
          angle = START + SWEEP * t;
        const x = Math.cos(angle),
          y = Math.sin(angle),
          numbered = i % 4 === 0;
        c.strokeStyle = unit === 'rpm' && t > 0.88 ? '#df6748' : ink;
        c.lineWidth = numbered ? 3 : 1.6;
        c.beginPath();
        c.moveTo(113 * x, 113 * y);
        c.lineTo((numbered ? 91 : 103) * x, (numbered ? 91 : 103) * y);
        c.stroke();
        if (numbered) {
          c.fillStyle = ink;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.font = `${classic ? 'bold' : '600'} ${unit === 'speed' ? 16 : 19}px sans-serif`;
          c.fillText(
            String(Math.round((t * maximum) / (unit === 'rpm' ? 1000 : 1))),
            74 * x,
            74 * y,
          );
        }
      }
      c.fillStyle = ink;
      c.textAlign = 'center';
      c.font = 'bold 13px sans-serif';
      c.fillText(unit === 'speed' ? 'km/h' : '×1000 rpm', 0, 41);
    });
    face = {
      material: new T.MeshStandardMaterial({
        name: `Printed road ${unit} dial`,
        map,
        roughness: 0.78,
        metalness: 0,
      }),
      users: 0,
    };
    faces.set(key, face);
  }
  face.users++;
  return {
    material: face.material,
    release() {
      if (--face.users === 0) {
        face.material.map!.dispose();
        face.material.dispose();
        faces.delete(key);
      }
    },
  };
}

/** Mechanical clocks mounted to the steering bridge. Face and pointer use
 * the same 270-degree graduation; rewind reconstructs both readings directly. */
export class RoadBikeInstruments {
  readonly root = new T.Group();
  private readonly hands: T.Mesh[] = [];
  private readonly printed: ReturnType<typeof acquireFace>[] = [];
  private readonly enamel = new T.MeshStandardMaterial({
    color: 0xef6b3e,
    roughness: 0.38,
    metalness: 0.12,
  });
  private readonly lens = new T.MeshPhysicalMaterial({
    color: 0xe4eff3,
    roughness: 0.1,
    metalness: 0.12,
    clearcoat: 1,
    transparent: true,
    opacity: 0.11,
    depthWrite: false,
  });
  constructor(
    classic: boolean,
    private readonly limiter: number,
    dark: T.Material,
    rim: T.Material,
  ) {
    this.root.name = 'Steering-mounted road instruments';
    this.root.position.set(0, classic ? 0.057 : 0.081, classic ? 0.088 : 0.1);
    this.root.rotation.set(-1.12, Math.PI, 0, 'YXZ');
    this.root.updateMatrix();
    const steeringToPanel = this.root.matrix.clone().invert();
    for (const [index, unit] of (['rpm', 'speed'] as const).entries()) {
      const r = classic ? 0.046 : index === 0 ? 0.053 : 0.036;
      const dial = new T.Group();
      this.root.add(dial);
      dial.position.set(
        classic ? (index ? 0.05 : -0.05) : index ? 0.052 : -0.043,
        classic || !index ? 0 : -0.012,
        0,
      );
      // The cups are carried off the upper steering bridge on two stays.
      const foot = new T.Vector3(-dial.position.x, 0.012, 0.03).applyMatrix4(steeringToPanel);
      const back = dial.position.clone().add(new T.Vector3(0, 0, -0.032));
      const stay = new T.Mesh(new T.CylinderGeometry(0.005, 0.006, foot.distanceTo(back), 8), dark);
      stay.position.addVectors(foot, back).multiplyScalar(0.5);
      stay.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), back.sub(foot).normalize());
      stay.castShadow = true;
      this.root.add(stay);
      const cup = new T.Mesh(new T.CylinderGeometry(r, r * 0.87, 0.039, 28), dark);
      cup.rotation.x = Math.PI / 2;
      cup.position.z = -0.018;
      cup.castShadow = true;
      dial.add(cup);
      const bezel = new T.Mesh(new T.TorusGeometry(r * 0.95, r * 0.058, 8, 32), rim);
      bezel.position.z = 0.0045;
      dial.add(bezel);
      const face = acquireFace(unit, classic, index ? 240 : this.limiter);
      this.printed.push(face);
      const plate = new T.Mesh(new T.CircleGeometry(r * 0.935, 32), face.material);
      plate.position.z = 0.002;
      dial.add(plate);
      const cap = new T.Mesh(new T.CircleGeometry(r * 0.1, 12), dark);
      cap.position.z = 0.0058;
      dial.add(cap);
      const glass = new T.Mesh(new T.CircleGeometry(r * 0.915, 32), this.lens);
      glass.position.z = 0.007;
      dial.add(glass);
      const hand = new T.Shape();
      hand.moveTo(-r * 0.18, -r * 0.035);
      hand.lineTo(r * 0.85, -r * 0.015);
      hand.lineTo(r * 0.87, 0);
      hand.lineTo(-r * 0.18, r * 0.035);
      hand.closePath();
      const pivot = new T.Group(),
        needle = new T.Mesh(new T.ShapeGeometry(hand), this.enamel);
      needle.name = unit === 'rpm' ? 'Road tachometer needle' : 'Road speedometer needle';
      pivot.position.z = 0.004;
      dial.add(pivot);
      pivot.add(needle);
      this.hands.push(needle);
      batchBikeRigidMeshes(dial);
    }
    batchBikeRigidMeshes(this.root);
    this.update({});
  }
  update(v: BikeInstrumentValues) {
    const rpm = Number.isFinite(v.rpm) ? v.rpm! : 0,
      speed = Number.isFinite(v.speed) ? Math.abs(v.speed!) : 0;
    this.hands[0].rotation.z = -(START + SWEEP * T.MathUtils.clamp(rpm / this.limiter, 0, 1));
    this.hands[1].rotation.z = -(START + SWEEP * T.MathUtils.clamp((speed * 3.6) / 240, 0, 1));
  }
  dispose() {
    if (!this.printed.length) return;
    for (const face of this.printed.splice(0)) face.release();
    this.enamel.dispose();
    this.lens.dispose();
  }
}
