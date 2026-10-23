import * as T from 'three';
import { installGlassFresnel } from './materials/library.ts';
import type { BikeMaterials } from './bike.ts';
import type { RiderDetail } from './rider.ts';

/** Original GP look-development values; not a recovered commercial material.
 * Per-entrant materials are shared by the three LODs, so this is idempotent.
 * Leave road, classic and motocross families outside this calibration. */
export function calibrateGpMaterials(materials: BikeMaterials, vehicle: string): boolean {
  if (vehicle !== 'gpr1' && vehicle !== 'gpr2') return false;
  if (materials.paint.userData.gpAppearance === 'r5-refined') return true;
  // Race paint is a deep, polished clear coat over a satin base (REF_018,
  // REF_028, REF_056): sharp sky reflections over a still-readable colour.
  for (const material of [materials.paint, materials.secondary, materials.accent]) {
    material.metalness = 0;
    material.roughness = 0.3;
    material.clearcoat = 1;
    material.clearcoatRoughness = 0.04;
  }
  materials.paint.color.multiplyScalar(0.84);
  materials.paint.userData.gpAppearance = 'r5-refined';
  // Visible carbon covers are lacquered (REF 056 tank cover, REF 073): a
  // deep clear coat over the twill, so the weave flips under sky reflections.
  // Inner and structural carbon uses the raw satin finish instead.
  materials.carbon.roughness = 0.42;
  materials.carbon.clearcoat = 0.8;
  materials.carbon.clearcoatRoughness = 0.09;
  materials.aluminium.roughness = 0.41;
  materials.wheel.roughness = 0.42;
  materials.wheel.clearcoat = 0.2;
  materials.wheel.clearcoatRoughness = 0.24;
  // Coloured headers supply a vertex attribute, but the old plain-cylinder
  // silencers did not. Mark their missing-attribute fallback explicitly.
  materials.titanium.userData.gpBareTitanium = true;
  materials.titanium.roughness = 0.4;
  // Burnished, not polished: bare titanium reads warm grey, not white.
  materials.titanium.color.setHex(0x8f8b85);
  // Fork: hard-anodised graphite outer tubes and caps' recess, TiN-coated
  // gold stanchions sliding below them (REF 018/028/060). The former bright
  // gold outer tubes read as toy brass at the top clamp from every view.
  materials.forkUpper.color.setHex(0x232427);
  materials.forkUpper.metalness = 0.72;
  materials.forkUpper.roughness = 0.34;
  materials.forkLower.color.setHex(0x7a6236);
  materials.forkLower.metalness = 1;
  materials.forkLower.roughness = 0.26;
  // Brake fluid pot: smoked amber nylon with dark fluid, not a white cup.
  materials.reservoir.color.setHex(0x4a3a24);
  materials.reservoir.roughness = 0.32;
  // R6 bubble: lightly smoked polycarbonate as premultiplied Fresnel glass.
  // Nearly clear through the rider's sightline, reflective at grazing angles
  // (REF 017, 028, 047), without three.js's extra opaque transmission pass,
  // whose low-resolution target also showed through over dark backdrops.
  materials.screen.color.setHex(0x7d8a91);
  materials.screen.transmission = 0;
  materials.screen.thickness = 0;
  materials.screen.transparent = true;
  // Nearly clear through the sightline with a printed border along the free
  // rear rim and the fairing base: from the onboard eye the bubble reads as
  // an edge arcing over the track (REF 017/088), not as a grey smoked blob.
  materials.screen.opacity = 1;
  materials.screen.alphaMap = gpScreenBorderMap();
  materials.screen.depthWrite = false;
  materials.screen.roughness = 0.03;
  installGlassFresnel(materials.screen);
  materials.screenLight.color.setHex(0x9aa6ad);
  materials.screenLight.metalness = 0;
  materials.screenLight.opacity = 0.3;
  materials.screenLight.roughness = 0.12;
  return true;
}

/** Screen coverage over the GP screen panel's net UVs (u: base edge 0 to
 * crown 1 around the half section; v: rear free rim 0 to the nose 1). Linear
 * data in the green channel, as three.js samples alpha maps. */
