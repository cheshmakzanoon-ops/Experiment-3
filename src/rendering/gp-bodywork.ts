import * as T from 'three';
import bodywork from './assets/gp-bodywork.mesh.json';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** Blender-authored open instrument cowl, in the existing chassis frame.
 * Geometry is owned by each model; its existing disposal path releases it.
 * (The GP prototypes use the procedural R6 race shell, gp-race-bodywork.ts.) */
function buildGroup(
  materials: BikeMaterials,
  source: typeof bodywork.upperHigh,
  name: string,
): T.Group {
  const group = new T.Group();
  group.name = name;
  for (const part of source) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(part.position, 3));
    geometry.setAttribute('normal', new T.Float32BufferAttribute(part.normal, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(part.uv, 2));
    geometry.setIndex(part.index);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material =
      materials[
        part.material as 'paint' | 'secondary' | 'accent' | 'carbon' | 'dark' | 'seat' | 'aluminium'
      ];
    if (!material) throw new Error(`Unbound GP bodywork material: ${part.material}`);
    const mesh = new T.Mesh(geometry, material);
    mesh.name = `GP bodywork / ${part.material}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.authoredIn = 'Blender 5.2.2';
  group.userData.referenceRevision = 'motogp-100-r5-composite';
  return group;
}

/** Full-fairing catalogue bikes share the open instrument well, not the GP-R1
 * tank, tail or aero. The existing box-wing and road-bike identities remain. */
export function gpUpperCowl(materials: BikeMaterials, detail: RiderDetail): T.Group {
  return buildGroup(
    materials,
    detail === 'high' ? bodywork.upperHigh : bodywork.upperMid,
    `Open motorcycle instrument cowl (${detail})`,
  );
}
