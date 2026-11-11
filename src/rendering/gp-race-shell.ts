import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { chainShaderHook } from './studio/shader-hooks.ts';

/** Control-net surfaces for the GP race shell.
 *
 * A panel is a grid of 3D control points: rows run along the bike (stations),
 * columns run around one half section from its upper edge to its lower edge
 * (x >= 0). The surface is the tensor product of uniform Catmull-Rom splines,
 * so every control point lies on the skin and feature lines stay exactly where
 * they were designed. Crease columns split the surface into separately shaded
 * strips, giving the sharp folds of moulded carbon bodywork instead of a
 * single inflated loft. A column that lies on x = 0 is mirrored through the
 * centre plane, so the joined halves meet with a continuous tangent.
 *
 * All units are metres in the sprung CG frame of BikeModel: +Z forward, +Y up,
 * the road at y = -cgHeight. */
export type P3 = readonly [number, number, number];

export interface ShellPanel {
  readonly name: string;
  /** Rows (along the bike) of columns (around the half section). */
  readonly net: readonly (readonly P3[])[];
  /** Interior column indices rendered as sharp folds. */
  readonly creases?: readonly number[];
  /** Subdivisions per row and per column interval. */
  readonly rows: number;
  readonly cols: number;
  /** Removes every point from the first excluded one to the column end. */
  readonly exclude?: (p: T.Vector3) => boolean;
  /** Mirror into a closed left/right pair (default true). */
  readonly mirror?: boolean;
  /** Keep a sharp moulded ridge on the centre line instead of a smooth crown. */
  readonly ridge?: boolean;
  /** Close the first (rearmost) and/or last (foremost) section with a flat cap. */
  readonly caps?: { readonly start?: boolean; readonly end?: boolean };
}

const EPS = 1e-6;

function catmull(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  );
}

/** Phantom end point: mirrored through x = 0 for a centre-line column, a
 * linear extension otherwise (natural, tangent-continuous ends). */
function phantom(end: P3, next: P3, mirror: boolean): P3 {
  if (mirror && Math.abs(end[0]) < EPS) return [-next[0], next[1], next[2]];
  return [2 * end[0] - next[0], 2 * end[1] - next[1], 2 * end[2] - next[2]];
}

/** Dense polyline through control points, `steps` samples per interval. */
function spline(points: readonly P3[], steps: number, mirrorEnds: boolean): P3[] {
  const out: P3[] = [];
  const n = points.length;
  if (n === 1) return [points[0]];
  for (let i = 0; i < n - 1; i++) {
    const a = i === 0 ? phantom(points[0], points[1], mirrorEnds) : points[i - 1],
      b = points[i],
      c = points[i + 1],
      d = i + 2 < n ? points[i + 2] : phantom(points[n - 1], points[n - 2], mirrorEnds);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push([
        catmull(a[0], b[0], c[0], d[0], t),
        catmull(a[1], b[1], c[1], d[1], t),
        catmull(a[2], b[2], c[2], d[2], t),
      ]);
    }
  }
  out.push(points[n - 1]);
  return out;
}

/** Evaluate one crease group (columns from..to) over all dense rows. */
function groupGrid(panel: ShellPanel, from: number, to: number): P3[][] {
  const columns: P3[][] = [];
  for (let j = from; j <= to; j++) {
    // Each control column becomes a dense curve along the bike.
    columns.push(
      spline(
        panel.net.map((row) => row[j]),
        panel.rows,
        false,
      ),
    );
  }
  const rows = columns[0].length;
  const grid: P3[][] = [];
  for (let r = 0; r < rows; r++) {
    const controls = columns.map((column) => column[r]);
    // Only the outer ends of the full half section may mirror.
    const mirrorStart = from === 0,
      mirrorEnd = to === panel.net[0].length - 1;
    const dense = spline(controls, panel.cols, false);
    if (!panel.ridge && (mirrorStart || mirrorEnd) && controls.length > 1) {
      // Re-evaluate end intervals with centre-line mirroring where it applies.
      const n = controls.length;
      const ends = spline(controls, panel.cols, true);
      if (mirrorStart && Math.abs(controls[0][0]) < EPS)
        for (let k = 0; k <= panel.cols && k < dense.length; k++) dense[k] = ends[k];
      if (mirrorEnd && Math.abs(controls[n - 1][0]) < EPS)
        for (let k = dense.length - 1 - panel.cols; k < dense.length; k++) dense[k] = ends[k];
    }
    grid.push(dense);
  }
  return grid;
}

