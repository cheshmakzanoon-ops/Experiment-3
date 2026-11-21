import { installGpOpticalRain } from './gp-optics-rain.ts';
import * as T from 'three';
import { installGlassFresnel } from './materials/library.ts';
import { chainShaderHook, injectAfter } from './studio/shader-hooks.ts';
import { installSsrMask } from './ultra/ssr-mask.ts';
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
  // Lacquered surfaces join the ULTRA screen-space reflection mask (a no-op
  // everywhere the SSR stage is not running).
  for (const lacquer of [materials.paint, materials.secondary, materials.accent])
    installSsrMask(lacquer);
  // Visible carbon covers are lacquered (REF 056 tank cover, REF 073): a
  // deep clear coat over the twill, so the weave flips under sky reflections.
  // Inner and structural carbon uses the raw satin finish instead.
  materials.carbon.roughness = 0.42;
  // Race lacquer is a full, deep coat (several flatted layers): crisp sky
  // reflections over the weave on wings and covers, not a hazy film.
  materials.carbon.clearcoat = 1;
  materials.carbon.clearcoatRoughness = 0.045;
  installSsrMask(materials.carbon);
  materials.aluminium.roughness = 0.41;
  materials.wheel.roughness = 0.42;
  materials.wheel.clearcoat = 0.2;
  materials.wheel.clearcoatRoughness = 0.24;
  // Brushed and turned metal (High/ULTRA, setGpMetalAnisotropy): the
  // highlight stretches across the tool marks. The brushed frame map's marks
  // run along U, a turned tube's around its circumference (U), so both
  // stretch along V: the spar length and the tube axis.
  for (const metal of [materials.aluminium, materials.forkUpper, materials.forkLower])
    if (metal instanceof T.MeshPhysicalMaterial) metal.anisotropyRotation = Math.PI / 2;
  materials.aluminium.userData.gpAnisotropy = GP_METAL_ANISOTROPY.brushed;
  materials.forkUpper.userData.gpAnisotropy = GP_METAL_ANISOTROPY.turned;
  materials.forkLower.userData.gpAnisotropy = GP_METAL_ANISOTROPY.polished;
  // Coloured headers supply a vertex attribute, but the old plain-cylinder
  // silencers did not. Mark their missing-attribute fallback explicitly.
  materials.titanium.userData.gpBareTitanium = true;
  materials.titanium.roughness = 0.4;
  installGpTitaniumOxideGloss(materials.titanium);
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
  materials.reservoir.vertexColors = true;
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
  installGpOpticalRain(materials.screen, materials.opticalRain);
  installGpOpticalRain(materials.screenLight, materials.opticalRain);
  // The rain optic uses bright diode centres and a smoked surround. Each
  // close-up lens samples one emitter, the distant strip the entire array.
  materials.lamp.color.setHex(0x1c0404);
  materials.lamp.roughness = 0.22;
  materials.lamp.emissiveMap = gpTailLampMap();
  materials.screenLight.color.setHex(0x9aa6ad);
  materials.screenLight.metalness = 0;
  materials.screenLight.opacity = 0.3;
  materials.screenLight.roughness = 0.12;
  return true;
}

/** Anisotropy strengths of the GP machine's metals (three.js
 * KHR_materials_anisotropy): brushed frame aluminium, the hard-anodised
 * turned outer fork tubes, and the superfinished stanchions. */
export const GP_METAL_ANISOTROPY = Object.freeze({ brushed: 0.62, turned: 0.45, polished: 0.22 });
/** Switch the anisotropic lobes with the graphics tier. Crossing zero
 * recompiles once (three.js keys USE_ANISOTROPY), so this only flips when the
 * preset changes; it is idempotent per frame. */
export function setGpMetalAnisotropy(
  materials: Pick<BikeMaterials, 'aluminium' | 'forkUpper' | 'forkLower'>,
  enabled: boolean,
) {
  for (const metal of [materials.aluminium, materials.forkUpper, materials.forkLower]) {
    const strength = metal.userData.gpAnisotropy;
    if (typeof strength !== 'number' || !(metal instanceof T.MeshPhysicalMaterial)) continue;
    const target = enabled ? strength : 0;
    if (metal.anisotropy !== target) metal.anisotropy = target;
  }
}
/** Temper oxide is a smooth glassy TiO2 film over burnished metal, so the
 * coloured bands mirror the sky more sharply than bare titanium. The band
 * strength is the authored vertex tint's chroma (bare grey: none), which
 * survives static batching; ALU only, no texture, no new attribute. */
export const GP_TITANIUM_OXIDE_GLOSS = 0.62;
export function installGpTitaniumOxideGloss(material: T.Material): boolean {
  return chainShaderHook(material, 'gp-titanium-oxide-v1', (shader) => {
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `#ifdef USE_COLOR
{
  float gpTiHi=max(max(vColor.r,vColor.g),vColor.b),
    gpTiLo=min(min(vColor.r,vColor.g),vColor.b);
  float gpTiFilm=smoothstep(.1,.45,(gpTiHi-gpTiLo)/max(gpTiHi,.001));
  roughnessFactor*=mix(1.,${GP_TITANIUM_OXIDE_GLOSS.toFixed(2)},gpTiFilm);
}
#endif`,
      'fragment',
    );
  });
}

