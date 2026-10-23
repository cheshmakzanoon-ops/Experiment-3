import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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

/** Closed outer shell: per-column rows from the sloped edge to the crown pole
 * (no pinched seam) and a neck-roll cap. UV u wraps azimuth, v rises. */
export function gpHelmetShell(detail: RiderDetail) {
  const columns = detail === 'high' ? 56 : detail === 'mid' ? 32 : 8,
    rows = detail === 'high' ? 26 : detail === 'mid' ? 14 : 4,
    stride = columns + 1,
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [],
    p = new T.Vector3();
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      const phi = (column / columns) * Math.PI * 2,
        edge = gpHelmetEdge(phi),
        // Denser rows through the eye port and chin bar, sparser on the dome.
        t = row / rows,
        y =
          row === rows
            ? GP_HELMET_TOP
            : edge + (GP_HELMET_TOP - edge) * (t - 0.12 * Math.sin(t * Math.PI));
      gpHelmetPoint(y, phi, 0, p);
      positions.push(p.x, p.y, p.z);
      uv.push(column / columns, gpHelmetV(y));
      if (row < rows && column < columns) {
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
  const sheet = (nu: number, nv: number, at: (u: number, v: number) => T.Vector3) => {
    for (const flip of [false, true]) {
      const base = positions.length / 3;
      for (let i = 0; i <= nv; i++)
        for (let j = 0; j <= nu; j++) {
          at(j / nu, i / nv);
          positions.push(p.x, p.y, p.z);
          uvs.push(j / nu, i / nv);
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
  sheet(columns, rows, (u, v) => gpHelmetPoint(y(u, v), rear - half + 2 * half * u, ramp(u, v), p));
  sheet(columns, 1, (u, v) =>
    gpHelmetPoint(y(u, 1), rear - half + 2 * half * u, ramp(u, 1) * (1 - v), p),
  );
  for (const u of [0, 1])
    sheet(rows, 1, (s, v) =>
      gpHelmetPoint(y(u, s), rear - half + 2 * half * u, ramp(u, s) * (1 - v), p),
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
  return out.crossVectors(a.sub(b), c.sub(d)).normalize().negate();
};

/** Place a detail on the shell with its +Y along the outward normal and its
 * +Z along the meridian (toward the crown). */
function onShell(mesh: T.Mesh, y: number, phi: number, lift: number) {
  const normal = surfaceNormal(y, phi, new T.Vector3()),
    up = gpHelmetPoint(Math.min(GP_HELMET_TOP, y + 0.004), phi).sub(gpHelmetPoint(y - 0.004, phi));
  const z = up.addScaledVector(normal, -up.dot(normal)).normalize(),
    x = new T.Vector3().crossVectors(normal, z);
  mesh.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, normal, z));
  gpHelmetPoint(y, phi, lift, mesh.position);
  return mesh;
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
  add(gpVisorGeometry(detail), materials.visor, 'GP iridium race visor');
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
    onShell(
      add(new RoundedBoxGeometry(0.026, 0.009, 0.04, 2, 0.004), materials.trim, 'GP crown intake'),
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
    onShell(
      add(
        new RoundedBoxGeometry(0.03, 0.006, 0.011, 2, 0.0026),
        materials.liner,
        'GP rear exhaust',
      ),
      0.062,
      Math.PI * 1.5 + side * 0.3,
      0.0015,
    );
  }
  onShell(
    add(new RoundedBoxGeometry(0.036, 0.007, 0.016, 2, 0.003), materials.liner, 'GP chin vent'),
    -0.083,
    Math.PI / 2,
    0.0015,
  );
}

/** Original paint for the GP shell's UVs (u wraps from bike right, 0.25 at
 * the chin, 0.5 left, 0.75 nape; v rises). A light swept blade with a dark
 * keyline and pinstripe, a halftone fade, brow strip, chin-bar maker mark and
 * race numbers; every mark is fictional. */
export function gpHelmetLivery(colours: RiderColours, raceNumber: number) {
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
    for (const mirror of [1, -1]) {
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
      // Halftone fade in the primary over the blade's trailing half.
      c.save();
      blade(0);
      c.clip();
      c.fillStyle = css(colours.primary);
      for (let i = 0; i < 46; i++)
        for (let j = 0; j < 22; j++) {
          const fx = 0.2 + i * 0.0068 + (j % 2) * 0.0034,
            fy = -0.06 + j * 0.0085,
            r = 3.2 * T.MathUtils.smoothstep(fx, 0.24, 0.5);
          if (r < 0.35) continue;
          c.beginPath();
          c.arc(u(fx), py(fy), r, 0, Math.PI * 2);
          c.fill();
        }
      c.restore();
      // Accent pinstripe just inside the upper edge.
      c.strokeStyle = css(colours.accent);
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(u(0.08), py(0.086));
      c.bezierCurveTo(u(0.2), py(0.117), u(0.36), py(0.098), u(0.5), py(0.079));
      c.stroke();
    }
    // Brow strip above the eye port with a partner mark.
    c.fillStyle = '#121519';
    c.fillRect(px(0.135), py(0.084), px(0.23), py(0.058) - py(0.084));
    c.fillStyle = '#eef0ef';
    c.font = 'bold 20px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('MERIDIAN OIL', px(0.25), (py(0.084) + py(0.058)) / 2 + 1);
    // Chin-bar maker mark, nape number, cheek numbers and partner marks.
    c.font = 'bold 24px sans-serif';
    c.fillText('VANTA', px(0.25), py(-0.098));
    c.font = 'italic bold 58px sans-serif';
    c.fillText(String(raceNumber), px(0.75), py(0.01));
    for (const u of [0.58, 0.92]) {
      c.font = 'italic bold 30px sans-serif';
      c.fillStyle = css(colours.secondary);
      c.fillText(String(raceNumber), px(u), py(-0.045));
      c.font = 'bold 13px sans-serif';
      c.fillStyle = '#eef0ef';
      c.fillText('AUREL BANK', px(u), py(-0.085));
    }
  });
}
