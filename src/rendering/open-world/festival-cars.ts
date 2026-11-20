import * as T from 'three';
import { F, H, R, RACE_BASE, carBase } from '../../simulation/protocol.ts';
import { vehicleAt } from '../../simulation/vehicles.ts';
import { FestivalHeadlamps } from './festival-headlamps.ts';
import { bodySheetFor } from '../vehicle-bodies/body-sheet.ts';
import { FormulaCar } from '../car.ts';
import { carLod } from '../lod.ts';
import { VehicleBodies } from '../vehicle-bodies/index.ts';
import { installSpecularIBL } from '../studio/ibl-energy.ts';
import type { Quality } from '../options.ts';
import { FestivalCarFinish } from './festival-car-finish.ts';

/** The festival constructs the procedural Formula model without borrowed
 * hero/driver assets. Capture its own resources before reflection/mirror
 * systems attach external textures. The shared tyre-lettering atlas lives in
 * a shader uniform and is intentionally outside this list. */
function ownFormulaResources(car: FormulaCar) {
  const resources = new Set<T.BufferGeometry | T.Material | T.Texture | T.InstancedMesh>();
  car.root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    resources.add(node.geometry);
    // InstancedMesh owns GPU instance attributes in addition to its geometry.
    if (node instanceof T.InstancedMesh) resources.add(node);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      resources.add(material);
      for (const [key, value] of Object.entries(material))
        if (key !== 'envMap' && value instanceof T.Texture) resources.add(value);
    }
  });
  return () => {
    for (const resource of resources) resource.dispose();
    resources.clear();
    car.root.removeFromParent();
    car.root.clear();
  };
}

/**
 * Car presentation for the festival: every entrant is posed from the
 * interpolated snapshot; Formula definitions use the full FormulaCar (built
 * on first use), every other definition is drawn by the procedural
 * catalogue body library the circuit renderer uses (`VehicleBodies`), so a
 * new registry car appears here without festival code. Night lights the
 * body lamps and adds dipped headlights to the followed car.
 */
