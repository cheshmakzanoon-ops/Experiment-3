import * as T from 'three';
import { H, R, RACE_BASE, carBase } from '../simulation/protocol.ts';
import { trackPoint, type Track } from '../simulation/track.ts';
import { VEHICLES, VEHICLE_IDS, vehicleAt } from '../simulation/vehicles.ts';
import { installCircuitFinish } from './circuit-finish.ts';
import { installCarGrounding } from './studio/car-grounding.ts';
import { surfaceGridFor } from './studio/road-detail.ts';
import { tagWeatherSurface } from './weather-presentation.ts';

/** The fixed front-axle witness is calibrated to the championship chassis.
 * The homologated pit straight keeps the same paint for the feeder classes. */
export const FORMULA_GRID_AXLE = VEHICLES.apx01.wheelPositions[0][2];

export function formulaGridForFrame(frame: Float32Array) {
  const count = frame[H.CARS];
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 12 ||
    frame.length <= carBase(count - 1) + RACE_BASE + R.VEHICLE
  )
    return false;
  for (let id = 0; id < count; id++) {
    const car = frame[carBase(id) + RACE_BASE + R.VEHICLE];
    if (!Number.isInteger(car) || car < 0 || car >= VEHICLE_IDS.length || !vehicleAt(car).drs)
      return false;
  }
  return true;
}

const strokes = [
  [-0.085, 0.31, 0.085, 0.31],
  [0.105, 0.285, 0.105, 0.165],
  [0.105, 0.125, 0.105, 0.005],
  [-0.085, -0.019, 0.085, -0.019],
  [-0.105, 0.125, -0.105, 0.005],
  [-0.105, 0.285, -0.105, 0.165],
  [-0.082, 0.145, 0.082, 0.145],
] as const;
const digits = [
  '012345',
  '12',
  '01643',
  '01623',
  '5612',
  '05623',
  '056432',
  '012',
  '0123456',
  '012356',
];

/** Numbered, flush grid paint in one indexed draw. Each vertex lies on the
 * surveyed bank at its own station, including the long optical pickup guides. */
export function formulaGridGeometry(track: Track) {
  const grid = surfaceGridFor(track);
  const positions: number[] = [],
    colors: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const white = new T.Color(0xe4e5dc),
    amber = new T.Color(0xe7be55);
  const p = trackPoint();

  function quad(
    s: number,
    lateral: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
    width: number,
    color: T.Color,
  ) {
    const norm = (0.5 * width) / Math.hypot(bx - ax, bz - az);
    const x = (bz - az) * norm,
      z = (ax - bx) * norm;
    const start = positions.length / 3;
    for (const [u, v] of [
      [ax + x, az + z],
      [ax - x, az - z],
      [bx + x, bz + z],
      [bx - x, bz - z],
    ]) {
      // Graphics-space U grows toward the driver's right. Track lateral grows left.
      const across = lateral - u,
        station = s + v;
      track.at(station, p);
      positions.push(p.x + p.nx * across, p.y + p.bank * across + 0.007, p.z + p.nz * across);
      colors.push(color.r, color.g, color.b);
      uv.push(across / 5, station / 5);
    }
    indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
  }

  for (let slot = 0; slot < grid.rows * 2; slot++) {
    const s = track.length - grid.front - Math.floor(slot / 2) * grid.spacing;
    const side = slot % 2 === 0 ? 1 : -1;
    const lateral = -side * grid.lateral;
    const edge = 1.13,
      front = FORMULA_GRID_AXLE + 0.36;
    quad(s, lateral, -edge, front, edge, front, 0.085, white);
    for (const u of [-edge, edge]) {
      quad(s, lateral, u, front - 0.045, u, front - 1.22, 0.085, white);
      quad(s, lateral, u, -1.9, u, -1.36, 0.085, white);
    }
    // A marshal can judge the hub against this outboard witness even with
    // mechanics around the nose. The long perpendicular stroke is seen on approach.
    quad(
      s,
      lateral,
      side * (edge + 0.095),
      FORMULA_GRID_AXLE,
      side * (edge + 0.69),
      FORMULA_GRID_AXLE,
      0.075,
      amber,
    );
    quad(
      s,
      lateral,
      side * (edge + 0.65),
      FORMULA_GRID_AXLE + 0.043,
      side * (edge + 0.65),
      front + 0.66,
      0.063,
      amber,
    );
    const printed = String(slot + 1);
    for (let i = 0; i < printed.length; i++) {
      const origin = side * (edge + 0.35) + (i - (printed.length - 1) / 2) * 0.29;
      for (const line of digits[Number(printed[i])]) {
        const [x1, y1, x2, y2] = strokes[Number(line)];
        quad(
          s,
          lateral,
          origin + x1,
          front + 0.08 + y1,
          origin + x2,
          front + 0.08 + y2,
          0.039,
          white,
        );
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function formulaGridPaint(track: Track) {
  const material = tagWeatherSurface(
    new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.64,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
    'paint',
    1,
  );
  installCircuitFinish(material, 'paint');
  installCarGrounding(material);
  const mesh = new T.Mesh(formulaGridGeometry(track), material);
  mesh.name = 'Formula grid numerals and front-axle witnesses';
  mesh.receiveShadow = true;
  return mesh;
}
