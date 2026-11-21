import * as T from 'three';
import { valueNoise } from '../terrain-profile.ts';

/** A cut bank of tilted sedimentary beds. The joint planes continue through
 * neighbouring beds. Each softer seam retreats behind a projecting lip, so
 * the frontal relief, crown silhouette and oblique shadows agree. Local -Z
 * faces the course. The base follows the surveyed ground on both sides. */
export function mxQuarryFace(ground: (x: number, z: number) => number) {
  const positions: number[] = [],
    colours: number[] = [],
    indices: number[] = [];
  const stone = new T.Color(0xb1a99a),
    iron = new T.Color(0xa5846c),
    seam = new T.Color(0x696457),
    turf = new T.Color(0x81815d);
  const colour = new T.Color();
  const columns = 48,
    width = 16.8;
  const beds = [0, 0.14, 0.37, 0.47, 0.71, 0.87, 1];
  const jointPlanes = [-6.25, -3.7, -0.7, 2.55, 5.5];
  const rows = 1 + (beds.length - 1) * 4 + 5;
  for (let column = 0; column <= columns; column++) {
    const x = (column / columns - 0.5) * width;
    const edge = 1 - T.MathUtils.smoothstep(Math.abs(x), 4.6, 8.75);
    const front = -1.3 - 0.85 * edge - valueNoise(x * 0.4, 8.2) * 0.85;
    const back = 0.8 + 1.9 * edge + 0.55 * valueNoise(x * 0.5, 2.1);
    const frontFloor = ground(x, front),
      backFloor = ground(x, back);
    const brokenCrest = 0.51 * valueNoise(x * 1.5, 4.3) + 0.25 * Math.sin(x * 1.37 + 1);
    const crown =
      0.32 +
      edge * (3.24 + 1.5 * valueNoise(x * 0.26 + 1.8, 0.6) + brokenCrest) +
      0.36 * (x / width + 0.5);
    const vertex = (y: number, z: number, tint: T.Color, brightness = 1) => {
      positions.push(x, y, z);
      colours.push(tint.r * brightness, tint.g * brightness, tint.b * brightness);
    };
    vertex(frontFloor - 0.52, front - 0.25, seam);
    for (let bed = 0; bed < beds.length - 1; bed++) {
      // Softer sections weather flush. An unbroken ledge across the whole
      // cutting reads as a constructed retaining wall from the racing line.
      const hardness = T.MathUtils.smoothstep(
        valueNoise(x * 0.45 + bed * 3.1, bed * 1.7),
        0.28,
        0.74,
      );
      for (const [fraction, relief] of [
        [0, 0.1],
        [0.12, -0.04],
        [0.83, -0.06],
        [0.96, -0.15],
      ]) {
        const t = T.MathUtils.lerp(beds[bed], beds[bed + 1], fraction);
        const strata =
          Math.sin(x * 0.72 + bed * 0.74) * 0.11 + (valueNoise(x * 0.77, bed * 0.72) - 0.5) * 0.18;
        const y = frontFloor + t * crown + strata * edge;
        let joint = 0;
        for (let i = 0; i < jointPlanes.length; i++) {
          const distance = Math.abs(x - jointPlanes[i] - (y - frontFloor) * (i % 2 ? 0.28 : -0.16));
          joint = Math.max(joint, 1 - T.MathUtils.smoothstep(distance, 0.025, 0.4));
        }
        const rough = valueNoise(x * 1.2 + y * 0.35, y * 0.9 + 7.2);
        const fracture = valueNoise(x * 0.82 - t * 0.98, t * 3.9 + 2.8);
        const z =
          front +
          0.74 * t +
          relief * (0.12 + 0.88 * hardness) +
          joint * 0.55 +
          (fracture - 0.5) * 0.69 +
          (rough - 0.5) * 0.23;
        colour.copy(stone).lerp(iron, 0.15 + 0.5 * valueNoise(x * 0.46, bed + 0.3));
        if (fraction === 0) colour.lerp(seam, 0.21 + 0.24 * hardness);
        vertex(y, z, colour, (0.84 + rough * 0.22) * (1 - joint * 0.29));
      }
    }
    // A shallow turf cap drapes away from the exposed face to buried rock.
    for (const [t, h] of [
      [0, 1],
      [0.22, 1.025],
      [0.54, 0.88],
      [0.82, 0.47],
      [1, 0],
    ]) {
      const z = T.MathUtils.lerp(front + 0.74, back, t);
      const y = T.MathUtils.lerp(frontFloor, backFloor, t) + h * crown - 0.42 * t;
      const moss = valueNoise(x * 0.62 + 5.8, z * 0.9);
      colour.copy(stone).lerp(turf, 0.25 + 0.6 * moss);
      vertex(y, z, colour, 0.86 + 0.18 * moss);
    }
    if (column === 0) continue;
    const start = (column - 1) * rows;
    for (let row = 0; row < rows - 1; row++) {
      const a = start + row,
        b = a + rows;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // Both end faces terminate against the bank. Close them independently to
  // preserve their cross-fracture normals when the camera looks along it.
  for (const column of [0, columns]) {
    const first = positions.length / 3,
      start = column * rows;
    for (let row = 0; row < rows; row++) {
      const j = (start + row) * 3;
      positions.push(positions[j], positions[j + 1], positions[j + 2]);
      colours.push(colours[j] * 0.82, colours[j + 1] * 0.82, colours[j + 2] * 0.82);
    }
    const outline = Array.from({ length: rows }, (_, row) => {
      const j = (start + row) * 3;
      return new T.Vector2(positions[j + 1], positions[j + 2]);
    });
    for (const [a, b, c] of T.ShapeUtils.triangulateShape(outline, [])) {
      if (column === 0) indices.push(first + a, first + c, first + b);
      else indices.push(first + a, first + b, first + c);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
