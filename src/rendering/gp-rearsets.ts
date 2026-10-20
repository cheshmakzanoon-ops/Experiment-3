import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';
import {
  GP_BOOT_PEDAL,
  GP_BOOT_PEG,
  GP_FOOTPEG_RADIUS,
  gpBootFrame,
  gpRearBrakeAngle,
} from './gp-rider-contact.ts';

/** Original rearset construction informed by REF018/071: a relieved metal
 * hanger, thin carbon heel guard, and toothed peg beneath the planted boot.
 * Coordinates retain the production foot contacts. These are authored metre
 * dimensions, not engineering measurements recovered from the references. */
type Materials = Pick<BikeMaterials, 'aluminium' | 'steel' | 'carbon'>;
export const GP_REARSET_PEG = Object.freeze([0.17, -0.2, -0.3] as const);
export const GP_PEDAL_RADIUS = 0.005;
const UP = new T.Vector3(0, 1, 0);

function plate(shape: T.Shape, thickness: number, detail: RiderDetail, bevel = 0.0008) {
  const geometry = new T.ExtrudeGeometry(shape, {
    depth: thickness - 2 * bevel,
    curveSegments: detail === 'high' ? 6 : 3,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.translate(0, 0, -thickness / 2 + bevel);
  // The drawn profile is (forward, up); its extrusion becomes the lateral X.
  geometry.rotateY(-Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A triangular opening is real negative space, including its edge walls. */
export function gpRearsetHanger(detail: RiderDetail) {
  const shape = new T.Shape();
  shape.moveTo(-0.019, -0.016);
  shape.quadraticCurveTo(0.002, -0.025, 0.025, -0.011);
  shape.lineTo(0.125, 0.045);
  shape.quadraticCurveTo(0.146, 0.057, 0.143, 0.086);
  shape.lineTo(0.132, 0.115);
  shape.quadraticCurveTo(0.125, 0.131, 0.109, 0.118);
  shape.lineTo(0.028, 0.041);
  shape.quadraticCurveTo(-0.025, 0.026, -0.019, -0.016);
  if (detail !== 'far') {
    const relief = new T.Path();
    relief.moveTo(0.027, 0.008);
    relief.lineTo(0.102, 0.05);
    relief.quadraticCurveTo(0.11, 0.058, 0.101, 0.065);
    relief.lineTo(0.048, 0.035);
    relief.quadraticCurveTo(0.022, 0.024, 0.027, 0.008);
    shape.holes.push(relief);
    for (const [z, y] of [
      [0.118, 0.102],
      [0.117, 0.069],
    ]) {
      const bore = new T.Path();
      bore.absarc(z, y, 0.0042, 0, Math.PI * 2, true);
      shape.holes.push(bore);
    }
  }
  const geometry = plate(shape, 0.007, detail);
  geometry.name = 'GP open machined rearset hanger';
  return geometry;
}

/** Same .012 m contact radius and .08 m length as the former plain cylinder.
 * The radial crowns have a shallow alternating cut and a real hollow end. */
export function gpRearsetPeg(detail: RiderDetail) {
  if (detail === 'far') {
    const geometry = new T.CylinderGeometry(GP_FOOTPEG_RADIUS, GP_FOOTPEG_RADIUS, 0.08, 8);
    geometry.rotateZ(Math.PI / 2);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
  const profile = [new T.Vector2(0.006, -0.04), new T.Vector2(0.01, -0.04)];
  const rings = detail === 'high' ? 20 : 10;
  for (let i = 0; i <= rings; i++) {
    const x = -0.036 + (0.072 * i) / rings,
      // The central crown meets the unchanged ball-of-foot contact.
      crown = (i - rings / 2) % 2 === 0;
    profile.push(new T.Vector2(crown ? GP_FOOTPEG_RADIUS : 0.0102, x));
  }
  profile.push(new T.Vector2(0.01, 0.04), new T.Vector2(0.006, 0.04), new T.Vector2(0.006, -0.04));
  const geometry = new T.LatheGeometry(profile, detail === 'high' ? 16 : 12);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'GP hollow serrated footpeg';
  return geometry;
}

function heelGuard(detail: RiderDetail) {
  const shape = new T.Shape();
  shape.moveTo(-0.128, 0.024);
  shape.quadraticCurveTo(-0.124, 0.084, -0.084, 0.094);
  shape.lineTo(0.012, 0.052);
  shape.quadraticCurveTo(0.029, 0.026, 0.012, 0.015);
  shape.lineTo(-0.103, 0.009);
  shape.quadraticCurveTo(-0.124, 0.008, -0.128, 0.024);
  const geometry = plate(shape, 0.002, detail, 0.0003);
  geometry.name = 'GP thin formed carbon heel guard';
  return geometry;
}

function add(root: T.Group, geometry: T.BufferGeometry, material: T.Material, name: string) {
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

/** The right toe spindle and the rider share a sole landmark and ankle angle.
 * The pedal pivot sits inboard at peg-top height. Therefore its top surface
 * follows the sole throughout the short stroke, including replay seeks.
 * Fixed hardware can join the existing sprung material batches; only one
 * aluminium pedal mesh needs its own articulation boundary. */
export class GPRearsets {
  readonly root = new T.Group();
  readonly brake = new T.Group();
  readonly spindle = new T.Vector3();
  constructor(detail: RiderDetail, materials: Materials) {
    this.root.name = 'GP machined rearsets';
    this.root.userData.gpRearsets = true;
    const segments = detail === 'high' ? 16 : 10,
      frame = gpBootFrame(new T.Quaternion()),
      contact = new T.Vector3()
        .fromArray(GP_BOOT_PEDAL)
        .sub(new T.Vector3().fromArray(GP_BOOT_PEG))
        .applyQuaternion(frame),
      outward = UP.clone().applyQuaternion(frame);
    this.spindle.copy(contact).addScaledVector(outward, GP_PEDAL_RADIUS);
    for (const side of [-1, 1]) {
      const peg = add(
        this.root,
        gpRearsetPeg(detail),
        materials.aluminium,
        'GP serrated rearset peg',
      );
      peg.position.set(side * GP_REARSET_PEG[0], GP_REARSET_PEG[1], GP_REARSET_PEG[2]);
      const hanger = add(
        this.root,
        gpRearsetHanger(detail),
        materials.aluminium,
        'GP relieved rearset hanger',
      );
      hanger.position.set(side * 0.112, GP_REARSET_PEG[1], GP_REARSET_PEG[2]);
      const shoulder = add(
        this.root,
        new T.CylinderGeometry(0.01, 0.01, 0.024, detail === 'high' ? 12 : 8),
        materials.aluminium,
        'GP rearset peg mounting shoulder',
      );
      shoulder.rotation.z = Math.PI / 2;
      shoulder.position.set(side * 0.124, GP_REARSET_PEG[1], GP_REARSET_PEG[2]);
      if (detail === 'far') continue;
      const guard = add(
        this.root,
        heelGuard(detail),
        materials.carbon,
        'GP protective carbon heel guard',
      );
      guard.position.set(side * 0.116, GP_REARSET_PEG[1], GP_REARSET_PEG[2]);
      for (const [z, y] of [
        [0.118, 0.102],
        [0.117, 0.069],
      ]) {
        const bolt = add(
          this.root,
          new T.CylinderGeometry(0.006, 0.006, 0.008, 6),
          materials.steel,
          'GP captive rearset fastener',
        );
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(side * 0.117, GP_REARSET_PEG[1] + y, GP_REARSET_PEG[2] + z);
      }
      if (detail !== 'high') continue;
      const pedal = side < 0 ? this.brake : new T.Group();
      pedal.name = side < 0 ? 'GP rear-brake pedal pivot' : 'GP gearshift toe lever';
      pedal.position.set(side * 0.112, GP_REARSET_PEG[1] + GP_FOOTPEG_RADIUS, GP_REARSET_PEG[2]);
      this.root.add(pedal);
      const arm = new T.Shape();
      arm.moveTo(-0.01, -0.006);
      arm.quadraticCurveTo(-0.018, 0.007, -0.004, 0.011);
      arm.lineTo(0.026, 0.004);
      arm.lineTo(this.spindle.z - 0.006, this.spindle.y + 0.006);
      arm.quadraticCurveTo(
        this.spindle.z + 0.007,
        this.spindle.y + 0.006,
        this.spindle.z + 0.007,
        this.spindle.y - 0.005,
      );
      arm.lineTo(this.spindle.z - 0.005, this.spindle.y - 0.009);
      arm.lineTo(0.019, -0.008);
      arm.closePath();
      const lever = add(
        pedal,
        plate(arm, 0.005, detail),
        materials.aluminium,
        'GP forged toe-lever arm',
      );
      const toe = add(
        pedal,
        new T.CylinderGeometry(GP_PEDAL_RADIUS, GP_PEDAL_RADIUS, 0.059, segments),
        materials.aluminium,
        'GP rearset toe spindle',
      );
      toe.rotation.z = Math.PI / 2;
      toe.position.set(side * 0.0295, this.spindle.y, this.spindle.z);
      // Merge the two rigid pieces locally; the articulation group survives.
      lever.updateMatrix();
      toe.updateMatrix();
      const first = lever.geometry.index ? lever.geometry.toNonIndexed() : lever.geometry.clone(),
        second = toe.geometry.index ? toe.geometry.toNonIndexed() : toe.geometry.clone();
      second.applyMatrix4(toe.matrix);
      const combined = mergeGeometries([first, second], false)!;
      combined.computeBoundingBox();
      combined.computeBoundingSphere();
      lever.geometry.dispose();
      toe.geometry.dispose();
      first.dispose();
      second.dispose();
      toe.removeFromParent();
      lever.geometry = combined;
      lever.name = side < 0 ? 'GP articulated rear-brake pedal' : 'GP forged gearshift lever';
      if (side > 0) {
        pedal.updateMatrix();
        lever.applyMatrix4(pedal.matrix);
        this.root.add(lever);
        pedal.removeFromParent();
      }
      const axle = add(
        this.root,
        new T.CylinderGeometry(0.008, 0.008, 0.012, segments),
        materials.steel,
        'GP rearset pedal pivot pin',
      );
      axle.rotation.z = Math.PI / 2;
      axle.position.copy(pedal.position);
    }
  }
  update(rearBrake: number) {
    this.brake.rotation.x = gpRearBrakeAngle(rearBrake);
  }
}
