import * as T from 'three';
import { drawWordmark } from './studio/brand-atlas.ts';
import { canvasTexture } from './geometry.ts';
import { sampleProfile } from './profile-sampling.ts';
import type { RiderColours, RiderDetail } from './rider.ts';

/** GP race helmet (REF_018 side, REF_056 PS5 crop, REF_003/052 front): a long,
 * low composite shell with a forward chin bar, flat cheeks, a broad iridium
 * eye port, a rear crown spoiler and small crown/chin vents. The shared
 * `helmet-shell.ts` profile stays unchanged for the F1 driver and pit crew.
 *
 * Metres in the GP head frame: the origin is the atlas (head/neck) pivot, +Y
 * up the head, +Z forward. The head centre sits GP_HELMET_CENTRE above it.
 * Rows are [height from the head centre, half width, forward, rearward]. A
 * size-M race shell is about 0.31 m long, 0.25 m wide and 0.29 m tall; these
 * are authored dimensions, not measurements from the reference stills. */
export const GP_HELMET_CENTRE = Object.freeze([0, 0.058, 0.028] as const);
export const GP_HELMET_PROFILE = Object.freeze([
  [-0.145, 0.074, 0.138, 0.094],
  [-0.115, 0.09, 0.152, 0.11],
  [-0.085, 0.103, 0.157, 0.126],
  [-0.055, 0.111, 0.153, 0.138],
  [-0.018, 0.116, 0.146, 0.147],
  [0.02, 0.117, 0.142, 0.15],
  [0.056, 0.112, 0.135, 0.147],
] as const);
/** Crown pole above the head centre; an ellipsoidal dome joins the last row. */
export const GP_HELMET_TOP = 0.146;
const HEIGHTS = GP_HELMET_PROFILE.map((row) => row[0]);
const AXES = [1, 2, 3].map((axis) => GP_HELMET_PROFILE.map((row) => row[axis]));
const DOME = GP_HELMET_PROFILE[GP_HELMET_PROFILE.length - 1][0];

/** Lower shell edge: the chin bar drops below the cheek pads and the nape
 * rises over the neck roll, so the side view slopes like a real shell. */
export function gpHelmetEdge(phi: number) {
  return -0.122 - 0.018 * Math.sin(phi);
}

function radii(y: number, out: [number, number, number]) {
  const at = Math.min(y, DOME),
    dome = y > DOME ? Math.sqrt(Math.max(0, 1 - ((y - DOME) / (GP_HELMET_TOP - DOME)) ** 2)) : 1;
  for (let k = 0; k < 3; k++) out[k] = sampleProfile(HEIGHTS, AXES[k], at) * dome;
  return out;
}
const radius: [number, number, number] = [0, 0, 0];

/** phi = PI/2 faces forward (+Z); x = -cos(phi) * width like helmet-shell.
 * The section is a slightly square superellipse (flat cheeks) whose chin bar
 * narrows in plan view. `offset` is an outward skin offset in metres. */
export function gpHelmetPoint(y: number, phi: number, offset = 0, out = new T.Vector3()) {
  if (![y, phi, offset].every(Number.isFinite) || y < -0.15 || y > GP_HELMET_TOP + 1e-9)
    throw new Error('Invalid GP helmet surface coordinate');
  radii(y, radius);
  const c = Math.cos(phi),
    s = Math.sin(phi),
    shape = (v: number) => Math.sign(v) * Math.abs(v) ** 0.88,
    forward = Math.max(0, s),
    chin = T.MathUtils.smoothstep(-y, 0.035, 0.11) * forward ** 3,
    width = (radius[0] + offset) * (1 - 0.13 * chin);
  return out.set(
    -shape(c) * width,
    y + GP_HELMET_CENTRE[1],
    shape(s) * ((s >= 0 ? radius[1] : radius[2]) + offset) + GP_HELMET_CENTRE[2],
  );
}

/** The two near meshes follow the rim of a real aperture. The distant
 * helmet bakes the shield into a closed, single-material silhouette. */
