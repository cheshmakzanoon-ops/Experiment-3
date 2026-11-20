import * as T from 'three';
import type { ClosedBodyModel } from './closed-body.ts';
import type { CarMaterials } from './common.ts';
import { rodGeometry, roundedBox } from './loft.ts';
import { sharedMaterials } from './materials.ts';
import { Parts, placed } from './parts.ts';
import type { Detail } from './wheel.ts';

const dimensions = {
  sport: {
    width: 0.203,
    height: 0.091,
    length: 0.145,
    rise: 0.076,
    offset: 0.035,
    roundness: 0.76,
  },
  touring: {
    width: 0.217,
    height: 0.123,
    length: 0.162,
    rise: 0.079,
    offset: 0.041,
    roundness: 0.65,
  },
  work: { width: 0.246, height: 0.164, length: 0.185, rise: 0.099, offset: 0.064, roundness: 0.57 },
  bullet: {
    width: 0.141,
    height: 0.122,
    length: 0.178,
    rise: 0.072,
    offset: 0.026,
    roundness: 0.98,
  },
} as const;

/** Glass, gasket, casing and stem share one mounting frame referenced to
 * the finished body shell. The glass faces aft and toes in towards the driver. */
export function roadMirrorLayout(model: ClosedBodyModel) {
  const form = model.s.mirrorForm!;
  const spec = dimensions[form];
  const z = model.f.z(model.s.cabin[0]) - (form === 'work' ? 0.22 : 0.12);
  const anchorX = model.halfWidth(z) * (form === 'work' ? 0.88 : 0.81);
  const anchorY = model.surfaceY(z, anchorX);
  return {
    ...spec,
    form,
    z,
    anchorX,
    anchorY,
    x: model.halfWidth(z) + spec.offset,
    y: anchorY + spec.rise,
  };
}
type Layout = ReturnType<typeof roadMirrorLayout>;
/** Profile ring [half-width factor, half-height factor, longitudinal position
 * in housing lengths]. Winding follows the mirrored car's exterior. */
type Ring = readonly [number, number, number];
function skin(layout: Layout, side: number, rings: readonly Ring[], steps: number) {
  const points: number[] = [],
    indices: number[] = [];
  const toe = layout.form === 'work' ? 0.13 : 0.2;
  const ct = Math.cos(toe),
    st = Math.sin(toe);
  const starts: number[] = [];
  for (const [w, h, depth] of rings) {
    starts.push(points.length / 3);
    for (let i = 0; i < (w === 0 ? 1 : steps); i++) {
      const a = (i * 2 * Math.PI) / steps,
        c = Math.cos(a),
        s = Math.sin(a);
      const u = Math.sign(c) * Math.abs(c) ** layout.roundness;
      const v = Math.sign(s) * Math.abs(s) ** layout.roundness;
      const x = u * w * layout.width * 0.5;
      const y = v * h * layout.height * 0.5 * (1 - 0.1 * u) + u * w * layout.height * 0.068;
      const z = depth * layout.length - w * layout.length * 0.055 * u;
      points.push(side * (layout.x + x * ct + z * st), layout.y + y, layout.z + z * ct - x * st);
    }
  }
  const triangle = (a: number, b: number, c: number) => {
    if (side > 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  for (let ring = 0; ring + 1 < rings.length; ring++) {
    const first = starts[ring],
      next = starts[ring + 1];
    for (let i = 0; i < steps; i++) {
      const j = (i + 1) % steps;
      if (!rings[ring][0]) triangle(first, next + i, next + j);
      else if (!rings[ring + 1][0]) triangle(first + i, next, first + j);
      else {
        triangle(first + i, next + i, first + j);
        triangle(first + j, next + i, next + j);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function addRoadMirrors(
  parts: Parts,
  model: ClosedBodyModel,
  mats: CarMaterials,
  detail: Detail,
) {
  const layout = roadMirrorLayout(model);
  const steps = detail === 0 ? 24 : detail === 1 ? 14 : 8;
  const trim = sharedMaterials.trim(),
    chrome = sharedMaterials.chrome();
  for (const side of [-1, 1]) {
    const base = new T.Vector3(side * layout.anchorX, layout.anchorY - 0.008, layout.z + 0.045);
    const neck = new T.Vector3(
      side * (layout.x - 0.31 * layout.width),
      layout.y - 0.24 * layout.height,
      layout.z + 0.018,
    );
    parts.add(
      rodGeometry(base, neck, layout.form === 'work' ? 0.025 : 0.018, detail === 0 ? 10 : 6),
      layout.form === 'bullet' ? chrome : trim,
    );
    if (detail < 2)
      parts.add(
        roundedBox(0.082, 0.024, 0.105, 0.01, 1),
        trim,
        placed(base.x, base.y + 0.011, base.z),
      );
    parts.add(
      skin(
        layout,
        side,
        [
          [0, 0, 0.63],
          [0.43, 0.5, 0.54],
          [0.8, 0.85, 0.32],
          [1, 1, -0.13],
          [0.99, 0.98, -0.36],
        ],
        steps,
      ),
      layout.form === 'bullet' ? chrome : mats.paint,
    );
    parts.add(
      skin(
        layout,
        side,
        [
          [0.99, 0.98, -0.36],
          [0.98, 0.97, -0.41],
          [0.9, 0.865, -0.415],
          [0.885, 0.85, -0.361],
        ],
        steps,
      ),
      trim,
    );
    // A recessed convex pane stands slightly proud at its optical centre.
    parts.add(
      skin(
        layout,
        side,
        [
          [0.886, 0.852, -0.362],
          [0.53, 0.51, -0.384],
          [0, 0, -0.397],
        ],
        steps,
      ),
      chrome,
    );
  }
}
