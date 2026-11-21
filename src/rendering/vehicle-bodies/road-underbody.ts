import * as T from 'three';
import { clamp } from '../../core/math.ts';
import type { ClosedBodyModel, Greenhouse } from './closed-body.ts';
import type { WingSheet } from './body-sheet.ts';
import type { CarMaterials } from './common.ts';
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

/** A bonded continuation of the painted hatch roof. The leading flange
 * enters the roof and the underside returns to it at both cantrails. */
export function addHatchVisor(
  parts: Parts,
  house: Greenhouse,
  wing: WingSheet,
  mats: CarMaterials,
  detail: Detail,
) {
  const span = house.model.s.width * wing.span * 0.5;
  const root = house.zRR + 0.095,
    chord = wing.chord;
  const roof = house.control(root);
  const height = (x: number) => {
    const a = Math.abs(x);
    for (let i = roof.length - 1; i > 0; i--) {
      const [xi, yi] = roof[i],
        [xo, yo] = roof[i - 1];
      if (a <= xo) return yi + ((yo - yi) * (a - xi)) / (xo - xi);
    }
    return roof[0][1];
  };
  const station = (u: number) => {
    const x = u * span,
      end = ease((Math.abs(u) - 0.69) / 0.31);
    const y = height(x),
      z = root - 0.025 * end;
    const lip = z - chord * (1 - 0.27 * end);
    return { x, y, z, lip, end };
  };
  const n = [24, 14, 8][detail];
  const rings = Array.from({ length: n + 1 }, (_, i) => {
    const { x, y, z, lip, end } = station((2 * i) / n - 1);
    return [
      v(x, y - 0.008, z + 0.026),
      v(x, y + 0.007, z),
      v(x, y + 0.014, z - chord * 0.48),
      v(x, y + 0.017 - 0.026 * end, lip + 0.018),
      v(x, y + 0.011 - 0.027 * end, lip),
      v(x, y - 0.015 - 0.032 * end, lip + 0.005),
      v(x, y - 0.027 - 0.05 * end, lip + 0.038),
      v(x, y - 0.018, z - 0.018),
    ];
  });
  parts.add(pressing(rings), mats.paint);
  if (detail === 2) return;
  // The high stop lamp shares the animated rear-lamp circuit. Its lens sits
  // in the upright trailing fold, with a narrow return around the perimeter.
  const lamp = Array.from({ length: 9 }, (_, i) => {
    const { x, y, lip } = station((i / 4 - 1) * 0.295);
    return [
      v(x, y + 0.005, lip + 0.002),
      v(x, y + 0.005, lip - 0.003),
      v(x, y - 0.009, lip - 0.003),
      v(x, y - 0.01, lip + 0.003),
    ];
  });
  parts.add(pressing(lamp), mats.tail);
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
  // Return the valance around the actual quarter panel. The horizontal face
  // and the side return share a station at the turn. A single flat panel
  // across the tail would disappear inside the broadening rear shoulder.
  const touring = s.mirrorForm === 'touring';
  const chrome = s.mirrorForm === 'bullet';
  const truck = s.mirrorForm === 'work';
  const count = detail === 0 ? 16 : 8;
  function station(u: number, wrap: number) {
    const bend = ease(wrap),
      a = Math.abs(u),
      side = Math.sign(u);
    const z = zRear + (truck ? 0.04 : chrome ? 0.12 : 0.18) * wrap;
    const floor = model.control(z)[0][1];
    const low = floor - 0.013 + 0.015 * a * a + bend * 0.012;
    const depth = truck ? 0.048 : chrome ? 0.077 : touring ? 0.137 : 0.105 + s.diffuser * 0.42;
    const high = low + depth + (truck || chrome ? 0 : 0.048 * ease((a - 0.5) / 0.47));
    const face = (y: number, offset: number, inset = 0) => {
      const x = model.sideX(z, Math.max(floor + 0.002, y)) - inset + offset * bend;
      return v(u * x, y, z - offset * (1 - bend));
    };
    const toe = Math.max(0.02, (high - low) * 0.21);
    return [
      face(high - 0.007, -0.004, 0.004),
      face(high, 0.009),
      face(high - 0.013, 0.021),
      face(low + toe, 0.026),
      face(low + 0.009, 0.019, 0.007),
      face(low, 0.005, 0.012),
      v(side * Math.max(0, a * (model.sideX(z, high) - 0.029)), low + 0.004, z + 0.04),
    ];
  }
  const left = [-1, -0.72, -0.4, -0.16].map((w) => station(-1, -w));
  const face = Array.from({ length: count + 1 }, (_, i) => station((2 * i) / count - 1, 0));
  const right = [0.16, 0.4, 0.72, 1].map((w) => station(1, w));
  parts.add(
    pressing([...left, ...face, ...right]),
    chrome ? sharedMaterials.chrome() : sharedMaterials.plastic(),
  );
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