/** Truncate a dense row at its first excluded point (bisected), resampling
 * the remaining length so every row keeps the same vertex count. */
function trimRow(row: P3[], exclude: (p: T.Vector3) => boolean, v: T.Vector3): P3[] | null {
  let cut = -1;
  for (let k = 0; k < row.length; k++)
    if (exclude(v.set(...row[k]))) {
      cut = k;
      break;
    }
  if (cut === 0) return null;
  if (cut < 0) return row;
  // Bisect the crossing between the last kept and first excluded samples.
  let lo = 0,
    hi = 1;
  const a = row[cut - 1],
    b = row[cut];
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (
      exclude(v.set(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m, a[2] + (b[2] - a[2]) * m))
    )
      hi = m;
    else lo = m;
  }
  const end = cut - 1 + lo;
  const out: P3[] = [];
  const n = row.length - 1;
  for (let k = 0; k <= n; k++) {
    const f = (k / n) * end,
      i = Math.min(Math.floor(f), row.length - 2),
      t = f - i,
      p = row[i],
      q = row[i + 1];
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
  }
  return out;
}

function gridGeometry(
  grid: (P3[] | null)[],
  mirror: -1 | 1,
  ridge = false,
): T.BufferGeometry | null {
  const position: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const width = grid.find((row) => row)?.length ?? 0;
  if (!width) return null;
  const ids: number[][] = [];
  for (const [r, row] of grid.entries()) {
    const line: number[] = [];
    if (row)
      for (const [k, p] of row.entries()) {
        line.push(position.length / 3);
        position.push(p[0] * mirror, p[1], p[2]);
        // Net parameters; painted panels replace these with livery UVs.
        uv.push(k / Math.max(1, width - 1), r / Math.max(1, grid.length - 1));
      }
    ids.push(line);
  }
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  const area = (i: number, j: number, k: number) => {
    a.fromArray(position, i * 3);
    b.fromArray(position, j * 3).sub(a);
    c.fromArray(position, k * 3).sub(a);
    return b.cross(c).lengthSq();
  };
  for (let r = 0; r < ids.length - 1; r++) {
    const top = ids[r],
      bottom = ids[r + 1];
    if (!top.length || !bottom.length) continue;
    for (let k = 0; k < width - 1; k++) {
      const p = top[k],
        q = top[k + 1],
        s = bottom[k],
        t = bottom[k + 1];
      // Rows ascend along +Z; columns descend around the right half. This
      // order faces outward on the right; the mirrored half flips it.
      const tri = (i: number, j: number, l: number) => {
        if (area(i, j, l) < 1e-14) return;
        if (mirror > 0) index.push(i, j, l);
        else index.push(i, l, j);
      };
      tri(p, s, q);
      tri(q, s, t);
    }
  }
  if (!index.length) return null;
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // A closed centre seam must shade as one surface (unless it is a ridge).
  if (!ridge) {
    const pos = g.getAttribute('position'),
      nor = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++)
      if (Math.abs(pos.getX(i)) < 2e-5) {
        a.set(0, nor.getY(i), nor.getZ(i));
        if (a.lengthSq() > EPS) a.normalize();
        nor.setXYZ(i, a.x, a.y, a.z);
      }
  }
  return g;
}

/** Flat fan over one end section; its own vertices keep the shell edge sharp. */
function capGeometry(ring: P3[], mirror: -1 | 1, facing: 1 | -1): T.BufferGeometry | null {
  if (ring.length < 2) return null;
  const pos: number[] = [],
    idx: number[] = [];
  let cy = 0,
    cz = 0;
  for (const p of ring) {
    cy += p[1] / ring.length;
    cz += p[2] / ring.length;
  }
  pos.push(0, cy, cz);
  for (const p of ring) pos.push(p[0] * mirror, p[1], p[2]);
  const uv = new Float32Array((pos.length / 3) * 2).fill(0.5);
  for (let k = 1; k < ring.length; k++)
    if (facing * mirror > 0) idx.push(0, k, k + 1);
    else idx.push(0, k + 1, k);
  const c = new T.BufferGeometry();
  c.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  c.setAttribute('uv', new T.BufferAttribute(uv, 2));
  c.setIndex(idx);
  c.computeVertexNormals();
  return c;
}