export const GP_SCREEN_ALPHA = Object.freeze({ clear: 0.05, rim: 0.55, base: 0.38 });
export function gpScreenAlpha(u: number, v: number) {
  const a = GP_SCREEN_ALPHA,
    rim = 1 - T.MathUtils.smoothstep(v, 0.014, 0.024),
    base = 1 - T.MathUtils.smoothstep(u, 0.035, 0.06);
  return Math.max(a.clear, a.rim * rim, a.base * base);
}
function gpScreenBorderMap() {
  const w = 32,
    h = 128,
    data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const value = Math.round(gpScreenAlpha((x + 0.5) / w, (y + 0.5) / h) * 255);
      data.set([value, value, value, 255], (y * w + x) * 4);
    }
  const texture = new T.DataTexture(data, w, h, T.RGBAFormat);
  texture.name = 'GP screen printed border (alpha)';
  texture.colorSpace = T.NoColorSpace;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Carbon front fender with a transverse crown, tapered nose and returned
 * 2 mm edges. Axle along X, up along Y; the fork owns all articulation. */
export function gpFrontFender(radius: number, detail: RiderDetail): T.BufferGeometry {
  if (!Number.isFinite(radius) || radius < 0.2 || radius > 0.45)
    throw new Error('Invalid GP front tyre radius');
  const rows = detail === 'high' ? 28 : detail === 'mid' ? 14 : 8;
  const cols = detail === 'high' ? 6 : 4;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const count = (rows + 1) * (cols + 1);
  for (let inner = 0; inner < 2; inner++) {
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const angle = T.MathUtils.lerp(0.74, 2.64, t);
      const width = 0.067 + Math.sin(Math.PI * t) * 0.014;
      for (let j = 0; j <= cols; j++) {
        const u = (j / cols) * 2 - 1;
        const r = radius + 0.029 + 0.012 * (1 - u * u) - 0.011 * u * u - inner * 0.002;
        positions.push(u * width, Math.sin(angle) * r, Math.cos(angle) * r);
        uvs.push(j / cols, t);
      }
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
      indices.push(a + count, b + count, a + 1 + count, a + 1 + count, b + count, b + 1 + count);
    }
  const boundary = [
    ...Array.from({ length: cols + 1 }, (_, j) => j),
    ...Array.from({ length: rows }, (_, i) => (i + 1) * (cols + 1) + cols),
    ...Array.from({ length: cols }, (_, j) => rows * (cols + 1) + cols - j - 1),
    ...Array.from({ length: rows - 1 }, (_, i) => (rows - 1 - i) * (cols + 1)),
  ];
  for (let k = 0; k < boundary.length; k++) {
    const a = boundary[k],
      b = boundary[(k + 1) % boundary.length];
    indices.push(a, a + count, b, b, a + count, b + count);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.userData.gpFender = true;
  return g;
}

/** Give only GP bare titanium its missing neutral vertex colour. Preserve
 * authored heat gradients verbatim. Called before any static mesh batching. */
export function bindGpBareMetal(geometry: T.BufferGeometry, material: T.Material): void {
  if (!material.userData.gpBareTitanium || geometry.hasAttribute('color')) return;
  const p = geometry.getAttribute('position');
  if (!p) throw new Error('Missing GP metal positions');
  geometry.setAttribute(
    'color',
    new T.Float32BufferAttribute(new Float32Array(p.count * 3).fill(1), 3),
  );
}

/** Hollow, tapered silencer with a recessed bore and rolled outlet, rather
 * than the former two sealed black cylinders. Local -Y is the outlet. */
export function gpSilencer(detail: RiderDetail, materials: BikeMaterials): T.Group {
  const root = new T.Group();
  root.name = 'GP formed titanium silencer';
  const segments = detail === 'high' ? 28 : 16;
  const mesh = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
    bindGpBareMetal(geometry, material);
    const m = new T.Mesh(geometry, material);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const profile = [
    [0.03, -0.108],
    [0.03, -0.153],
    [0.033, -0.158],
    [0.037, -0.157],
    [0.044, -0.135],
    [0.052, -0.118],
    [0.056, 0.105],
    [0.053, 0.128],
    [0.034, 0.15],
  ];
  mesh(
    new T.LatheGeometry(
      profile.map(([r, y]) => new T.Vector2(r, y)),
      segments,
    ),
    materials.titanium,
    'Rolled titanium shell and open outlet',
  );
  mesh(
    new T.LatheGeometry([new T.Vector2(0.029, -0.152), new T.Vector2(0.027, -0.072)], segments),
    materials.dark,
    'Recessed silencer bore',
  );
  const end = mesh(
    new T.CircleGeometry(0.027, segments),
    materials.dark,
    'Recessed exhaust baffle',
  );
  end.rotation.x = Math.PI / 2;
  end.position.y = -0.072;
  const band = mesh(
    new T.CylinderGeometry(0.0565, 0.0565, 0.026, segments, 1, true),
    materials.carbon,
    'Carbon retention strap',
  );
  band.position.y = 0.074;
  return root;
}
