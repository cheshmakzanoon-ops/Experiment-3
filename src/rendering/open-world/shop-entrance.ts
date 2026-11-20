import type { FacadeSink, Point3 } from './facade-layout.ts';

/** Glazed street entrance and sidelights. Frame depth, threshold and pull
 * are in metres, independent of the width of the commercial bay. */
export function entranceLeafWidth(width: number) {
  return Math.min(1.08, width * 0.58);
}

export function addShopEntrance(
  sink: FacadeSink,
  at: (u: number, v: number, d?: number) => Point3,
  tangent: Point3,
  normal: Point3,
  centre: number,
  bottom: number,
  width: number,
  height: number,
  style: number,
  kind: number,
) {
  const half = entranceLeafWidth(width) * 0.5;
  const frame = 0x4b5556,
    steel = 0xa1a7a7,
    rubber = 0x353c39;
  const uv = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;
  const box = (
    u: number,
    v: number,
    d: number,
    w: number,
    h: number,
    depth: number,
    color: number,
    finish = 0,
  ) => {
    const x0 = centre + u - w / 2,
      x1 = x0 + w,
      y0 = bottom + v - h / 2,
      y1 = y0 + h,
      z0 = d - depth / 2,
      z1 = z0 + depth;
    const tag = [style, kind, -6, finish] as const;
    const face = (p: Point3[], n: Point3) => sink.quad(p, n, uv, color, tag);
    face([at(x0, y0, z1), at(x1, y0, z1), at(x1, y1, z1), at(x0, y1, z1)], normal);
    face(
      [at(x1, y0, z0), at(x0, y0, z0), at(x0, y1, z0), at(x1, y1, z0)],
      [-normal[0], 0, -normal[2]],
    );
    face([at(x1, y0, z1), at(x1, y0, z0), at(x1, y1, z0), at(x1, y1, z1)], tangent);
    face(
      [at(x0, y0, z0), at(x0, y0, z1), at(x0, y1, z1), at(x0, y1, z0)],
      [-tangent[0], 0, -tangent[2]],
    );
    face([at(x0, y1, z1), at(x1, y1, z1), at(x1, y1, z0), at(x0, y1, z0)], [0, 1, 0]);
    face([at(x0, y0, z0), at(x1, y0, z0), at(x1, y0, z1), at(x0, y0, z1)], [0, -1, 0]);
  };
  const doorHead = height * 0.84;
  // The front of the laminated glass is at -0.21 m. Its glazing beads,
  // gasket, and outer stiles sit at successive depths in that reveal.
  for (const x of [-width / 2 + 0.024, width / 2 - 0.024, -half, half]) {
    box(x, height / 2, -0.17, 0.046, height, 0.07, frame);
    box(x, height / 2, -0.13, 0.014, height, 0.012, rubber);
  }
  box(0, height - 0.026, -0.17, width, 0.052, 0.07, frame);
  box(0, doorHead, -0.166, width, 0.06, 0.073, frame);
  box(0, 0.025, -0.096, width, 0.05, 0.22, steel, 1);
  box(0, 0.14, -0.179, 2 * half - 0.058, 0.22, 0.02, steel, 1);
  const hand = half - 0.105;
  for (const y of [0.91, 1.24]) box(hand, y, -0.147, 0.037, 0.038, 0.102, steel, 1);
  // The square-section pull sits forward of the glass on its two return brackets.
  box(hand, 1.075, -0.084, 0.025, 0.37, 0.027, steel, 1);
}