/** Emissive pattern of the tail rain light: two rows of round diodes on a
 * near-black lens, with a faint glow floor so the lens still reads lit. Linear
 * data in the lamp's emissive colour space (sRGB, like any emissive map). */
export const GP_TAIL_LED = Object.freeze({ columns: 8, rows: 2, floor: 0.07 });
function gpTailLampMap() {
  const w = 128,
    h = 32,
    { columns, rows, floor } = GP_TAIL_LED,
    data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const cx = ((Math.floor((x / w) * columns) + 0.5) / columns) * w,
        cy = ((Math.floor((y / h) * rows) + 0.5) / rows) * h,
        d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.0) / (0.3 * (h / rows)),
        led = Math.min(1, Math.max(0, 1.6 - d * 1.6)),
        v = Math.round(255 * Math.max(floor, led));
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  const texture = new T.DataTexture(data, w, h, T.RGBAFormat);
  texture.name = 'GP tail LED array (emissive)';
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
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

/** Empty portion above the front flank of the 2048×1024 shell atlas. Long
 * coordinate runs from the leading lip to the trailing lip, width across
 * the tyre. The narrower strip beneath it belongs to the raw underside. */
export const GP_FENDER_ISLAND = Object.freeze({ x: 22, y: 12, length: 246, width: 54 });

/** A closed two-millimetre moulding, supported by the telescopic lower fork.
 * The R1 has one leading tongue and a long skirt. The R2 has a shallow
 * centre scallop, shorter tail and two raised shoulders. */
