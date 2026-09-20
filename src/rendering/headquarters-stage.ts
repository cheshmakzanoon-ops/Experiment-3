import * as T from 'three';
import { box, mesh, rod, mergeStatic, canvasTexture } from './geometry.ts';

/** Original, bounded, inspection-only workshop/atrium set. It uses real meshes,
 * lights and PBR surfaces, not screenshots behind a menu. It neither relocates
 * the physical car nor introduces inaccessible scenery into the race circuit. */
export class HeadquartersStage {
  readonly root = new T.Group();
  readonly background = new T.Color(0x182430);
  readonly structure = new T.Group();
  private orientation = new T.Euler();
  constructor(withLettering = true) {
    this.root.name = 'Original APEX workshop / atrium · references 011–016 035 081 086';
    this.root.add(this.structure);
    const concrete = new T.MeshStandardMaterial({ color: 0xa2aaa8, roughness: 0.8 });
    const floor = new T.MeshStandardMaterial({ color: 0x66767b, roughness: 0.34, metalness: 0.16 });
    const steel = new T.MeshStandardMaterial({ color: 0x263947, metalness: 0.65, roughness: 0.33 });
    const alloy = new T.MeshStandardMaterial({ color: 0xc8d6d9, metalness: 0.82, roughness: 0.26 });
    const timber = new T.MeshStandardMaterial({ color: 0x8e6041, roughness: 0.7 });
    const cloth = new T.MeshStandardMaterial({ color: 0x293f49, roughness: 0.96 });
    const accent = new T.MeshStandardMaterial({
      color: 0xd38d50,
      roughness: 0.45,
      metalness: 0.15,
    });
    const white = new T.MeshStandardMaterial({ color: 0xe3e9e5, roughness: 0.65 });
    const glass = new T.MeshPhysicalMaterial({
      color: 0xa9cfdb,
      transparent: true,
      opacity: 0.25,
      metalness: 0.16,
      roughness: 0.09,
      side: T.DoubleSide,
      depthWrite: false,
    });
    const glow = new T.MeshBasicMaterial({ color: 0xe6f2ff });
    const leaves = new T.MeshStandardMaterial({ color: 0x285744, roughness: 0.86 });
    const shell = this.structure;
    box(shell, floor, 0, -0.15, -1, 34, 0.3, 36);
    box(shell, concrete, 0, 4.5, -14, 34, 9, 0.35);
    box(shell, steel, 0, 8.8, -2, 34, 0.35, 25);
    // A glazed side elevation and structural rhythm; the front is open for inspection.
    for (const side of [-1, 1]) {
      for (let z = -12; z <= 9; z += 3.5) {
        box(shell, steel, side * 16, 4.3, z, 0.2, 8.6, 0.2);
        box(shell, glass, side * 16, 4.2, z + 1.65, 0.035, 8.1, 3.2);
      }
      for (const y of [0.35, 4.2, 8.4]) box(shell, steel, side * 16, y, -1, 0.25, 0.12, 27);
    }
    for (let x = -15; x < -4; x += 0.32) box(shell, timber, x, 4.3, -13.7, 0.16, 8.4, 0.17);
    // Real mezzanine slab, supported columns and a continuous guarded staircase.
    box(shell, concrete, 1, 4.05, -11.2, 27, 0.3, 5.2);
    for (const x of [-12.3, -5, 3, 10.5, 14.3]) box(shell, steel, x, 2, -8.75, 0.16, 4, 0.16);
    for (let x = -11; x <= 14; x += 1.6) box(shell, alloy, x, 4.75, -8.55, 0.04, 1.1, 0.04);
    box(shell, alloy, 1.5, 5.3, -8.55, 26, 0.055, 0.055);
    box(shell, glass, 1.5, 4.75, -8.55, 26, 0.85, 0.025);
    for (let step = 0; step < 16; step++)
      box(shell, steel, -13, 0.125 + step * 0.25, 0.45 - step * 0.55, 2.25, 0.25, 0.6);
    for (const side of [-1, 1]) {
      const x = -13 + side * 1.05;
      rod(shell, steel, new T.Vector3(x, 0.05, 0.7), new T.Vector3(x, 3.8, -7.9), 0.07);
      rod(shell, alloy, new T.Vector3(x, 1.1, 0.7), new T.Vector3(x, 4.9, -7.9), 0.028);
      for (const step of [0, 4, 8, 12, 15])
        box(shell, alloy, x, 0.68 + step * 0.25, 0.45 - step * 0.55, 0.035, 1.1, 0.035);
    }
    // Fabrication benches, caster tool chests and separate drawer pulls.
    for (const side of [-1, 1]) {
      for (const z of [-5, 3]) {
        box(shell, steel, side * 9, 0.46, z, 3, 0.8, 1.15);
        box(shell, alloy, side * 9, 0.92, z, 3.2, 0.1, 1.25);
        for (let drawer = 0; drawer < 4; drawer++) {
          box(shell, accent, side * 9, 0.23 + drawer * 0.18, z + 0.6, 2.75, 0.14, 0.025);
          box(shell, alloy, side * 9, 0.23 + drawer * 0.18, z + 0.64, 0.8, 0.025, 0.04);
        }
        for (const dx of [-1.1, 1.1])
          for (const dz of [-0.4, 0.4])
            mesh(shell, new T.SphereGeometry(0.085, 10, 8), steel, side * 9 + dx, 0.085, z + dz);
        box(shell, steel, side * 9, 1.13, z - 0.3, 0.08, 0.4, 0.08);
        box(shell, steel, side * 9, 1.48, z - 0.3, 1.0, 0.62, 0.065);
        box(shell, glow, side * 9, 1.48, z - 0.26, 0.92, 0.54, 0.015);
      }
      // Floor working-envelope marks do not claim to be a live service bay.
      box(shell, white, side * 3.9, 0.009, 0, 0.045, 0.015, 9.5);
      box(shell, white, 0, 0.009, side * 4.75, 7.8, 0.015, 0.045);
    }
    // Lounge corner: padded chairs, round cafe table and planted pots.
    mesh(shell, new T.CylinderGeometry(0.85, 0.85, 0.07, 32), timber, 7, 0.8, 9);
    mesh(shell, new T.CylinderGeometry(0.08, 0.13, 0.77, 16), steel, 7, 0.39, 9);
    mesh(shell, new T.CylinderGeometry(0.46, 0.5, 0.035, 24), steel, 7, 0.03, 9);
    for (const x of [5.7, 8.3]) {
      box(shell, cloth, x, 0.49, 9, 0.65, 0.12, 0.68);
      box(shell, cloth, x, 0.85, 9.33, 0.65, 0.65, 0.12);
      for (const dx of [-0.25, 0.25])
        for (const dz of [-0.25, 0.25])
          box(shell, timber, x + dx, 0.23, 9 + dz, 0.045, 0.46, 0.045);
    }
    for (const [x, z] of [
      [-14, 8],
      [13.5, 8],
      [12, -12],
    ]) {
      mesh(shell, new T.CylinderGeometry(0.44, 0.32, 0.6, 20), concrete, x, 0.3, z);
      for (let i = 0; i < 7; i++) {
        const angle = i * 2.399,
          h = 1.2 + (i % 3) * 0.3;
        const plant = mesh(
          shell,
          new T.SphereGeometry(1, 12, 8),
          leaves,
          x + Math.sin(angle) * 0.25,
          h,
          z + Math.cos(angle) * 0.25,
        );
        plant.scale.set(0.17, 0.6, 0.15);
        plant.rotation.z = Math.sin(angle) * 0.4;
        rod(shell, timber, new T.Vector3(x, 0.55, z), plant.position, 0.015);
      }
    }
    for (const x of [-7, 0, 7])
      for (const z of [-5, 4]) box(shell, glow, x, 8.55, z, 5.5, 0.055, 0.18);
    if (withLettering) {
      const map = canvasTexture(1024, 256, (c) => {
        c.fillStyle = '#172b36';
        c.fillRect(0, 0, 1024, 256);
        c.fillStyle = '#e8efed';
        c.font = '800 104px Arial';
        c.fillText('APEX / WORKSHOP', 40, 130, 944);
        c.fillStyle = '#d89b66';
        c.font = '600 30px Arial';
        c.fillText('DESIGN  ·  FABRICATE  ·  TEST  ·  LEARN', 42, 198);
      });
      const sign = new T.MeshBasicMaterial({ map });
      mesh(shell, new T.PlaneGeometry(8, 2), sign, 5.2, 6.65, -13.77);
    }
    mergeStatic(shell);
    for (const [x, z, color] of [
      [-6, 3, 0xd9ebff],
      [7, -5, 0xffe9d1],
    ]) {
      const light = new T.PointLight(color, 95, 34, 2);
      light.position.set(x, 6, z);
      this.root.add(light);
    }
    this.root.visible = false;
    this.root.userData.inspectionOnly = true;
  }
  position(subject: T.Object3D, floorY: number) {
    this.root.position.set(subject.position.x, floorY, subject.position.z);
    this.root.rotation.set(0, this.orientation.setFromQuaternion(subject.quaternion, 'YXZ').y, 0);
    this.root.updateMatrixWorld(true);
  }
}
