import { NOSE_SECTIONS, suspensionMount } from '../src/rendering/car-surfaces.ts';
import { WHEEL_POSITIONS } from '../src/simulation/vehicle.ts';
import { ventilatedBrakeGeometry } from '../src/rendering/manufacturing.ts';
import { sculptedLoft } from '../src/rendering/bodywork.ts';
/** Export the shared APX-01 dimensional contract for Blender, never physics data.
 * node --experimental-transform-types scripts/apx01-seed.ts output.json */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cockpitShell } from '../src/rendering/geometry.ts';
import { FLOOR_STATIONS, floorGeometry, floorFenceGeometry } from '../src/rendering/car-floor.ts';
import {
  FRONT_SURFACES,
  REAR_SURFACES,
  FRONT_ENDPLATE,
  REAR_ENDPLATE,
  FRONT_PYLON,
  FRONT_SPACERS,
  addAirbox,
  addSafetyCell,
} from '../src/rendering/car-architecture.ts';
import { mirrorShellGeometry } from '../src/rendering/cockpit.ts';
import { wingElement } from '../src/rendering/bodywork.ts';
const paint = new T.MeshStandardMaterial(),
  carbon = new T.MeshStandardMaterial(),
  dark = new T.MeshStandardMaterial();
const parts: Record<string, unknown> = {};
function record(name: string, g: T.BufferGeometry) {
  const p = g.getAttribute('position'),
    n = g.getAttribute('normal'),
    uv = g.getAttribute('uv');
  parts[name] = {
    position: Array.from(p.array),
    normal: Array.from(n.array),
    uv: uv ? Array.from(uv.array) : new Array(p.count * 2).fill(0),
    index: g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i),
  };
  g.dispose();
}
function collect(group: T.Group, prefix: string, material: T.Material) {
  const geometries: T.BufferGeometry[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o instanceof T.Mesh && o.material === material) {
      const copy = o.geometry.clone().applyMatrix4(o.matrixWorld);
      geometries.push(copy.index ? copy.toNonIndexed() : copy);
      if (copy.index) copy.dispose();
    }
  });
  if (geometries.length) record(prefix, mergeGeometries(geometries));
  geometries.forEach((g) => g.dispose());
}
record('nose', sculptedLoft(NOSE_SECTIONS, 0, 0.32));
record('brake_rotor', ventilatedBrakeGeometry());
record('monocoque', cockpitShell());
record('floor', floorGeometry());
record('mirror_shell', mirrorShellGeometry());
const fences = new T.Group();
for (const s of [-1, 1]) {
  fences.add(new T.Mesh(floorFenceGeometry(s * 0.97, 0, 5, 0.042), carbon));
  for (const a of [0.25, 0.5, 0.76])
    fences.add(new T.Mesh(floorFenceGeometry(s * a, 0, 2, 0.082), carbon));
}
collect(fences, 'floor_edges', carbon);
const safety = new T.Group();
addSafetyCell(safety, carbon, 'high');
collect(safety, 'safety', carbon);
const airbox = new T.Group();
addAirbox(airbox, paint, carbon, dark, 'high');
for (const [n, m] of [
  ['paint', paint],
  ['carbon', carbon],
  ['dark', dark],
] as const)
  collect(airbox, `airbox_${n}`, m);
const beam = new T.Group();
for (const [w, c, y, z] of [
  [1.41, 0.23, -0.12, -2.06],
  [1.36, 0.17, -0.05, -2.18],
]) {
  const o = new T.Mesh(wingElement(w, c, 0.018, 0.011, 0.015, 0.008), carbon);
  o.position.set(0, y, z);
  beam.add(o);
}
collect(beam, 'beam', carbon);
const destination = resolve(process.argv[2] ?? 'test-results/apx01-seed.json');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(
  destination,
  JSON.stringify({
    parts,
    suspension: WHEEL_POSITIONS.flatMap((p, i) =>
      [-0.075, 0.055].flatMap((dy) =>
        [-0.3, 0.3].map((dz) => ({
          anchor: suspensionMount(p[0], p[2], dy, dz).toArray(),
          end: [p[0] - Math.sign(p[0]) * ((i < 2 ? 0.155 : 0.19) + 0.028), -0.183 + dy, p[2]],
        })),
      ),
    ),
    floorStations: FLOOR_STATIONS,
    front: FRONT_SURFACES,
    rear: REAR_SURFACES,
    frontEndplate: FRONT_ENDPLATE,
    frontPylon: FRONT_PYLON,
    frontSpacers: FRONT_SPACERS,
    rearEndplate: REAR_ENDPLATE,
  }),
);
for (const g of [fences, safety, airbox, beam])
  g.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });
[paint, carbon, dark].forEach((m) => m.dispose());