export function gpFrontFender(radius: number, detail: RiderDetail, variant: 'gpr1' | 'gpr2' = 'gpr1'): T.BufferGeometry {
  if (!Number.isFinite(radius) || radius < 0.2 || radius > 0.45)
    throw new Error('Invalid GP front tyre radius');
  const rows = detail === 'high' ? 26 : detail === 'mid' ? 14 : 6;
  const cols = detail === 'high' ? 6 : 4;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const count = (rows + 1) * (cols + 1);
  const island = GP_FENDER_ISLAND, r2 = variant === 'gpr2';
  for (let inner = 0; inner < 2; inner++) {
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      const width = 0.064 + 0.017 * Math.sin(Math.PI * t) - (r2 ? 0.006 : 0.002) * t;
      const sideStay = Math.sin(Math.PI * t) ** 3;
      for (let j = 0; j <= cols; j++) {
        const u = (j / cols) * 2 - 1;
        const side = Math.abs(u), shoulder = Math.sin(Math.PI * side);
        const leading = r2 ? 0.79 - 0.11 * shoulder + 0.08 * side ** 2 : 0.70 + 0.17 * side ** 2;
        const trailing = (r2 ? 2.50 : 2.63) - 0.17 * side ** 2 + 0.045 * shoulder;
        const angle = T.MathUtils.lerp(leading, trailing, t);
        const rib = (r2 ? 0.004 * shoulder : 0.0015 * (1 - side)) * sideStay;
        const r = radius + 0.041 - 0.023 * u * u - 0.023 * side ** 3 * sideStay + rib - inner * 0.002;
        positions.push(u * width, Math.sin(angle) * r, Math.cos(angle) * r);
        const across = inner ? island.y + island.width + 7 + 4 * j / cols : island.y + island.width * j / cols;
        uvs.push((island.x + island.length * t) / 2048, 1 - across / 1024);
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

/** Heat soak on the formed silencer shell (local +Y inlet, -Y outlet): a
 * faint straw temper where the hot header gas enters, bare burnished metal
 * along the cooled body, and a gold-bronze ring on the rolled outlet lip that
 * the exhaust stream licks. Vertex colour multiplies the calibrated titanium
 * base, so bare stays exactly 1; the lathe's around-angle adds slight
 * unevenness. Authored here, so bindGpBareMetal preserves it verbatim. */
export function gpSilencerHeatSoak(geometry: T.BufferGeometry): T.BufferGeometry {
  const p = geometry.getAttribute('position');
  if (!p) throw new Error('Missing GP silencer positions');
  const colours = new Float32Array(p.count * 3),
    straw = new T.Color(0xe9d6a4),
    bronze = new T.Color(0xc39255),
    c = new T.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i),
      a = Math.atan2(z, x),
      uneven = 0.85 + 0.15 * Math.sin(a * 3 + 0.6),
      inlet = T.MathUtils.smoothstep(y, 0.06, 0.15) * 0.75 * uneven,
      lip = (1 - T.MathUtils.smoothstep(y, -0.15, -0.125)) * 0.6 * uneven;
    c.setRGB(1, 1, 1).lerp(straw, inlet).lerp(bronze, lip);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  return geometry;
}

/** A cut steel liner. The faces and normals point into the gas passage.
 * Each punched hole has its own aperture and reveals the darker bore behind. */
function perforatedLiner(radius: number, length: number): T.BufferGeometry {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    colours: number[] = [],
    indices: number[] = [];
  const cells = 12,
    rows = 2;
  const perimeter = [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 1],
    [0, 1],
    [0, 0.5],
  ];
  for (let row = 0; row < rows; row++) {
    for (let cell = 0; cell < cells; cell++) {
      const base = positions.length / 3;
      for (let ring = 0; ring < 2; ring++) {
        for (let corner = 0; corner < 8; corner++) {
          const angle = ((corner - 3) * Math.PI) / 4;
          const u = ring ? 0.5 + (row ? 0.1 : -0.1) + 0.23 * Math.cos(angle) : perimeter[corner][0];
          const v = ring ? 0.5 + 0.265 * Math.sin(angle) : perimeter[corner][1];
          const arc = (cell + u) / cells,
            depth = (row + v) / rows;
          const phi = arc * Math.PI * 2,
            sin = Math.sin(phi),
            cos = Math.cos(phi);
          positions.push(radius * sin, depth * length, radius * cos);
          normals.push(-sin, 0, -cos);
          uvs.push(arc, depth);
          const patina = (0.63 - 0.33 * depth) * (ring ? 0.78 : 1);
          colours.push(patina, patina * 0.81, patina * 0.65);
        }
      }
      for (let i = 0; i < 8; i++) {
        const next = (i + 1) % 8;
        indices.push(
          base + i,
          base + i + 8,
          base + next,
          base + i + 8,
          base + next + 8,
          base + next,
        );
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  return geometry;
}

function exhaustMesh(
  root: T.Group,
  geometry: T.BufferGeometry,
  material: T.Material,
  name: string,
) {
  bindGpBareMetal(geometry, material);
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = mesh.receiveShadow = true;
  root.add(mesh);
  return mesh;
}

/** Local +Y goes into the pipe. The rolled rim is open; only the deeply
 * recessed end and the wall behind the perforations close the line of sight. */
function addExhaustThroat(
  root: T.Group,
  materials: BikeMaterials,
  lip: number,
  radius: number,
  depth: number,
  segments: number,
  perforated: boolean,
) {
  const endRadius = radius * 0.93;
  exhaustMesh(
    root,
    new T.LatheGeometry(
      [new T.Vector2(endRadius, lip + depth), new T.Vector2(radius, lip)],
      segments,
    ),
    materials.dark,
    'Recessed silencer bore',
  );
  const end = exhaustMesh(
    root,
    new T.CircleGeometry(endRadius, segments),
    materials.dark,
    'Recessed exhaust baffle',
  );
  end.rotation.x = Math.PI / 2;
  end.position.y = lip + depth;
  if (perforated) {
    const core = exhaustMesh(
      root,
      perforatedLiner(radius * 0.925, depth * 0.4),
      materials.titanium,
      'Perforated exhaust liner',
    );
    core.position.y = lip + depth * 0.1;
  }
}

/** Rolled termination of the GP-R2's lateral under-engine exit. */
export function gpBellyOutlet(detail: RiderDetail, materials: BikeMaterials): T.Group {
  const root = new T.Group();
  root.name = 'GP lateral exhaust outlet';
  const segments = detail === 'high' ? 24 : 12;
  const profile = [
    [0.0235, 0.011],
    [0.0236, -0.001],
    [0.0244, -0.003],
    [0.0265, -0.0025],
    [0.027, 0.001],
    [0.0265, 0.009],
    [0.026, 0.014],
  ];
  exhaustMesh(
    root,
    new T.LatheGeometry(
      profile.map(([r, y]) => new T.Vector2(r, y)),
      segments,
    ),
    materials.titanium,
    'Rolled lateral exhaust mouth',
  );
  addExhaustThroat(root, materials, 0, 0.0232, 0.046, segments, detail === 'high');
  return root;
}

/** Hollow, tapered side silencer. Local -Y is the outlet. */
export function gpSilencer(
  detail: RiderDetail,
  materials: BikeMaterials,
  prototype = true,
): T.Group {
  const root = new T.Group();
  root.name = 'GP formed titanium silencer';
  const segments = detail === 'high' ? 28 : 16;
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
  exhaustMesh(
    root,
    gpSilencerHeatSoak(
      new T.LatheGeometry(
        profile.map(([r, y]) => new T.Vector2(r, y)),
        segments,
      ),
    ),
    materials.titanium,
    'Rolled titanium shell and open outlet',
  );
  addExhaustThroat(root, materials, -0.152, 0.029, 0.08, segments, prototype && detail === 'high');
  const band = exhaustMesh(
    root,
    new T.CylinderGeometry(0.0565, 0.0565, 0.026, segments, 1, true),
    materials.carbon,
    'Carbon retention strap',
  );
  band.position.y = 0.074;
  return root;
}
