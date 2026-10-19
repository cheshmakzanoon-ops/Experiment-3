import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** REF 017/074/076: a machined retaining ring surrounds a recessed anodised
 * adjuster. The original detailed screw was below both the closed fork tube
 * and its opaque cap. Keep every visible surface above the tube's 50 mm top,
 * within the former 31 mm radius / 75 mm height envelope. These are authored
 * dimensions; the images establish construction and material relationships. */
export function gpForkCrowns(
  detail: Exclude<RiderDetail, 'far'>,
  materials: Pick<BikeMaterials, 'aluminium' | 'forkUpper' | 'forkLower' | 'dark'>,
  forkOffset: number,
): T.Mesh[] {
  const meshes: T.Mesh[] = [],
    segments = detail === 'high' ? 32 : 16;
  const add = (name: string, geometry: T.BufferGeometry, material: T.Material, side: number) => {
    geometry.translate(side * 0.105, 0, forkOffset);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new T.Mesh(geometry, material);
    mesh.name = `GP ${side > 0 ? 'left' : 'right'} fork ${name}`;
    mesh.castShadow = mesh.receiveShadow = true;
    meshes.push(mesh);
  };
  for (const side of [-1, 1]) {
    // A closed annular profile has real inner walls and a narrow chamfer.
    // The centre is open: no hidden full disk can cover the adjuster again.
    const profile = [
      [0.0205, 0.0505],
      [0.0302, 0.0505],
      [0.031, 0.0513],
      [0.031, 0.0587],
      [0.0302, 0.0595],
      [0.0213, 0.0595],
      [0.0205, 0.0587],
      [0.0205, 0.0505],
    ].map(([r, y]) => new T.Vector2(r, y));
    add('retaining ring', new T.LatheGeometry(profile, segments), materials.aluminium, side);
    add(
      'recessed seat',
      new T.CylinderGeometry(0.0205, 0.0205, 0.004, segments / 2).translate(0, 0.053, 0),
      detail === 'high' ? materials.forkLower : materials.dark,
      side,
    );
    add(
      'preload hex',
      new T.CylinderGeometry(0.0165, 0.0165, 0.009, 6).translate(0, 0.0595, 0),
      materials.forkUpper,
      side,
    );
    if (detail === 'high') {
      // Two circular segments leave a 1.6 mm screwdriver slot. Its dark floor
      // is 1.5 mm below the head, rather than a raised stripe over a solid cap.
      const radius = 0.0065,
        halfSlot = 0.0008,
        start = Math.asin(halfSlot / radius);
      for (const half of [-1, 1]) {
        const shape = new T.Shape();
        for (let i = 0; i <= 10; i++) {
          const angle = start + ((Math.PI - start * 2) * i) / 10,
            x = Math.cos(angle) * radius,
            y = Math.sin(angle) * radius * half;
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        }
        shape.closePath();
        const head = new T.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false });
        head.rotateX(Math.PI / 2);
        head.translate(0, 0.068, 0);
        add('slotted adjuster', head, materials.aluminium, side);
      }
      add(
        'adjuster slot floor',
        new T.CylinderGeometry(radius, radius, 0.002, 16).translate(0, 0.0655, 0),
        materials.dark,
        side,
      );
    }
  }
  // The caller inserts these directly into its steering group. Its existing
  // rigid batching keeps the same material draws and articulation boundaries.
  return meshes;
}
