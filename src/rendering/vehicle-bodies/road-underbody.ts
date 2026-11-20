import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { ClosedBodyModel } from './closed-body.ts';
import { sharedMaterials } from './materials.ts';
import type { Parts } from './parts.ts';
import type { Detail } from './wheel.ts';

const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);

function ease(t: number) {
  const a = clamp(t, 0, 1);
  return a * a * (3 - 2 * a);
}

/** A closed pressing with a hard normal at each fold and a continuous normal
 * around the sweep. Metre coordinates keep the carbon weave continuous along a band. */
function pressing(sections: T.Vector3[][]) {
  const position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const last = sections.length - 1,
    count = sections[0].length;
  const mid = (ring: T.Vector3[]) =>
    ring.reduce((a, b) => a.add(b), new T.Vector3()).divideScalar(ring.length);
  const direction = mid(sections[last]).sub(mid(sections[0]));
  const normal = new T.Vector3(),
    cross = new T.Vector3();
  const first = sections[0],
    center = mid(first);
  for (let j = 0; j < count; j++) {
    const a = first[j].clone().sub(center),
      b = first[(j + 1) % count].clone().sub(center);
    normal.add(cross.crossVectors(a, b));
  }
  const positive = normal.dot(direction) > 0;
  const triangle = (a: number, b: number, c: number) => {
    if (positive) index.push(a, b, c);
    else index.push(c, b, a);
  };
  const vertex = (p: T.Vector3, u: number, t: number) => {
    const i = position.length / 3;
    position.push(p.x, p.y, p.z);
    uv.push(u, t);
    return i;
  };
  for (let j = 0; j < count; j++) {
    const k = (j + 1) % count;
    let distance = 0;
    for (let i = 0; i <= last; i++) {
      const a = sections[i][j],
        b = sections[i][k];
      if (i > 0) distance += a.distanceTo(sections[i - 1][j]);
      const l = vertex(a, distance, 0),
        r = vertex(b, distance, a.distanceTo(b));
      if (i > 0) {
        triangle(l - 2, r - 2, l);
        triangle(r - 2, r, l);
      }
    }
  }
  // Triangulate the real section, including a concave return underneath a lip.
  const axes = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
  const axis = axes.indexOf(Math.max(...axes));
  const project = (p: T.Vector3) =>
    axis === 0
      ? new T.Vector2(p.y, p.z)
      : axis === 1
        ? new T.Vector2(p.z, p.x)
        : new T.Vector2(p.x, p.y);
  for (const i of [0, last]) {
    const ring = sections[i],
      path = ring.map(project),
      offset = position.length / 3;
    for (let j = 0; j < count; j++) vertex(ring[j], path[j].x, path[j].y);
    for (const tri of T.ShapeUtils.triangulateShape(path, [])) {
      const [a, b, c] = tri;
      const outward =
        ring[b].clone().sub(ring[a]).cross(ring[c].clone().sub(ring[a])).dot(direction) *
        (i === 0 ? -1 : 1);
      if (outward > 0) index.push(offset + a, offset + b, offset + c);
      else index.push(offset + c, offset + b, offset + a);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

export function roadSplitterStation(model: ClosedBodyModel, u: number) {
  const { f, s, zFront } = model,
    shoulder = ease((Math.abs(u) - 0.6) / 0.4);
  const width = model.halfWidth(zFront - 0.24) * 0.95;
  const x = width * u;
  const root = zFront - 0.022 - (0.21 + s.splitter * 0.35) * shoulder;
  const lip = root + 0.028 + s.splitter * (0.94 - shoulder * 0.18);
  const rear = root - 0.19 - 0.09 * shoulder;
  const y = f.y(s.floor + 0.032 + 0.026 * shoulder);
  return {
    x,
    root,
    lip,
    rear,
    y,
    attachment: model.control(root)[0][1] + 0.004 + 0.033 * shoulder,
  };
}

export function roadSplitter(model: ClosedBodyModel, detail: Detail) {
  const n = [24, 14, 8][detail];
  const rings = Array.from({ length: n + 1 }, (_, i) => {
    const { x, root, lip, rear, y, attachment } = roadSplitterStation(model, -1 + (2 * i) / n);
    return [
      v(x * 0.996, y + 0.016, rear),
      v(x * 0.977, attachment, root - 0.03),
      v(x * 0.984, attachment - 0.004, root),
      v(x, y + 0.015, lip - 0.009),
      v(x * 1.001, y + 0.011, lip),
      v(x, y + 0.003, lip - 0.002),
      v(x * 0.996, y, lip - 0.011),
      v(x * 0.997, y + 0.002, rear + 0.006),
    ];
  });
  return pressing(rings);
}

/** Attached lower tail pressing and the expanding underfloor outlet. Street
 * cars have shallow channels; the two high-downforce bodies carry deep strakes. */
export function addRoadUndertray(parts: Parts, model: ClosedBodyModel, detail: Detail) {
  const { f, s, zRear } = model;
  const span = model.halfWidth(zRear) * 0.87;
  const performance = s.diffuser >= 0.15;
  const bands = detail === 0 ? 20 : 12;
  const valance = Array.from({ length: bands + 1 }, (_, i) => {
    const u = -1 + (2 * i) / bands,
      bend = ease((Math.abs(u) - 0.7) / 0.3);
    const z = zRear + 0.09 * bend;
    const floor = model.control(z)[0][1];
    const opening =
      s.diffuser > 0 ? (1 - ease((Math.abs(u) - 0.58) / 0.23)) * (performance ? 0.035 : 0.017) : 0;
    const y = floor - 0.018 + opening + 0.023 * bend,
      x = u * span;
    return [
      v(x * 0.998, y + 0.051, z + 0.031),
      v(x, y + 0.046, z - 0.002),
      v(x * 1.002, y + 0.031, z - 0.014),
      v(x, y + 0.006, z - 0.015),
      v(x * 0.995, y, z - 0.007),
      v(x * 0.989, y + 0.002, z + 0.055),
    ];
  });
  parts.add(pressing(valance), sharedMaterials.plastic());
  if (s.diffuser <= 0) return;
  const length = clamp(s.overhang[1] - f.radius - 0.065, 0.22, performance ? 0.7 : 0.47);
  const exit = zRear - 0.025,
    throat = exit + length;
  const ribs = performance ? 5 : 3;
  const spanAt = (t: number) => span * (performance ? 0.8 : 0.66) * (0.8 + 0.2 * ease(t));
  const ceiling = (u: number, t: number) => {
    const z = throat - length * t;
    const floor = model.control(Math.max(zRear, z))[0][1];
    const barrel = Math.sin((u + 1) * Math.PI * (ribs - 1) * 0.5) ** 2;
    return floor - 0.012 - (0.007 + s.diffuser * 0.09) * barrel * (0.25 + 0.75 * t);
  };
  // A finite-gauge panel. Station rings travel from the forward throat to
  // the outlet, with the visible channel roof on the underside.
  const across = (ribs - 1) * (detail === 0 ? 4 : 2),
    stations = detail === 0 ? 7 : 4;
  const panel = Array.from({ length: stations + 1 }, (_, i) => {
    const t = i / stations,
      z = throat - length * t,
      wide = spanAt(t);
    const ring: T.Vector3[] = [];
    for (let j = 0; j <= across; j++) {
      const u = (2 * j) / across - 1;
      ring.push(v(u * wide, ceiling(u, t), z));
    }
    for (let j = across; j >= 0; j--) {
      const u = (2 * j) / across - 1;
      ring.push(v(u * wide, ceiling(u, t) + 0.009, z));
    }
    return ring;
  });
  const composite = sharedMaterials.carbonSatin();
  parts.add(pressing(panel), composite);
  for (let j = 0; j < ribs; j++) {
    const u = ((2 * j) / (ribs - 1) - 1) * 0.98;
    const rings = Array.from({ length: stations + 1 }, (_, i) => {
      const t = i / stations,
        z = throat - length * t;
      const x = u * spanAt(t),
        mount = ceiling(u, t) + 0.004;
      const depth =
        (performance ? 0.073 + s.diffuser * 0.19 : 0.026 + s.diffuser * 0.18) *
        (0.11 + 0.89 * ease(t)) *
        (1 - 0.18 * u * u);
      const tip = Math.max(f.y(s.floor - 0.006), mount - depth);
      return [
        v(x - 0.006, mount, z),
        v(x + 0.006, mount, z),
        v(x + 0.003, tip + 0.003, z),
        v(x, tip, z),
        v(x - 0.003, tip + 0.003, z),
      ];
    });
    parts.add(pressing(rings), composite);
  }
}