export function gpHelmetShell(detail: RiderDetail) {
  const columns = detail === 'high' ? 56 : detail === 'mid' ? 32 : 16,
    rows = detail === 'high' ? 26 : detail === 'mid' ? 14 : 7,
    stride = columns + 1,
    tau = 2 * Math.PI,
    left = Math.round(columns * GP_VISOR_PHI[0] / tau),
    right = Math.round(columns * GP_VISOR_PHI[1] / tau),
    bottom = Math.round(rows * .38),
    top = Math.round(rows * .59),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    p = new T.Vector3();
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      let phi = column / columns * tau;
      if (detail !== 'far') {
        // Align shell columns with the two end posts of the shield.
        if (column <= left) phi = GP_VISOR_PHI[0] * column / left;
        else if (column <= right) phi = T.MathUtils.lerp(...GP_VISOR_PHI, (column - left) / (right - left));
        else phi = T.MathUtils.lerp(GP_VISOR_PHI[1], tau, (column - right) / (columns - right));
      }
      const edge = gpHelmetEdge(phi), eye = gpVisorBounds(phi);
      let y: number;
      if (detail === 'far') y = [edge, -0.082, eye[0], eye[1], 0.078, 0.108, 0.135, GP_HELMET_TOP][row];
      else if (row <= bottom) y = T.MathUtils.lerp(edge, eye[0], row / bottom);
      else if (row <= top) y = T.MathUtils.lerp(...eye, (row - bottom) / (top - bottom));
      else y = T.MathUtils.lerp(eye[1], GP_HELMET_TOP, Math.sin(Math.PI * .5 * (row - top) / (rows - top)));
      gpHelmetPoint(y, phi, 0, p);
      positions.push(p.x, p.y, p.z);
      uv.push(phi / tau, gpHelmetV(y));
      const opening = detail !== 'far' && column >= left && column < right && row >= bottom && row < top;
      if (row < rows && column < columns && !opening) {
        const a = row * stride + column,
          b = a + stride;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  // Neck opening: a recessed padded roll closes the shell (dark liner UV).
  const centre = positions.length / 3;
  positions.push(0, gpHelmetEdge(Math.PI / 2) + 0.012 + GP_HELMET_CENTRE[1], GP_HELMET_CENTRE[2]);
  uv.push(0.5, 0.004);
  for (let column = 0; column < columns; column++) indices.push(centre, column + 1, column);
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  // The UV wrap duplicates a column; average it so no highlight seam shows.
  const n = g.getAttribute('normal'),
    average = new T.Vector3();
  for (let row = 0; row <= rows; row++) {
    const a = row * stride,
      b = a + columns;
    average.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, average.x, average.y, average.z);
    n.setXYZ(b, average.x, average.y, average.z);
  }
  // The crown pole shares one upward normal.
  for (let column = 0; column <= columns; column++) n.setXYZ(rows * stride + column, 0, 1, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function gpHelmetV(y: number) {
  return T.MathUtils.clamp((y + 0.14) / (GP_HELMET_TOP + 0.14), 0, 1);
}

/** Eye port: full height across the face, narrowing to the side pivots. */
export const GP_VISOR_PHI = Object.freeze([0.3, Math.PI - 0.3] as const);
export function gpVisorBounds(phi: number) {
  const a = Math.min(1, Math.abs(phi - Math.PI / 2) / (Math.PI / 2 - GP_VISOR_PHI[0])),
    half = T.MathUtils.lerp(0.038, 0.011, T.MathUtils.smoothstep(a, 0.45, 0.98)),
    centre = 0.016 - 0.007 * T.MathUtils.smoothstep(a, 0.35, 0.8);
  return [centre - half, centre + half] as const;
}

function patch(
  rows: number,
  columns: number,
  at: (u: number, v: number, out: T.Vector3) => T.Vector3,
  uvAt?: (u: number, v: number) => [number, number],
) {
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    p = new T.Vector3();
  for (let i = 0; i <= rows; i++)
    for (let j = 0; j <= columns; j++) {
      at(j / columns, i / rows, p);
      positions.push(p.x, p.y, p.z);
      uvs.push(...(uvAt ? uvAt(j / columns, i / rows) : [j / columns, i / rows]));
      if (i < rows && j < columns) {
        const a = i * (columns + 1) + j,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Conformal iridium shield over the eye port, 3.5 mm proud of the shell. */
export function gpVisorGeometry(detail: RiderDetail) {
  const columns = detail === 'high' ? 36 : 18;
  return patch(detail === 'high' ? 8 : 4, columns, (u, v, out) => {
    const phi = T.MathUtils.lerp(GP_VISOR_PHI[0], GP_VISOR_PHI[1], u),
      [y0, y1] = gpVisorBounds(phi);
    return gpHelmetPoint(T.MathUtils.lerp(y0, y1, v), phi, 0.0035, out);
  });
}

/** The lining rolls inward under the shell lip. Across the centre it sits
 * behind the eyes; around the temples and cheek it closes off the cavity. */
export function gpEyePortLiner(detail: RiderDetail) {
  return patch(detail === 'high' ? 12 : 8, detail === 'high' ? 32 : 24, (u, v, out) => {
    const phi = T.MathUtils.lerp(...GP_VISOR_PHI, u);
    const [lo, hi] = gpVisorBounds(phi);
    const temple = T.MathUtils.smoothstep(Math.min(u, 1 - u), 0, .22);
    const pad = T.MathUtils.smoothstep(Math.min(v, 1 - v), 0, .20);
    return gpHelmetPoint(T.MathUtils.lerp(lo - .0015, hi + .0015, v), phi, -.001 - .065 * temple * pad, out);
  });
}

/** Rubber eye-port gasket following the visor outline. */
export function gpVisorSealCurve() {
  const outline: T.Vector3[] = [];
  for (const edge of [1, 0])
    for (let i = 0; i <= 36; i++) {
      const t = edge ? i / 36 : 1 - i / 36,
        phi = T.MathUtils.lerp(GP_VISOR_PHI[0], GP_VISOR_PHI[1], t);
      outline.push(gpHelmetPoint(gpVisorBounds(phi)[edge], phi, 0.0042));
    }
  return new T.CatmullRomCurve3(outline, true);
}

/** Rear crown spoiler (REF_018/056): a ramp lifting off the shell toward a
 * trailing lip with end plates; both faces of each thin panel are present. */
export function gpHelmetSpoiler(detail: RiderDetail) {
  const columns = detail === 'high' ? 14 : 6,
    rows = detail === 'high' ? 4 : 2,
    positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [],
    p = new T.Vector3(),
    rear = Math.PI * 1.5,
    half = 0.56,
    lead = 0.128,
    trail = 0.07,
    lift = 0.019;
  const sheet = (
    nu: number,
    nv: number,
    at: (u: number, v: number) => T.Vector3,
    azimuth: (u: number, v: number) => number,
  ) => {
    for (const flip of [false, true]) {
      const base = positions.length / 3;
      for (let i = 0; i <= nv; i++)
        for (let j = 0; j <= nu; j++) {
          at(j / nu, i / nv);
          positions.push(p.x, p.y, p.z);
          // The spoiler is painted as a continuation of the shell. A full
          // 0..1 UV square here printed the entire helmet on every face.
          uvs.push(azimuth(j / nu, i / nv) / (2 * Math.PI), gpHelmetV(p.y - GP_HELMET_CENTRE[1]));
        }
      for (let i = 0; i < nv; i++)
        for (let j = 0; j < nu; j++) {
          const a = base + i * (nu + 1) + j,
            b = a + nu + 1;
          if (flip) indices.push(a, b, a + 1, a + 1, b, b + 1);
          else indices.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
  };
  // The lip sweeps back at its centre and the panel tapers toward the tips.
  const y = (u: number, v: number) => T.MathUtils.lerp(lead, trail + 0.012 * (2 * u - 1) ** 2, v),
    ramp = (u: number, v: number) => lift * v ** 1.25 * (1 - 0.45 * (2 * u - 1) ** 2);
  const phi = (u: number) => rear - half + 2 * half * u;
  sheet(columns, rows, (u, v) => gpHelmetPoint(y(u, v), phi(u), ramp(u, v), p), phi);
  sheet(columns, 1, (u, v) => gpHelmetPoint(y(u, 1), phi(u), ramp(u, 1) * (1 - v), p), phi);
  for (const u of [0, 1])
    sheet(
      rows,
      1,
      (s, v) => gpHelmetPoint(y(u, s), phi(u), ramp(u, s) * (1 - v), p),
      () => phi(u),
    );
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const surfaceNormal = (y: number, phi: number, out: T.Vector3) => {
  const a = gpHelmetPoint(y, phi + 0.01),
    b = gpHelmetPoint(y, phi - 0.01),
    c = gpHelmetPoint(Math.min(GP_HELMET_TOP, y + 0.004), phi),
    d = gpHelmetPoint(y - 0.004, phi);
  // Increasing azimuth runs across the front towards +X; height runs up.
  // Their cross product is the outward normal used by the shell triangles.
  return out.crossVectors(a.sub(b), c.sub(d)).normalize();
};

/** Place a detail on the shell with its +Y along the outward normal and its
 * +Z along the meridian (toward the crown). */
function onShell(mesh: T.Mesh, y: number, phi: number, lift: number) {
  const normal = surfaceNormal(y, phi, new T.Vector3()),
    up = gpHelmetPoint(Math.min(GP_HELMET_TOP, y + 0.004), phi).sub(gpHelmetPoint(y - 0.004, phi));
  const z = up.addScaledVector(normal, -up.dot(normal)).normalize(),
    x = new T.Vector3().crossVectors(normal, z);
  mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, normal, z));
  gpHelmetPoint(y, phi, 0, mesh.position).addScaledVector(normal, lift);
  return mesh;
}

const VENT_SEGMENTS = 20;

/** Flush-moulded air extractor with a raised rounded lip and a recessed
 * throat. Its local Y is the outward skin normal. Subtracting the recess
 * from the lip leaves real depth even with a head-on reflection. */
export function gpHelmetVent(width: number, length: number, lift: number) {
  const points: number[] = [],
    uv: number[] = [],
    index: number[] = [];
  const segments = VENT_SEGMENTS;
  for (const [scale, height] of [
    [1, -0.0005],
    [0.92, lift * 0.8],
    [0.77, lift],
    [0.58, lift * 0.84],
    [0.53, 0.00045],
  ]) {
    for (let j = 0; j < segments; j++) {
      const a = (2 * Math.PI * j) / segments;
      const cx = Math.cos(a),
        cz = Math.sin(a);
      const x = (Math.sign(cx) * Math.abs(cx) ** 0.55 * width * scale) / 2;
      const z = (Math.sign(cz) * Math.abs(cz) ** 0.62 * length * scale) / 2;
      points.push(x * (0.89 + (0.2 * z) / length), height, z);
      uv.push(0.5 + x / width, 0.5 + z / length);
    }
  }
  for (let r = 0; r < 4; r++)
    for (let j = 0; j < segments; j++) {
      const a = r * segments + j,
        b = r * segments + ((j + 1) % segments);
      index.push(a, a + segments, b, b, a + segments, b + segments);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Shell details on the existing helmet/visor/liner/trim materials: crown
 * intakes, chin vent, rear exhausts, visor pivot plates and the gasket. */
export function addGpHelmetDetails(
  head: T.Group,
  detail: RiderDetail,
  materials: { shell: T.Material; trim: T.Material; liner: T.Material; visor: T.Material },
) {
  const add = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    head.add(mesh);
    return mesh;
  };
  const vent = (
    width: number,
    length: number,
    lip: number,
    material: T.Material,
    name: string,
    y: number,
    phi: number,
    lift: number,
  ) => {
    const rim = gpHelmetVent(width, length, lip);
    const mesh = onShell(add(rim, material, name), y, phi, lift);
    // Seat the dark duct behind the moulded lip. Reuse its inner outline
    // so no lacquer shows through a vent on a light-coloured helmet.
    const housing = rim.getAttribute('position');
    const first = housing.count - VENT_SEGMENTS;
    const points = [0, 0.0002, 0],
      uv = [0.5, 0.5],
      index: number[] = [];
    for (let i = 0; i < VENT_SEGMENTS; i++) {
      const x = housing.getX(first + i),
        z = housing.getZ(first + i);
      points.push(x, 0.0002, z);
      uv.push(0.5 + x / width, 0.5 + z / length);
      index.push(0, 1 + ((i + 1) % VENT_SEGMENTS), 1 + i);
    }
    const throat = new T.BufferGeometry();
    throat.setAttribute('position', new T.Float32BufferAttribute(points, 3));
    throat.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    throat.setIndex(index);
    throat.computeVertexNormals();
    const backing = add(throat, materials.liner, name + ' duct');
    backing.position.copy(mesh.position);
    backing.quaternion.copy(mesh.quaternion);
  };
  const shield = add(gpVisorGeometry(detail), materials.visor, 'GP iridium race visor');
  shield.castShadow = false;
  add(gpEyePortLiner(detail), materials.liner, 'GP eye-port padding');
  add(gpHelmetSpoiler(detail), materials.shell, 'GP rear crown spoiler');
  if (detail !== 'high') return;
  add(
    new T.TubeGeometry(gpVisorSealCurve(), 72, 0.0019, 5, true),
    materials.liner,
    'GP eye-port gasket',
  );
  for (const side of [-1, 1]) {
    // phi measured from bike right: left side is PI - phi.
    const sidePhi = (phi: number) => (side > 0 ? Math.PI - phi : phi);
    vent(
      0.026,
      0.04,
      0.0055,
      materials.trim,
      'GP crown intake',
      0.118,
      sidePhi(Math.PI / 2 - 0.3),
      0.002,
    );
    onShell(
      add(new T.CylinderGeometry(0.017, 0.019, 0.006, 16), materials.trim, 'GP visor pivot plate'),
      0.004,
      sidePhi(0.22),
      0.001,
    );
    vent(
      0.03,
      0.011,
      0.0036,
      materials.liner,
      'GP rear exhaust',
      0.062,
      Math.PI * 1.5 + side * 0.3,
      0.0015,
    );
  }
  vent(0.036, 0.016, 0.0042, materials.liner, 'GP chin vent', -0.083, Math.PI / 2, 0.0015);
}

/** Original paint for the GP shell's UVs (u wraps from bike right, 0.25 at
 * the chin, 0.5 left, 0.75 nape; v rises). A light swept blade with a dark
 * keyline and pinstripe, a halftone fade, brow strip, chin-bar maker mark and
 * race numbers; every mark is fictional. */
export function gpHelmetLivery(colours: RiderColours, raceNumber: number, title = 'VANTA') {
  const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;
  const W = 1024,
    H = 512,
    py = (y: number) => (1 - gpHelmetV(y)) * H,
    px = (u: number) => u * W;
  return canvasTexture(W, H, (c) => {
    c.fillStyle = css(colours.primary);
    c.fillRect(0, 0, W, H);
    // Lower shell shading and dark neck roll.
    for (let band = 0; band < 8; band++) {
      const y = -0.07 - band * 0.0095;
      c.fillStyle = `rgba(0,0,0,${0.05 + band * 0.006})`;
      c.fillRect(0, py(y), W, H);
    }
    // A jaw rail joins the chin vent and the nape. Carry polygons over the
    // UV cut at the right cheek so the two sides of the shell match.
    for (const shift of [0, W]) {
      c.save();
      c.translate(shift, 0);
      for (const mirror of [1, -1]) {
        if (shift && mirror > 0) continue;
        const u = (value: number) => px(0.25 + mirror * value);
        // Blade from the brow corner sweeping back and down to the nape.
        const blade = (grow: number) => {
          c.beginPath();
          c.moveTo(u(0.07 - grow), py(0.092 + grow * 0.25));
          c.bezierCurveTo(
            u(0.2),
            py(0.125 + grow * 0.3),
            u(0.36),
            py(0.105 + grow * 0.3),
            u(0.5),
            py(0.085 + grow * 0.3),
          );
          c.lineTo(u(0.5), py(0.035 - grow * 0.3));
          c.bezierCurveTo(
            u(0.38),
            py(0.04 - grow * 0.3),
            u(0.27),
            py(0.0 - grow * 0.3),
            u(0.2),
            py(-0.05 - grow * 0.3),
          );
          c.bezierCurveTo(
            u(0.15),
            py(0.0),
            u(0.11),
            py(0.07),
            u(0.07 - grow),
            py(0.092 + grow * 0.25),
          );
          c.closePath();
        };
        blade(0.012);
        c.fillStyle = css(colours.secondary);
        c.fill();
        blade(0);
        c.fillStyle = '#eceeed';
        c.fill();
        // A tapered lacquer inlay flows across the side, opening the pearl
        // blade into two sweeps. The paint stays legible after mip filtering
        // on a moving opponent and closes continuously across the rear seam.
        c.beginPath();
        c.moveTo(u(.14), py(.078));
        c.bezierCurveTo(u(.24), py(.119), u(.35), py(.085), u(.50), py(.067));
        c.lineTo(u(.50), py(.047));
        c.bezierCurveTo(u(.38), py(.043), u(.32), py(.061), u(.25), py(.064));
        c.bezierCurveTo(u(.20), py(.070), u(.19), py(.084), u(.14), py(.078));
        c.closePath();
        c.fillStyle = css(colours.primary);
        c.fill();
        c.beginPath();
        c.moveTo(u(.22), py(.054));
        c.bezierCurveTo(u(.30), py(.054), u(.34), py(.029), u(.43), py(.022));
        c.bezierCurveTo(u(.35), py(.030), u(.28), py(.054), u(.22), py(.050));
        c.closePath();
        c.fillStyle = css(colours.secondary);
        c.fill();
        // Accent pinstripe just inside the upper edge.
        c.strokeStyle = css(colours.accent);
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(u(0.08), py(0.086));
        c.bezierCurveTo(u(0.2), py(0.117), u(0.36), py(0.098), u(0.5), py(0.079));
        c.stroke();
      }
      for (const side of [-1, 1]) {
        if (shift && side > 0) continue;
        const u = (at: number) => px(0.25 + side * at);
        c.beginPath();
        c.moveTo(u(0.015), py(-0.108));
        c.bezierCurveTo(u(0.1), py(-0.112), u(0.29), py(-0.082), u(0.49), py(-0.034));
        c.lineTo(u(0.49), py(-0.042));
        c.bezierCurveTo(u(0.32), py(-0.092), u(0.11), py(-0.13), u(0.019), py(-0.124));
        c.closePath();
        c.fillStyle = css(colours.secondary);
        c.fill();
        c.beginPath();
        c.moveTo(u(0.03), py(-0.104));
        c.bezierCurveTo(u(0.16), py(-0.106), u(0.32), py(-0.076), u(0.46), py(-0.04));
        c.strokeStyle = css(colours.accent);
        c.lineWidth = 2.5;
        c.stroke();
      }
      c.restore();
    }
    // Brow strip above the eye port with a partner mark.
    c.fillStyle = '#121519';
    c.fillRect(px(0.135), py(0.084), px(0.23), py(0.058) - py(0.084));
    c.strokeStyle = '#eef0ef';
    drawWordmark(c, title, px(0.25), (py(0.084) + py(0.058)) / 2, 13, {
      weight: 0.18,
      slant: 0.1,
    });
    drawWordmark(c, 'VANTA', px(0.25), py(-0.087), 16, { weight: 0.2, tracking: 0.08 });
    const number = String(raceNumber).padStart(2, '0');
    const raceMark = (u: number, y: number, h: number) => {
      c.strokeStyle = '#1e252c';
      drawWordmark(c, number, px(u), py(y), h, { weight: 0.35, width: 1.05, slant: 0.16 });
      c.strokeStyle = '#f3f0df';
      drawWordmark(c, number, px(u), py(y), h, { weight: 0.18, width: 1.05, slant: 0.16 });
    };
    raceMark(0.75, 0.016, 49);
    for (const u of [0.548, 0.952]) {
      raceMark(u, -0.012, 28);
      c.strokeStyle = '#e3e5e3';
      drawWordmark(c, 'AUREL', px(u), py(-0.047), 8, { weight: 0.2, tracking: 0.14 });
    }
  });
}