/** Build both halves of a panel as one indexed, crease-split geometry. */
export function shellPanelGeometry(panel: ShellPanel): T.BufferGeometry {
  const width = panel.net[0].length;
  for (const row of panel.net)
    if (row.length !== width) throw new Error(`Ragged GP shell net: ${panel.name}`);
  const breaks = [0, ...(panel.creases ?? []).filter((c) => c > 0 && c < width - 1), width - 1];
  const parts: T.BufferGeometry[] = [];
  const probe = new T.Vector3();
  // Evaluate the complete half section first so trimming is per real row.
  const groups = breaks.slice(0, -1).map((from, i) => groupGrid(panel, from, breaks[i + 1]));
  const rows = groups[0].length;
  const trimmed = groups.map(() => [] as (P3[] | null)[]);
  for (let r = 0; r < rows; r++) {
    let alive = true;
    for (let g = 0; g < groups.length; g++) {
      const row = groups[g][r];
      if (!alive || !panel.exclude) {
        trimmed[g].push(alive ? row : null);
        continue;
      }
      const cut = trimRow(row, panel.exclude, probe);
      trimmed[g].push(cut);
      // Columns after a cut belong to the removed part of this section.
      if (cut !== row) alive = false;
    }
  }
  for (const mirror of panel.mirror === false ? ([1] as const) : ([1, -1] as const))
    for (const grid of trimmed) {
      const g = gridGeometry(grid, mirror, panel.ridge);
      if (g) parts.push(g);
    }
  // End rings run through every crease group (shared crease points once).
  const ring = (r: number) =>
    trimmed.flatMap((grid, g) => (grid[r] ?? []).slice(g ? 1 : 0)).filter(Boolean);
  for (const mirror of panel.mirror === false ? ([1] as const) : ([1, -1] as const)) {
    if (panel.caps?.start) {
      const c = capGeometry(ring(0), mirror, -1);
      if (c) parts.push(c);
    }
    if (panel.caps?.end) {
      const c = capGeometry(ring(rows - 1), mirror, 1);
      if (c) parts.push(c);
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!merged) throw new Error(`Empty GP shell panel: ${panel.name}`);
  merged.name = panel.name;
  return merged;
}

/** Side-view livery coordinates: each flank owns one half of the atlas, the
 * front of the bike towards the atlas centre so painted art reads upright and
 * forwards on both sides. */
export interface LiveryFrame {
  zMin: number;
  zMax: number;
  yMin: number;
  yMax: number;
}
export const GP_LIVERY_FRAME: LiveryFrame = Object.freeze({
  zMin: -1.02,
  zMax: 1.02,
  yMin: -0.62,
  yMax: 0.62,
});

export function liveryUv(geometry: T.BufferGeometry, frame: LiveryFrame = GP_LIVERY_FRAME) {
  const pos = geometry.getAttribute('position'),
    nor = geometry.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const z = (pos.getZ(i) - frame.zMin) / (frame.zMax - frame.zMin),
      y = (pos.getY(i) - frame.yMin) / (frame.yMax - frame.yMin);
    // Right flank (+X) is viewed with the nose to the left of the atlas half.
    const right = pos.getX(i) > 1e-5 || (Math.abs(pos.getX(i)) <= 1e-5 && nor.getX(i) >= 0);
    uv[i * 2] = right ? 0.5 * (1 - z) : 0.5 + 0.5 * z;
    uv[i * 2 + 1] = y;
  }
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  return geometry;
}

/** Raw composite under every painted panel: back faces render as the dark
 * unpainted carbon inside of a moulded skin, so open edges read as panels
 * with an inside rather than as paint seen through a hole. */
export function installShellInterior(material: T.MeshPhysicalMaterial) {
  material.side = T.DoubleSide;
  chainShaderHook(material, 'gp-shell-interior-v1', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb = vec3(0.028, 0.03, 0.032);',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n\tif (!gl_FrontFacing) roughnessFactor = 0.62;',
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_fragment>',
      '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n\tif (!gl_FrontFacing) material.clearcoat = 0.0;\n#endif',
    );
  });
  return material;
}