export class FestivalCars {
  readonly root = new T.Group();
  /** Non-Formula bodies (the circuit renderer's library). */
  readonly bodies = new VehicleBodies();
  /** Snapshot-driven finish on the followed road car; its clones are local. */
  readonly finish = new FestivalCarFinish();
  private readonly holders: { root: T.Object3D; lodLevel: number }[] = [];
  private readonly formula = new Map<number, FormulaCar>();
  private readonly releaseFormula = new Map<number, () => void>();
  private readonly lights = new FestivalHeadlamps();
  readonly reflectivePaint: T.Material[] = [];
  private readonly paintSet = new Set<T.Material>();
  paintVersion = 0;
  constructor() {
    this.root.name = 'Festival cars';
    this.root.add(this.bodies.root);
    this.bodies.onBuild = () => this.refreshPaint();
    this.root.add(this.lights.root);
  }
  /** Rebuild on body identity, including equal-sized garage replacements.
   * Removed car materials must not stay owned by the reflection probe. */
  private refreshPaint() {
    installSpecularIBL(this.root);
    this.paintSet.clear();
    this.reflectivePaint.length = 0;
    this.root.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (
          material instanceof T.MeshPhysicalMaterial &&
          material.clearcoat > 0 &&
          !this.paintSet.has(material)
        ) {
          this.paintSet.add(material);
          this.reflectivePaint.push(material);
        }
      }
    });
    this.paintVersion++;
  }
  /** The followed car's root (camera subject). */
  subject(id = 0) {
    return this.holders[id]?.root ?? null;
  }
  update(
    a: Float32Array,
    b: Float32Array,
    presented: Float32Array,
    alpha: number,
    dt: number,
    night: number,
    camera?: T.Camera,
    cockpit = false,
    quality: Quality = 'medium',
  ) {
    const cars = Math.round(presented[H.CARS]);
    while (this.holders.length < cars) {
      const holder = new T.Object3D();
      holder.name = `Festival entrant ${this.holders.length + 1}`;
      this.root.add(holder);
      this.holders.push({ root: holder, lodLevel: this.holders.length ? 1 : 0 });
    }
    let retired = false;
    for (let id = 0; id < this.holders.length; id++) {
      const holder = this.holders[id].root,
        o = carBase(id),
        definition = id < cars ? vehicleAt(Math.round(presented[o + RACE_BASE + R.VEHICLE])) : null;
      holder.visible = !!definition;
      let formula = this.formula.get(id);
      // A Low-preset garage keeps one representation per entrant. Retire the
      // old one before constructing its replacement to bound the swap peak.
      // Finished rivals can be retired at every preset once they leave the field.
      if (
        (!definition || (quality === 'low' && definition.classId === 'formula')) &&
        this.bodies.release(id)
      ) {
        if (id === 0) this.finish.clear();
        retired = true;
      }
      if (formula && (!definition || (quality === 'low' && definition.classId !== 'formula'))) {
        this.releaseFormula.get(id)!();
        this.releaseFormula.delete(id);
        this.formula.delete(id);
        formula = undefined;
        retired = true;
      }
      if (!definition) {
        if (formula) formula.root.visible = false;
        continue;
      }
      holder.position.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
      holder.quaternion.set(
        presented[o + F.QX],
        presented[o + F.QY],
        presented[o + F.QZ],
        presented[o + F.QW],
      );
      const distance = camera ? holder.position.distanceTo(camera.position) : id === 0 ? 0 : 80;
      if (definition.classId === 'formula') {
        let car = formula;
        if (!car) {
          car = new FormulaCar(id);
          this.formula.set(id, car);
          this.releaseFormula.set(id, ownFormulaResources(car));
          this.root.add(car.root);
          this.refreshPaint();
        }
        car.root.visible = true;
        car.setLod(distance, quality, id === 0);
        car.update(a, b, o, alpha, dt, presented[H.TIME], false);
        holder.position.copy(car.root.position);
        holder.quaternion.copy(car.root.quaternion);
      } else {
        if (formula) formula.root.visible = false;
        const host = this.holders[id];
        host.lodLevel = carLod(distance, host.lodLevel, quality, id === 0);
      }
    }
    // The body library reads the snapshots and the posed holders; Formula
    // entrants keep their own representation. Entrants beyond the current
    // field read as Formula (no vehicle slot in the snapshot), which hides
    // any body left over from a finished event.
    const lightLevel = Math.max(
      night,
      T.MathUtils.smoothstep(presented[H.RAIN] || 0, 1.5, 12) * 0.55,
    );
    this.bodies.update(
      a,
      b,
      alpha,
      // Every definition follows its current holder. A cached Formula root
      // stops being posed when this entrant changes to a road car.
      this.holders,
      lightLevel > 0.05,
      { follow: 0, cockpit, camera: camera?.position ?? null },
    );
    if (retired) this.refreshPaint();
    const followed = vehicleAt(Math.round(presented[carBase(0) + RACE_BASE + R.VEHICLE]));
    const followedSheet = bodySheetFor(followed);
    let finishActive = false;
    if (cars > 0 && followedSheet?.kind === 'closed') {
      // The public cabin belongs to this entrant even after a garage swap.
      // Resolve its enclosing body rather than relying on child insertion
      // order, vehicle names, or the catalogue's private implementation map.
      let body: T.Object3D | null = this.bodies.cabinOf(0)?.detail ?? null;
      while (body && body.parent !== this.bodies.root) body = body.parent;
      if (body) {
        if (this.finish.bind(body, followed, followedSheet)) this.refreshPaint();
        finishActive = true;
      }
    }
    this.finish.update(presented, quality !== 'low', finishActive);
    for (let id = 0; id < this.holders.length; id++) {
      const formula = this.formula.get(id);
      const isFormula =
        id < cars &&
        vehicleAt(Math.round(presented[carBase(id) + RACE_BASE + R.VEHICLE])).classId === 'formula';
      if (formula) formula.root.visible = isFormula;
      this.holders[id].root.visible = false;
    }
    this.lights.update(cars > 0 ? this.holders[0].root : null, followed, lightLevel);
  }
  /** Clear all entrants; repeated garage swaps reuse bounded Formula entries,
   * while a session exit releases every resource owned by those entries. */
  clear() {
    this.finish.clear();
    this.bodies.clear();
    for (const release of this.releaseFormula.values()) release();
    this.releaseFormula.clear();
    this.formula.clear();
    for (const holder of this.holders) holder.root.removeFromParent();
    this.holders.length = 0;
    this.lights.clear();
    this.paintSet.clear();
    this.reflectivePaint.length = 0;
    this.paintVersion++;
  }
  dispose() {
    this.clear();
    this.lights.dispose();
  }
}
