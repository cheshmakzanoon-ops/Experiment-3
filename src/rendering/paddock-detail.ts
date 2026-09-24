import { installVenueFinish } from './venue-materials.ts';
import * as T from 'three';
import { box, rod } from './geometry.ts';

/** Original paddock materials. These are authored presentation values, not
 * scanned assets or measurements copied from a commercial racing title. */
export function paddockMaterials() {
  const materials = {
    concrete: new T.MeshStandardMaterial({ color: 0xb5b7ac, roughness: 0.93 }),
    steel: new T.MeshStandardMaterial({ color: 0x505b5d, metalness: 0.62, roughness: 0.49 }),
    cladding: new T.MeshStandardMaterial({ color: 0xcdd2ce, metalness: 0.38, roughness: 0.5 }),
    glass: new T.MeshPhysicalMaterial({
      color: 0x62797c,
      metalness: 0,
      roughness: 0.18,
      clearcoat: 0.85,
    }),
    interior: new T.MeshStandardMaterial({ color: 0x303936, roughness: 0.88 }),
  };
  installVenueFinish(materials.concrete, 'stone');
  installVenueFinish(materials.steel, 'metal');
  installVenueFinish(materials.cladding, 'metal');
  return materials;
}
export type PaddockMaterials = ReturnType<typeof paddockMaterials>;

function beam(root: T.Group, material: T.Material, a: number[], b: number[], radius = 0.045) {
  return rod(root, material, new T.Vector3(...a), new T.Vector3(...b), radius);
}

/** Negative X faces the pit lane. The entrance is genuinely open: the back wall,
 * ceiling, furniture and glazing create real parallax and occlusion instead of a
 * dark rectangle pasted onto a closed box. */
export function buildGarageBay(root: T.Group, m: PaddockMaterials, id: number) {
  root.name = `Open garage bay ${id + 1}`;
  box(root, m.concrete, 0, -0.75, 0, 13, 1.5, 8.6);
  box(root, m.interior, 0, 0.025, 0, 12.8, 0.05, 8.35);
  box(root, m.interior, 6.3, 1.85, 0, 0.4, 3.7, 8.6);
  for (const z of [-4.13, 4.13]) {
    box(root, m.concrete, 0, 1.85, z, 13, 3.7, 0.34);
    box(root, m.steel, -6.55, 1.85, z, 0.18, 3.7, 0.18);
  }
  box(root, m.concrete, 0, 3.6, 0, 13.5, 0.25, 8.7);
  box(root, m.concrete, 0, 5, 0, 12.9, 2.6, 8.5);

  // Recessed glazing, mullions and a projecting shade provide layered depth.
  box(root, m.glass, -6.49, 4.83, 0, 0.08, 1.53, 7.86);
  for (let z = -3.94; z <= 4; z += 0.985) box(root, m.steel, -6.57, 4.83, z, 0.12, 1.65, 0.055);
  box(root, m.cladding, -6.82, 5.72, 0, 1.05, 0.14, 8.75);
  box(root, m.cladding, 0, 6.37, 0, 14, 0.18, 8.94);
  box(root, m.steel, -7.04, 6.29, 0, 0.16, 0.16, 8.95);
  beam(root, m.steel, [-6.83, 6.26, 4.1], [-6.83, 0.02, 4.1], 0.055);
  for (let z = -3.8; z < 4.2; z += 0.8) box(root, m.steel, 0, 6.48, z, 13.8, 0.025, 0.022);

  // Folded roller-door slats remain stored above the opening.
  for (let y = 3.0; y < 3.4; y += 0.075) box(root, m.cladding, -6.5, y, 0, 0.1, 0.057, 7.8);
  for (const z of [-2.9, 2.9]) {
    box(root, m.steel, 3.55, 0.68, z, 2.8, 1.3, 1.28);
    box(root, m.cladding, 3.55, 1.37, z, 3, 0.06, 1.4);
    for (let drawer = 0; drawer < 4; drawer++) {
      box(root, m.interior, 2.13, 0.26 + drawer * 0.27, z, 0.015, 0.21, 1.12);
      box(root, m.cladding, 2.105, 0.33 + drawer * 0.27, z, 0.035, 0.025, 0.42);
    }
    const strip = box(root, m.cladding, -0.9, 3.43, z, 7.2, 0.055, 0.12);
    strip.name = 'Garage ceiling light housing';
  }
  const unit = box(root, m.steel, 3, 6.9, 0, 2.3, 0.9, 2.25);
  unit.name = 'Roof ventilation';
  for (let z = -0.95; z < 1.1; z += 0.18) box(root, m.cladding, 1.82, 6.9, z, 0.035, 0.64, 0.06);
  for (const z of [-3.8, 0, 3.8]) beam(root, m.steel, [-6.5, 5.2, z], [-7.1, 5.65, z], 0.027);

  root.userData.opening = { min: [-6.6, 0.08, -3.75], max: [6.05, 2.96, 3.75] };
}