/** Rolled, thickened free edges for an open shell panel.
 *
 * A moulded skin has a thickness: its cut edge is a few millimetres of
 * composite, rounded where the paint wraps over it, not a razor line.
 * Every boundary edge of `geometry` (the tyre notch, the lower fairing rim,
 * the seam to the next panel that is not welded to it) grows a strip: a
 * quarter-round roll of `radius` that turns the outer skin over the edge,
 * then a wall `thickness` deep. Welded boundary vertices share their profile,
 * so the strips of a curved edge are continuous, and the roll starts on the
 * panel's own vertex normal, so shading flows from the skin into the hem.
 * Purely additive: the panel's vertices, indices and shape are unchanged. */
export interface HemOptions {
  /** Depth of the cut edge below the outer skin (m). */
  readonly thickness: number;
  /** Radius of the rolled outer corner (m); at most `thickness`. */
  readonly radius: number;
  /** Quarter-round segments (1 = chamfer). */
  readonly arc: number;
}
export const GP_SHELL_HEM: HemOptions = Object.freeze({
  thickness: 0.0028,
  radius: 0.0016,
  arc: 2,
});

/** `ignore` drops a boundary edge from its adjacent face's outward normal:
 * the flat end caps are fans whose closing diagonals are not real free edges. */
export function hemShellEdges(
  source: T.BufferGeometry,
  options: HemOptions = GP_SHELL_HEM,
  ignore?: (faceNormal: T.Vector3) => boolean,
): T.BufferGeometry {
  const { thickness, radius, arc } = options;
  if (!(thickness > 0) || !(radius > 0) || radius > thickness || !(arc >= 1))
    throw new RangeError('Invalid shell hem');
  const position = source.getAttribute('position'),
    normal = source.getAttribute('normal'),
    uv = source.getAttribute('uv'),
    index = source.getIndex();
  if (!position || !normal || !uv || !index)
    throw new Error('A hemmed shell needs indexed position, normal and uv');
  for (const name of Object.keys(source.attributes))
    if (name !== 'position' && name !== 'normal' && name !== 'uv')
      throw new Error(`Hemming does not carry attribute ${name}`);
  const weld = new Map<string, number>(),
    welded = new Int32Array(position.count);
  const quantum = 1e5;
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * quantum)},${Math.round(position.getY(i) * quantum)},${Math.round(position.getZ(i) * quantum)}`;
    let id = weld.get(key);
    if (id === undefined) weld.set(key, (id = weld.size));
    welded[i] = id;
  }
  interface Edge {
    count: number;
    a: number;
    b: number;
    /** The triangle's third vertex (its winding side). */
    c: number;
  }
  const edges = new Map<number, Edge>(),
    stride = weld.size + 1;
  for (let t = 0; t < index.count; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index.getX(t + k),
        b = index.getX(t + ((k + 1) % 3)),
        c = index.getX(t + ((k + 2) % 3)),
        wa = welded[a],
        wb = welded[b];
      if (wa === wb) continue;
      const key = Math.min(wa, wb) * stride + Math.max(wa, wb),
        e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { count: 1, a, b, c });
    }
  const pa = new T.Vector3(),
    pb = new T.Vector3(),
    pc = new T.Vector3(),
    face = new T.Vector3(),
    along = new T.Vector3(),
    inward = new T.Vector3(),
    n = new T.Vector3(),
    d = new T.Vector3();
  const boundary: Edge[] = [];
  for (const e of edges.values()) {
    if (e.count !== 1) continue;
    if (ignore) {
      pa.fromBufferAttribute(position, e.a);
      pb.fromBufferAttribute(position, e.b);
      pc.fromBufferAttribute(position, e.c);
      face.crossVectors(along.subVectors(pb, pa), inward.subVectors(pc, pa)).normalize();
      if (ignore(face)) continue;
    }
    boundary.push(e);
  }
  if (!boundary.length) return source;
  // Inward (in-surface, away from the free edge) direction at each welded
  // boundary vertex: the mean of its boundary edges' own inward directions.
  const inwardSum = new Map<number, T.Vector3>();
  for (const e of boundary) {
    pa.fromBufferAttribute(position, e.a);
    pb.fromBufferAttribute(position, e.b);
    pc.fromBufferAttribute(position, e.c);
    along.subVectors(pb, pa);
    face.crossVectors(along, inward.subVectors(pc, pa));
    if (face.lengthSq() < 1e-20 || along.lengthSq() < 1e-20) continue;
    face.normalize();
    along.normalize();
    // The interior lies to the left of a directed boundary edge (a -> b).
    inward.crossVectors(face, along).normalize();
    for (const w of [welded[e.a], welded[e.b]]) {
      const sum = inwardSum.get(w);
      if (sum) sum.add(inward);
      else inwardSum.set(w, inward.clone());
    }
  }
  // One profile (arc + 2 points) per welded boundary vertex.
  const profile = arc + 2,
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    first = new Map<number, number>();
  const ensure = (vertex: number) => {
    const w = welded[vertex];
    let at = first.get(w);
    if (at !== undefined) return at;
    at = positions.length / 3;
    first.set(w, at);
    pa.fromBufferAttribute(position, vertex);
    n.fromBufferAttribute(normal, vertex).normalize();
    d.copy(inwardSum.get(w) ?? d.set(0, 0, 0));
    // Keep the inward direction in the tangent plane of the skin.
    d.addScaledVector(n, -d.dot(n));
    if (d.lengthSq() < 1e-12) d.set(0, 0, 0);
    else d.normalize();
    const { x: u, y: v } = new T.Vector2(uv.getX(vertex), uv.getY(vertex));
    const push = (p: T.Vector3, q: T.Vector3) => {
      positions.push(p.x, p.y, p.z);
      normals.push(q.x, q.y, q.z);
      uvs.push(u, v);
    };
    // Roll: quarter circle about C = E - n*r from the skin outward and down.
    const centre = pa.clone().addScaledVector(n, -radius),
      p = new T.Vector3(),
      q = new T.Vector3();
    for (let k = 0; k <= arc; k++) {
      const theta = (k / arc) * (Math.PI / 2),
        c = Math.cos(theta),
        s = Math.sin(theta);
      q.copy(n).multiplyScalar(c).addScaledVector(d, -s);
      push(p.copy(centre).addScaledVector(q, radius), q);
    }
    // Wall: straight down to the full thickness, facing away from the panel.
    const wall = new T.Vector3().copy(d).multiplyScalar(-1);
    push(
      p
        .copy(centre)
        .addScaledVector(d, -radius)
        .addScaledVector(n, -(thickness - radius)),
      wall,
    );
    return at;
  };
  for (const e of boundary) {
    const a = ensure(e.a),
      b = ensure(e.b);
    for (let k = 0; k < profile - 1; k++) {
      // Directed a -> b with the interior on the left: the strip runs to the
      // right (outward), so (a_k, a_k+1, b_k) faces out of the skin.
      indices.push(a + k, a + k + 1, b + k, b + k, a + k + 1, b + k + 1);
    }
  }
  if (!indices.length) return source;
  const base = position.count,
    total = base + positions.length / 3,
    out = new T.BufferGeometry(),
    join = (
      src: T.BufferAttribute | T.InterleavedBufferAttribute,
      extra: number[],
      size: number,
    ) => {
      const array = new Float32Array(total * size);
      for (let i = 0; i < base; i++)
        for (let c = 0; c < size; c++) array[i * size + c] = src.getComponent(i, c);
      array.set(extra, base * size);
      return new T.BufferAttribute(array, size);
    };
  out.setAttribute('position', join(position, positions, 3));
  out.setAttribute('normal', join(normal, normals, 3));
  out.setAttribute('uv', join(uv, uvs, 2));
  const all = new Uint32Array(index.count + indices.length);
  for (let i = 0; i < index.count; i++) all[i] = index.getX(i);
  for (let i = 0; i < indices.length; i++) all[index.count + i] = indices[i] + base;
  out.setIndex(new T.BufferAttribute(all, 1));
  out.name = source.name;
  // Where the hem strips start in the index (the skin alone is `[0, hemStart)`).
  out.userData.gpHemStart = index.count;
  return out;
}
