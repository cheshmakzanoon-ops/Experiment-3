import * as T from 'three';
import { add, addGpRigidFinish, tube, type BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

type Profile = readonly (readonly [number, number])[];

/** An optical surface of revolution. +Z points forward along the optical axis. */
function turned(profile: Profile, sides: number) {
  return new T.LatheGeometry(
    profile.map(([r, z]) => new T.Vector2(r, z)),
    sides,
  ).rotateX(Math.PI / 2);
}

/** Moulded convex glass. The shallower upright facets on period lamps alter
 * the optical normal while the silhouette stays continuous around its bezel. */
function roundGlass(radius: number, detail: RiderDetail, fluted: boolean) {
  const sectors = detail === 'high' ? 64 : detail === 'mid' ? 32 : 16;
  const rings = detail === 'high' ? 8 : detail === 'mid' ? 5 : 2;
  const position = [0, 0, radius * 0.15],
    normals = [0, 0, 1],
    uv = [0.5, 0.5],
    index: number[] = [];
  const normal = new T.Vector3();
  for (let j = 1; j <= rings; j++) {
    const f = j / rings;
    for (let k = 0; k < sectors; k++) {
      const a = (k / sectors) * 2 * Math.PI,
        x = f * Math.cos(a),
        y = f * Math.sin(a);
      position.push(radius * x, radius * y, radius * 0.15 * (1 - f * f));
      const groove = fluted ? 0.12 * Math.sin(x * 37) * (1 - f * f) : 0;
      normal.set(0.3 * x + groove, 0.3 * y, 1).normalize();
      normals.push(normal.x, normal.y, normal.z);
      uv.push(0.5 + x / 2, 0.5 + y / 2);
      const start = 1 + (j - 1) * sectors,
        b = start + k,
        c = start + ((k + 1) % sectors);
      if (j === 1) index.push(0, b, c);
      else index.push(b - sectors, b, c, b - sectors, c, c - sectors);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

export function roundRoadLamp(m: BikeMaterials, detail: RiderDetail, period: boolean) {
  const root = new T.Group(),
    radius = period ? 0.066 : 0.088;
  root.name = period ? 'Classic faired headlight' : 'Steering-mounted roadster headlight';
  const sides = detail === 'high' ? 36 : detail === 'mid' ? 24 : 12;
  const profile = (p: Profile) =>
    turned(
      p.map(([r, z]) => [r * radius, z * radius] as const),
      sides,
    );
  add(
    root,
    profile([
      [0, -1.15],
      [0.42, -1.07],
      [0.79, -0.78],
      [0.96, -0.42],
      [1, -0.12],
      [1, -0.035],
    ]),
    period ? m.aluminium : m.dark,
  );
  add(
    root,
    profile([
      [0.985, -0.18],
      [1.025, -0.12],
      [1.03, -0.035],
      [1.005, 0.02],
      [0.923, 0.024],
      [0.908, -0.022],
    ]),
    m.aluminium,
  );
  // Work from the rim back to the bulb so the reflector faces forward.
  add(
    root,
    profile([
      [0.928, -0.035],
      [0.83, -0.16],
      [0.63, -0.31],
      [0.42, -0.411],
      [0.22, -0.463],
      [0, -0.48],
    ]),
    m.steel,
  );
  const emitter = add(
    root,
    new T.SphereGeometry(radius * 0.153, detail === 'high' ? 14 : 8, 8),
    m.roadLampEmitter(),
    0,
    0,
    -radius * 0.24,
    false,
  );
  emitter.scale.z = 1.45;
  if (detail === 'high') {
    // The bulb shield sits in front of the filament on two thin wire stays.
    for (const side of [-1, 1])
      add(
        root,
        tube(
          [
            [side * radius * 0.08, -radius * 0.03, -radius * 0.13],
            [side * radius * 0.19, -radius * 0.12, -radius * 0.25],
            [side * radius * 0.32, -radius * 0.31, -radius * 0.4],
          ],
          0.0014,
          4,
          5,
        ),
        m.steel,
      );
    const cap = add(
      root,
      new T.SphereGeometry(radius * 0.115, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      m.aluminium,
      0,
      0,
      -radius * 0.095,
    );
    cap.rotation.x = Math.PI / 2;
  }
  add(root, roundGlass(radius * 0.92, detail, period), m.screenLight, 0, 0, 0, false).name =
    'Pressed headlight cover';
  return root;
}

export function installRoadsterLamp(
  steer: T.Group,
  m: BikeMaterials,
  detail: RiderDetail,
  rake: number,
  forkOffset: number,
) {
  const lamp = roundRoadLamp(m, detail, false);
  lamp.position.set(0, -0.216, forkOffset + 0.185);
  // Upright at centre steer; only the stem, clamps and ears follow fork rake.
  lamp.rotation.x = rake + 0.028;
  addGpRigidFinish(steer, lamp, [m.dark, m.aluminium, m.steel, m.roadLampEmitter()]);
  if (detail === 'far') return;
  for (const sign of [-1, 1]) {
    const x = sign * 0.105;
    const y = -0.211,
      z = forkOffset + 0.133;
    add(
      steer,
      tube(
        [
          [x, -0.125, forkOffset],
          [x, -0.153, forkOffset + 0.055],
          [sign * 0.084, y, z],
        ],
        0.0058,
        5,
        6,
      ),
      m.dark,
    );
    add(
      steer,
      tube(
        [
          [x, -0.251, forkOffset],
          [x, -0.246, forkOffset + 0.055],
          [sign * 0.084, y, z],
        ],
        0.0058,
        5,
        6,
      ),
      m.dark,
    );
    add(
      steer,
      new T.CylinderGeometry(0.011, 0.011, 0.015, 8),
      m.steel,
      sign * 0.088,
      y,
      z,
    ).rotation.z = Math.PI / 2;
  }
}

type Station = readonly [number, number, number, number, number];
// Each station is measured once on the actual sport moulding at this LOD.
// Layout is independent of paint and entrant. Opposite sides share its tooling.
const stripStations = new Map<RiderDetail, readonly Station[]>();
function fittedStrip(body: T.Mesh, detail: RiderDetail) {
  const cached = stripStations.get(detail);
  if (cached) return cached;
  const ray = new T.Raycaster(),
    stations: Station[] = [];
  const steps = detail === 'high' ? 12 : detail === 'mid' ? 7 : 4;
  body.updateWorldMatrix(true, false);
  for (let j = 0; j <= steps; j++) {
    const t = j / steps,
      x = 0.042 + 0.108 * t,
      y = 0.13 + 0.046 * t + 0.012 * Math.sin(t * Math.PI);
    const h = 0.003 + 0.011 * Math.sin(Math.PI * t) ** 0.65;
    const surfaces: number[] = [];
    for (const edge of [-1, 1]) {
      ray.set(new T.Vector3(x, y + h * edge, 1.4), new T.Vector3(0, 0, -1));
      const hit = ray.intersectObject(body, false)[0];
      if (!hit) break;
      surfaces.push(hit.point.z);
    }
    if (surfaces.length === 2) stations.push([x, y, h, surfaces[0], surfaces[1]]);
  }
  stripStations.set(detail, stations);
  return stations;
}

function strip(
  stations: readonly Station[],
  side: number,
  halfHeight: number,
  shift: number,
  advance: number,
) {
  const p: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  for (const [x, y, h, low, high] of stations) {
    for (const v of [-1, 1]) {
      const f = v * halfHeight + shift;
      p.push(side * x, y + h * f, T.MathUtils.lerp(low, high, (f + 1) * 0.5) + advance);
      uv.push((x - 0.042) / 0.108, (v + 1) / 2);
    }
    const i = p.length / 3 - 2;
    if (i > 0) {
      if (side > 0) index.push(i - 2, i, i + 1, i - 2, i + 1, i - 1);
      else index.push(i - 2, i + 1, i, i - 2, i - 1, i + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export function installSportHeadlights(
  parent: T.Group,
  body: T.Mesh,
  m: BikeMaterials,
  detail: RiderDetail,
) {
  const stations = fittedStrip(body, detail);
  if (stations.length < 2) return;
  for (const side of [-1, 1]) {
    add(parent, strip(stations, side, 1, 0, 0.003), m.dark, 0, 0, 0, false);
    add(parent, strip(stations, side, 0.71, 0.01, 0.0048), m.aluminium, 0, 0, 0, false);
    add(parent, strip(stations, side, 0.19, 0.21, 0.0063), m.roadLampEmitter(), 0, 0, 0, false);
    if (detail !== 'far')
      add(parent, strip(stations, side, 0.83, 0, 0.0074), m.screenLight, 0, 0, 0, false);
  }
}
