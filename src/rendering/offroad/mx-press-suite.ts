import * as T from 'three';

type Point = [number, number, number];

/** One recessed room above the upper bowl. Local +Z faces the course and
 * the opening is at Z=0. A baked light gradient keeps room lights visible
 * below the floodlit roof without adding lights or transparent window passes. */
export function mxPressSuite(width: number, bay: number, warm: boolean) {
  const positions: number[] = [],
    colours: number[] = [],
    indices: number[] = [];
  const color = new T.Color();
  const quad = (a: Point, b: Point, c: Point, d: Point, lower: number, upper = lower) => {
    const i = positions.length / 3;
    positions.push(...a, ...b, ...c, ...d);
    for (const hex of [lower, lower, upper, upper]) {
      color.setHex(hex);
      colours.push(color.r, color.g, color.b);
    }
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const panel = (x: number, y: number, w: number, h: number, z: number, low: number, high = low) =>
    quad(
      [x - w / 2, y, z],
      [x + w / 2, y, z],
      [x + w / 2, y + h, z],
      [x - w / 2, y + h, z],
      low,
      high,
    );
  const half = width * 0.5,
    top = 1.16,
    bottom = -1.16,
    back = -2.8;
  const wall = warm ? 0x98785a : 0x617887,
    shadow = warm ? 0x473f38 : 0x34404a;
  // Build both side returns, floor, soffit and a shaded back wall. They
  // give the front mullions real parallax from either side of the track.
  panel(0, bottom, width, top - bottom, back, shadow, wall);
  quad(
    [-half, bottom, 0],
    [-half, bottom, back],
    [-half, top, back],
    [-half, top, 0],
    shadow,
    wall,
  );
  quad([half, bottom, back], [half, bottom, 0], [half, top, 0], [half, top, back], shadow, wall);
  quad(
    [-half, bottom, 0],
    [half, bottom, 0],
    [half, bottom, back],
    [-half, bottom, back],
    0x242c32,
    shadow,
  );
  quad([-half, top, back], [half, top, back], [half, top, 0], [-half, top, 0], wall, shadow);

  // Offset divider and lit exit door break the rhythm of neighbouring suites.
  const hand = bay % 2 ? 1 : -1;
  const door = hand * width * 0.31;
  panel(door, bottom, 0.92, 1.95, back + 0.025, 0x363b3b, 0x505a59);
  panel(door, bottom + 1, 0.49, 0.47, back + 0.032, 0x202f37, 0x455c61);
  panel(door, 0.88, 0.32, 0.075, back + 0.04, 0x8ca998);
  for (const dx of [-1, 1]) {
    const x = dx * width * 0.24;
    quad(
      [x - 0.56, top - 0.04, -1.9],
      [x + 0.56, top - 0.04, -1.9],
      [x + 0.56, top - 0.04, -1.58],
      [x - 0.56, top - 0.04, -1.58],
      warm ? 0xffdfad : 0xd4e4f1,
    );
  }
  // The worktop has an illuminated leading edge and a darker fascia.
  panel(0, bottom, width - 0.38, 0.67, -0.72, 0x31383a, 0x565650);
  quad(
    [-half + 0.19, -0.49, -0.72],
    [half - 0.19, -0.49, -0.72],
    [half - 0.19, -0.49, -1.38],
    [-half + 0.19, -0.49, -1.38],
    0x747675,
    0x535859,
  );
  const desks = bay % 3 === 0 ? 1 : 2;
  for (let i = 0; i < desks; i++) {
    const x = (i - (desks - 1) * 0.5) * width * 0.37 - hand * 0.24;
    panel(x, -0.51, 0.05, 0.28, -1.06, 0x222b2d);
    panel(x, -0.31, 0.64, 0.38, -1.0, 0x263033);
    panel(x, -0.28, 0.57, 0.31, -0.99, 0x374b56, 0x78909a);
    // A seated operator in side profile. The bent shoulders, neck and crown
    // overlap behind the monitors and stay visible from an oblique camera.
    const px = x + hand * 0.36,
      z = -1.6;
    quad(
      [px - 0.22, -0.56, z],
      [px + 0.2, -0.56, z],
      [px + 0.15, -0.11, z],
      [px - 0.12, -0.04, z],
      0x293236,
      0x3d4849,
    );
    panel(px, -0.09, 0.094, 0.13, z, 0x574d43);
    const head: Point[] = [
      [-0.09, 0.02, z],
      [-0.11, 0.17, z],
      [-0.061, 0.24, z],
      [0.052, 0.25, z],
      [0.097, 0.19, z],
      [0.105, 0.07, z],
      [0.066, 0.018, z],
    ];
    const first = positions.length / 3;
    for (const [hx, hy, hz] of head) {
      positions.push(px + hx * hand, hy, hz);
      color.setHex(hy > 0.17 ? 0x373934 : 0x66584c);
      colours.push(color.r, color.g, color.b);
    }
    for (let k = 1; k < head.length - 1; k++) {
      if (hand > 0) indices.push(first, first + k + 1, first + k);
      else indices.push(first, first + k, first + k + 1);
    }
  }
  // Glazing bars sit in front of the occupied volume. Their support feet
  // meet the sill, and no full-window alpha quad can veil the crowd.
  for (const part of [-0.5, -0.17, 0.17, 0.5])
    panel(part * (width - 0.07), bottom, 0.065, top - bottom, 0.015, 0x2c3337, 0x475054);
  panel(0, 0.63, width, 0.044, 0.021, 0x42494a);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return geometry;
}
