import * as T from 'three';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** Height of the GP outer fork tubes' open top in the steering frame (m): the
 * tube stands 12 mm proud of the 24 mm top clamp (clamp top at y = 0.022). */
export const GP_FORK_TUBE_TOP = 0.034;

/** REF 017/074/076: from the rider's eye the fork tops are a low, machined
 * natural-aluminium cap ring around a dark anodised recess, a small preload
 * hex and a slotted rebound adjuster, all barely proud of the top clamp. The
 * former 20 mm stack (gold hex on a tall tube, 48 mm above the clamp) filled
 * the onboard view like a toy. Every surface stays within a 29 mm radius and
 * 34-49 mm above the steering datum. The images establish construction and
 * material relationships; these are authored dimensions. */
export const GP_FORK_CROWN = Object.freeze({
  ringBottom: GP_FORK_TUBE_TOP,
  ringTop: 0.0425,
  ringOuter: 0.029,
  ringInner: 0.0195,
  seatTop: 0.0395,
  hexTop: 0.0455,
  hexRadius: 0.0115,
  screwTop: 0.0485,
  screwRadius: 0.0055,
  slotFloor: 0.047,
});

export function gpForkCrowns(
  detail: Exclude<RiderDetail, 'far'>,
  materials: Pick<BikeMaterials, 'aluminium' | 'forkUpper' | 'forkLower' | 'dark' | 'steel'>,
  forkOffset: number,
): T.Mesh[] {
  const meshes: T.Mesh[] = [],
    segments = detail === 'high' ? 32 : 16,
    c = GP_FORK_CROWN;
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
    // A closed annular profile with a machined outer chamfer and an inner
    // bore wall. The centre is open: no full disk can cover the adjuster.
    const profile = [
      [c.ringInner, c.ringBottom],
      [c.ringOuter - 0.0006, c.ringBottom],
      [c.ringOuter, c.ringBottom + 0.0008],
      [c.ringOuter, c.ringTop - 0.0022],
      [c.ringOuter - 0.0022, c.ringTop],
      [c.ringInner + 0.0008, c.ringTop],
      [c.ringInner, c.ringTop - 0.0008],
      [c.ringInner, c.ringBottom],
    ].map(([r, y]) => new T.Vector2(r, y));
    add('retaining ring', new T.LatheGeometry(profile, segments), materials.aluminium, side);
    add(
      'recessed seat',
      new T.CylinderGeometry(c.ringInner, c.ringInner, 0.003, segments / 2).translate(
        0,
        c.seatTop - 0.0015,
        0,
      ),
      materials.dark,
      side,
    );
    add(
      'preload hex',
      new T.CylinderGeometry(c.hexRadius, c.hexRadius, c.hexTop - c.seatTop, 6).translate(
        0,
        (c.hexTop + c.seatTop) / 2,
        0,
      ),
      materials.steel,
      side,
    );
    if (detail === 'high') {
      // Two circular segments leave a 1.4 mm screwdriver slot whose dark
      // floor is 1.5 mm below the anodised head.
      const radius = c.screwRadius,
        halfSlot = 0.0007,
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
        const head = new T.ExtrudeGeometry(shape, {
          depth: c.screwTop - c.hexTop,
          bevelEnabled: false,
        });
        head.rotateX(Math.PI / 2);
        head.translate(0, c.screwTop, 0);
        add('slotted adjuster', head, materials.forkLower, side);
      }
      add(
        'adjuster slot floor',
        new T.CylinderGeometry(radius, radius, 0.0015, 16).translate(0, c.slotFloor - 0.00075, 0),
        materials.dark,
        side,
      );
    }
  }
  // The caller inserts these directly into its steering group. Its existing
  // rigid batching keeps the same material draws and articulation boundaries.
  return meshes;
}
