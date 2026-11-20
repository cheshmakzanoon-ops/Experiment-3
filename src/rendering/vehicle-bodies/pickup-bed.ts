import * as T from 'three';
import type { ClosedBodyModel } from './closed-body.ts';
import type { CarMaterials } from './common.ts';
import { loftRings, roundedBox, type Pt, type Ring } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

/** The opening ends at the actual headboard and tailgate. All three body
 * lofts include these two stations, so the load box meets the outer skin. */
export function pickupBedBounds(model: ClosedBodyModel) {
  return {
    rear: model.zRear + 0.13,
    front: model.f.z(model.s.cabin[3]) - 0.135,
  };
}

/** Close a transverse end against the original deck cross-section. The
 * original top lip can have camber across its width. */
function endPanel(original: readonly Pt[], liner: readonly Pt[], z: number, front: boolean) {
  const half = [...original, ...liner.slice(1).reverse()].map(([x, y]) => new T.Vector2(x, y));
  const triangles = T.ShapeUtils.triangulateShape(half, []);
  const positions: number[] = [];
  for (const side of [-1, 1])
    for (const triangle of triangles) {
      // triangulateShape winds CCW (+Z); the headboard looks towards -Z.
      for (const index of (front ? side > 0 : side < 0) ? [...triangle].reverse() : triangle) {
        const p = half[index];
        positions.push(side * p.x, p.y, z);
      }
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Stamped load box with a corrugated floor between the wheel tubs. Both
 * tubs follow the same rear axle and tyre radius that drive the live wheels.
 * Geometry joins the existing plastic and body-colour draws. */
export function addPickupBed(
  parts: Parts,
  model: ClosedBodyModel,
  rings: Ring[],
  detail: Detail,
  mats: CarMaterials,
) {
  const { rear, front } = pickupBedBounds(model);
  const deck = model.deckSample(detail);
  const profiles = rings.filter((ring) => ring.z >= rear && ring.z <= front);
  const floor = model.f.y(model.s.loadFloor!);
  const radius = model.f.radius;
  const innerTub = model.f.trackRear / 2 - model.s.wheels.width[1] / 2 - 0.075;
  const liner: Ring[] = profiles.map(({ z, half }) => {
    const [edge, top] = half[deck];
    const rail = edge - 0.085;
    const longitudinal = Math.abs(z - model.f.rearAxle) / (radius + 0.17);
    const lift =
      longitudinal >= 1
        ? 0
        : (1 - longitudinal ** 2) ** 2 * Math.max(0, model.f.hubRear + radius + 0.13 - floor);
    const section: Pt[] = [
      [edge, top],
      [edge - 0.016, top + 0.005],
      [rail + 0.012, top + 0.005],
      [rail, top - 0.009],
      [rail - 0.005, top - 0.035],
      [rail - 0.018, floor + 0.032 + lift],
      [rail - 0.04, floor + 0.012 + lift],
      [innerTub + 0.075, floor + 0.012 + lift],
      [innerTub + 0.035, floor + 0.01 + lift * 0.84],
      [innerTub, floor + 0.008 + lift * 0.14],
      [innerTub - 0.025, floor],
    ];
    // Longitudinal pressings are part of the floor. Coarser silhouettes
    // retain the full cavity and tubs as the ribs become subpixel.
    if (detail < 2)
      for (let rib = 4; rib >= 0; rib--) {
        const x = ((rib + 0.5) * (innerTub - 0.045)) / 5;
        section.push(
          [x + 0.033, floor],
          [x + 0.021, floor + 0.012],
          [x - 0.021, floor + 0.012],
          [x - 0.033, floor],
        );
      }
    section.push([0, floor]);
    return { z, half: section };
  });
  const plastic = sharedMaterials.plastic();
  parts.add(loftRings(liner, { closed: false, material: (_, j) => (j < 2 ? 0 : -1) }), mats.paint);
  parts.add(
    loftRings(liner, { closed: false, material: (_, j) => (j >= 2 && j < 10 ? 0 : -1) }),
    plastic,
  );
  // The inboard floor is a constant extrusion. Subdivide only the curved
  // wheel tubs and rails along the length of the box.
  parts.add(
    loftRings([liner[0], liner[liner.length - 1]], {
      closed: false,
      material: (_, j) => (j >= 10 ? 0 : -1),
    }),
    plastic,
  );
  for (const end of [0, liner.length - 1])
    parts.add(
      endPanel(profiles[end].half.slice(deck), liner[end].half, liner[end].z, end !== 0),
      plastic,
    );
  if (detail === 2) return;
  // Tailgate release, bumper tread and plate recess are sized in metres;
  // the bumper's step corners project past the tail skin.
  const z = model.zRear,
    halfWidth = model.halfWidth(z);
  const top = model.topY(z),
    base = model.f.y(model.s.floor + 0.14);
  parts.add(roundedBox(0.24, 0.082, 0.024, 0.015, 2), plastic, placed(0, top - 0.105, z - 0.016));
  parts.add(
    roundedBox(0.145, 0.025, 0.012, 0.007, 2),
    sharedMaterials.trim(),
    placed(0, top - 0.089, z - 0.033),
  );
  parts.add(
    roundedBox(halfWidth * 1.97, 0.125, 0.205, 0.04, 2),
    plastic,
    placed(0, base, z - 0.025),
  );
  for (const side of [-1, 1]) {
    parts.add(
      roundedBox(0.31, 0.035, 0.225, 0.014, 2),
      sharedMaterials.trim(),
      placed(side * (halfWidth - 0.215), base + 0.068, z - 0.046),
    );
  }
  parts.add(
    roundedBox(0.35, 0.115, 0.012, 0.01, 2),
    sharedMaterials.steel(),
    placed(0, base + 0.018, z - 0.131),
  );
}
