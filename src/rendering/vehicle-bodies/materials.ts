import * as T from 'three';
import { carbonMaterial } from '../materials.ts';
import { glass as libraryGlass } from '../materials/library.ts';
import {
  applyPaintFinish,
  installPaintFinish,
  installPaintFlakes,
  PAINT_FINISHES,
  type PaintFinish,
} from '../paint-finish.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { installGrazingCap } from '../studio/grazing-cap.ts';
import { acquireTyreStamp, roadTyreFunctions, type RoadTyreSize } from './road-tyre-mould.ts';
import { installBodyLayers, type LayerFrame } from './body-livery.ts';

/** Material kit for procedural vehicle bodies (WP30). Paint is the house
 * clear-coat finish (object-space pigment grain, metallic flake normals and
 * orange peel from paint-finish.ts) plus baked panel-gap lines; aero parts use
 * the house carbon weave; glass is a separate tinted, reflective layer; lamps
 * are emissive and driven from the snapshot. Shared materials are cached by
 * key so a grid of identical cars compiles one program per role. */
export interface PanelGap {
  /** Plane normal (car frame, unit) and offset: the line is |n·p - d| < width. */
  n: readonly [number, number, number];
  d: number;
  /** Axis-aligned bounds the line is drawn inside (car frame, m). */
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}
const glslVec = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(4)).join(',')})`;
/** Recessed panel shut lines: a dark, rougher 2.5 mm groove with a filtered
 * edge that fades to its mean once it is thinner than a pixel. */
export function installPanelGaps(material: T.MeshPhysicalMaterial, gaps: readonly PanelGap[]) {
  if (!gaps.length) return false;
  installPaintFinish(material);
  const body = gaps
    .map(
      (g) => `{
      vec3 lo = ${glslVec(g.min)}, hi = ${glslVec(g.max)};
      vec3 p = vec3(abs(vPaintPosition.x), vPaintPosition.yz);
      float distanceToPlane = dot(p, ${glslVec(g.n)}) - ${g.d.toFixed(4)};
      float pixel = max(fwidth(distanceToPlane), 1e-5);
      if (all(greaterThanEqual(p, lo)) && all(lessThanEqual(p, hi))) {
        float loEdge = max(distanceToPlane - 0.5 * pixel, -0.00125);
        float hiEdge = min(distanceToPlane + 0.5 * pixel, 0.00125);
        gap = max(gap, clamp((hiEdge - loEdge) / pixel, 0.0, 1.0));
      }
    }`,
    )
    .join('\n');
  // All plane equations and clipping bounds participate in shader identity.
  let hash = 2166136261;
  for (let i = 0; i < body.length; i++) hash = Math.imul(hash ^ body.charCodeAt(i), 16777619);
  const key = `vehicle-panel-gaps-${hash >>> 0}-v2`;
  return chainShaderHook(material, key, (shader) => {
    injectAfter(
      shader,
      'color_fragment',
      `float gap = 0.0;\n${body}\ngap = clamp(gap, 0.0, 1.0);\ndiffuseColor.rgb *= 1.0 - 0.82 * gap;`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor = mix(roughnessFactor, 0.9, gap);',
      'fragment',
    );
  });
}
/** Per-car clear-coat paint with metallic flake and panel gaps. With a
 * `layers` frame the paint also carries the two-tone/stripe layer hook
 * (body-livery.ts), installed before the gaps so shut lines still cut the
 * second colour. */
export function bodyPaint(
  color: number,
  finish: PaintFinish,
  gaps: readonly PanelGap[] = [],
  layers?: LayerFrame,
) {
  const material = new T.MeshPhysicalMaterial({ color });
  applyPaintFinish(material, finish);
  material.userData.weatherExposure = 1;
  installPaintFinish(material);
  const f = PAINT_FINISHES[finish];
  installPaintFlakes(material, f.flake, f.peel);
  installGrazingCap(material);
  if (layers) installBodyLayers(material, layers);
  installPanelGaps(material, gaps);
  return material;
}
const cache = new Map<string, T.Material>();
function shared<M extends T.Material>(key: string, make: () => M): M {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = make()));
  return m as M;
}
export const sharedMaterials = {
  carbon: () => shared('carbon', () => carbonMaterial('lacquered')),
  carbonSatin: () => shared('carbon-satin', () => carbonMaterial('satin')),
  /** Race glazing (polycarbonate side and rear windows, laminated screen)
   * from the shared material library: Fresnel-weighted, premultiplied
   * transmission, so reflections are never dimmed by the transmitted share and
   * grazing angles reflect more and transmit less. Blended, not screen-space
   * transmissive: no extra opaque transmission pass per view (frame budget,
   * section 17). Double-sided in one pass so the inner face is seen from the
   * cockpit; it writes no depth, so it never hides what lies behind it. */
  glass: () => shared('glass', () => cabinGlass(0x6f7c84, 0.86, 0.035, 'race')),
  /** Road glazing: laminated green-tinted glass, a little less transmissive. */
  roadGlass: () => shared('road-glass', () => cabinGlass(0x5a7268, 0.8, 0.02, 'road')),
  /** Gloss black trims, window rubbers, mirror stalks. */
  trim: () =>
    shared(
      'trim',
      () => new T.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.38, metalness: 0.1 }),
    ),
  /** Satin black plastic (grilles' frames, undertrays, wheel-arch liners). */
  plastic: () =>
    shared(
      'plastic',
      () => new T.MeshStandardMaterial({ color: 0x141517, roughness: 0.78, metalness: 0 }),
    ),
  grille: () => shared('grille', grilleMaterial),
  /** Always-on emissive light bar (electric signature lighting): a dark
   * housing colour with a strong emission, so the line stays visible in full
   * sun and blooms at dusk. One material per colour, shared by the catalogue. */
  lightBar: (color: number) =>
    shared(`light-bar-${color}`, () => {
      const material = new T.MeshStandardMaterial({
        color: 0x0a1317,
        emissive: color,
        emissiveIntensity: 2.6,
        roughness: 0.32,
        metalness: 0.1,
      });
      material.name = 'Signature light bar';
      material.userData.vehicleLightBar = true;
      return material;
    }),
  chrome: () =>
    shared(
      'chrome',
      () => new T.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.16, metalness: 1 }),
    ),
  /** Heat-blued titanium exhaust tips. */
  exhaust: () =>
    shared(
      'exhaust',
      () => new T.MeshStandardMaterial({ color: 0x6d6a7a, roughness: 0.3, metalness: 1 }),
    ),
  interior: () =>
    shared(
      'interior',
      () => new T.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.85, metalness: 0 }),
    ),
  /** The dark lid under the glass of a far LOD (parcel shelf, engine cover,
   * tonneau, a single-seater's cockpit opening): the interior's finish, but
   * tagged so the shadow proxy lets sunlight through it into the near
   * cabin. Seats and other solid trim keep `interior` and cast shadows. */
  cabinLid: () =>
    shared('cabin-lid', () => {
      const material = new T.MeshStandardMaterial({
        color: 0x1a1b1d,
        roughness: 0.85,
        metalness: 0,
      });
      material.userData.cabinLid = true;
      return material;
    }),
  /** Seat-belt webbing (race harness and road belts). */
  harness: () =>
    shared(
      'harness',
      () => new T.MeshStandardMaterial({ color: 0x8e1018, roughness: 0.82, metalness: 0 }),
    ),
  /** Road-car seat and door leather. */
  leather: () =>
    shared(
      'leather',
      () => new T.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.52, metalness: 0 }),
    ),
  steel: () =>
    shared(
      'steel',
      () => new T.MeshStandardMaterial({ color: 0x5f6266, roughness: 0.42, metalness: 0.9 }),
    ),
  /** A driver's face in an open-face helmet. */
  skin: () =>
    shared(
      'skin',
      () => new T.MeshStandardMaterial({ color: 0xb9836a, roughness: 0.68, metalness: 0 }),
    ),
  visor: () =>
    shared(
      'visor',
      () =>
        new T.MeshPhysicalMaterial({
          color: 0x07090c,
          roughness: 0.05,
          metalness: 0.3,
          clearcoat: 1,
          clearcoatRoughness: 0.02,
        }),
    ),
  lens: () =>
    shared(
      'lens',
      () =>
        new T.MeshPhysicalMaterial({
          color: 0xffffff,
          roughness: 0.02,
          transparent: true,
          opacity: 0.25,
          clearcoat: 1,
          clearcoatRoughness: 0.01,
        }),
    ),
  rim: (color: number) =>
    shared(
      `rim-${color}`,
      () => new T.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.88 }),
    ),
  caliper: (color: number, vertexColors = false) =>
    shared(
      `caliper-${vertexColors ? 'cast' : color}`,
      () =>
        new T.MeshPhysicalMaterial({
          color: vertexColors ? 0xffffff : color,
          vertexColors,
          roughness: 0.35,
          metalness: 0.2,
          clearcoat: 0.8,
          clearcoatRoughness: 0.1,
        }),
    ),
  suit: (color: number) =>
    shared(
      `suit-${color}`,
      () => new T.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0 }),
    ),
};
/** Cabin glazing from the library glass: tint, normal-incidence
 * transmission and roughness; double-sided in a single pass. The tint is the
 * colour of the absorbed share's in-scatter, kept dark: clean glazing barely
 * scatters, so a bright tint would read as a milky haze in sunlight. */
function cabinGlass(tint: number, transmission: number, roughness: number, kind: string) {
  const material = libraryGlass({ tint, transmission, roughness });
  material.name = `Vehicle ${kind} glass`;
  material.side = T.DoubleSide;
  material.forceSinglePass = true;
  material.userData.vehicleGlass = kind;
  return material;
}
/** Honeycomb mesh: dark cells with lit edges, filtered to a mean when small. */
function grilleMaterial() {
  const material = new T.MeshStandardMaterial({ color: 0x08090a, roughness: 0.6, metalness: 0.4 });
  chainShaderHook(material, 'vehicle-grille-honeycomb-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vGrillePosition;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGrillePosition = position;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec3 vGrillePosition;', 'fragment');
    injectAfter(
      shader,
      'color_fragment',
      `{
        vec2 q = vec2(vGrillePosition.x + vGrillePosition.z, vGrillePosition.y) / 0.012;
        q.x += mod(floor(q.y), 2.0) * 0.5;
        vec2 cell = abs(fract(q) - 0.5);
        float edge = max(cell.x * 1.15, cell.y);
        float fw = max(fwidth(edge), 1e-4);
        float rim = smoothstep(0.42 - fw, 0.42 + fw, edge);
        rim = mix(rim, 0.3, smoothstep(0.15, 0.4, fw));
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.35, vec3(0.06), rim);
      }`,
      'fragment',
    );
  });
  return material;
}
/** Lamp lens with its reflector: emissive intensity is driven per frame. */
export function lampMaterial(color: number, emissive: number) {
  const material = new T.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0,
    roughness: 0.12,
    metalness: 0.55,
  });
  material.userData.apexSpecularIBL = true;
  return material;
}
/** Disc with a heat glow driven from the recorded disc temperature. */
export function discMaterial() {
  return new T.MeshStandardMaterial({
    color: 0x4b4d50,
    roughness: 0.42,
    metalness: 0.85,
    emissive: 0xff4a12,
    emissiveIntensity: 0,
  });
}
export type TreadPattern = 'slick' | 'road' | 'block' | 'rib';
/** Rubber with a deforming loaded contact patch and a rolling tread pattern.
 * The tyre mesh does not spin (its bulge stays at the road); the tread and
 * sidewall marks roll with `pose.x` (wheel phase). pose = (phase, deflection
 * m, tyre radius m, sidewall bulge m). */
export function tyreMaterial(pattern: TreadPattern, size?: RoadTyreSize, poseOnly = false) {
  const material = new T.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.86, metalness: 0 });
  const pose = { value: new T.Vector4(0, 0, 0.33, 0) };
  material.userData.weatherExposure = 1;
  const mould = { value: new T.Vector2(size ? size.rim / size.radius : 0, 0) };
  const stamp = size && acquireTyreStamp(size, pattern);
  if (stamp) material.addEventListener('dispose', stamp.release);
  const roadSipes = size
    ? 'roadSipe(around * 64.0 + across * 3.0, 0.08, max(tyreSpan*64.0, 3.0*fwidth(across)))'
    : 'sipe(around * 64.0 + across * 3.0, 0.08)';
  const blocks = size
    ? 'roadSipe(around * 40.0 + step(0.0, across) * 0.5, 0.22, tyreSpan*40.0)'
    : 'sipe(around * 40.0 + step(0.0, across) * 0.5, 0.22)';
  const grooves =
    pattern === 'slick'
      ? '0.0'
      : pattern === 'road'
        ? `max(max(groove(across, 0.34, 0.035), groove(across, -0.34, 0.035)),
              max(groove(across, 0.0, 0.03) , ${roadSipes} * step(0.42, abs(across))))`
        : pattern === 'block'
          ? `max(${blocks} * step(0.12, abs(across)),
              max(groove(across, 0.0, 0.06), max(groove(across, 0.45, 0.05), groove(across, -0.45, 0.05))))`
          : `max(groove(across, 0.25, 0.02), max(groove(across, -0.25, 0.02), groove(across, 0.0, 0.02)))`;
  chainShaderHook(
    material,
    `vehicle-tyre-${pattern}${poseOnly ? '-pose' : ''}${size ? '-road' : ''}${stamp ? '-stamp' : ''}-v2`,
    (shader) => {
      if (size) shader.uniforms.tyreMould = mould;
      if (stamp) shader.uniforms.tyreStamp = { value: stamp.texture };
      shader.uniforms.tyrePose = pose;
      injectDeclarations(
        shader,
        'common',
        `uniform vec4 tyrePose; attribute vec3 tyreBind; varying vec3 vTyreBind; ${size ? 'varying vec2 tyreRadial;' : ''}`,
        'vertex',
      );
      injectAfter(
        shader,
        'begin_vertex',
        `vTyreBind = tyreBind; ${size ? 'tyreRadial = position.yz;' : ''}
      {
        // Loaded contact: flatten the crown below the hub to the deflected
        // radius and bulge the lower sidewalls; the hub frame is upright.
        float r = length(transformed.yz);
        float crown = smoothstep(0.6, 0.95, tyreBind.y);
        float low = max(0.0, -transformed.y / max(r, 1e-4));
        float flatRadius = tyrePose.z - tyrePose.y;
        if (transformed.y < -flatRadius) transformed.y = mix(transformed.y, -flatRadius, crown);
        transformed.x += sign(transformed.x) * tyrePose.w * pow(low, 6.0) * (1.0 - crown) * smoothstep(0.2, 0.6, tyreBind.y);
      }`,
        'vertex',
      );
      if (poseOnly) return;
      injectDeclarations(
        shader,
        'common',
        `uniform vec4 tyrePose; varying vec3 vTyreBind;
      ${size ? roadTyreFunctions : ''}
      ${stamp ? 'uniform sampler2D tyreStamp;' : ''}
      float groove(float a, float c, float w) { float fw = max(fwidth(a), 1e-4); return 1.0 - smoothstep(w - fw, w + fw, abs(a - c)); }
      float sipe(float s, float w) { float f = abs(fract(s) - 0.5); float fw = max(fwidth(s), 1e-4); return (1.0 - smoothstep(w - fw, w + fw, f)) * (1.0 - smoothstep(0.2, 0.5, fw)); }`,
        'fragment',
      );
      injectAfter(
        shader,
        'color_fragment',
        `float across = vTyreBind.x;
      ${
        size
          ? `float around = (atan(tyreRadial.y,-tyreRadial.x) + tyrePose.x) / 6.2831853;
      vec2 angularPixel=aroundGradient(tyreRadial);
      float tyreSpan=max(tyreMould.y,abs(angularPixel.x)+abs(angularPixel.y));`
          : 'float around = (vTyreBind.z - tyrePose.x) / 6.2831853;'
      }
      float tyreCrown = smoothstep(0.86, 0.93, vTyreBind.y);
      float tyreGroove = (${grooves}) * tyreCrown;
      float sideRing = (1.0 - smoothstep(0.004, 0.012, abs(vTyreBind.y - 0.78))) * (1.0 - tyreCrown);
      diffuseColor.rgb *= (1.0 - 0.55 * tyreGroove) * mix(1.05, 0.92, tyreCrown);
      ${
        size
          ? `float wallHeight=(vTyreBind.y-tyreMould.x)/max(1.-tyreMould.x,.01);
      float beadRibbon=groove(wallHeight,.13,.015)+groove(wallHeight,.82,.008);
      float tyreRelief=0.;
      ${
        stamp
          ? `vec2 stampUv=vec2(around*sign(across),wallHeight);
      // Explicit unwrapped gradients keep filtering continuous across a revolution.
      // A half-pixel lower bound also averages fine stamps on distant wheels.
      vec2 uvDx=vec2(angularPixel.x*sign(across),dFdx(wallHeight));
      vec2 uvDy=vec2(angularPixel.y*sign(across),dFdy(wallHeight));
      float blur=tyreMould.y*.5;
      vec2 major=dot(uvDx,uvDx)>dot(uvDy,uvDy)?uvDx:uvDy;
      if (blur>abs(major.x)) major.x=major.x<0.?-blur:blur;
      vec2 minor=dot(uvDx,uvDx)>dot(uvDy,uvDy)?uvDy:uvDx;
      tyreRelief=.5*(textureGrad(tyreStamp,stampUv+vec2(blur*.5,0.),major,minor).r+
                     textureGrad(tyreStamp,stampUv-vec2(blur*.5,0.),major,minor).r);
      tyreRelief*=smoothstep(.06,.18,wallHeight)*(1.-smoothstep(.76,.91,wallHeight));`
          : ''
      }
      diffuseColor.rgb*=1.+.11*beadRibbon+.48*tyreRelief;`
          : 'diffuseColor.rgb += vec3(0.05) * sideRing;'
      }`,
        'fragment',
      );
      injectAfter(
        shader,
        'roughnessmap_fragment',
        `roughnessFactor = clamp(mix(0.62, roughnessFactor, tyreCrown) + 0.08 * tyreGroove ${size ? '- .12*tyreRelief' : ''}, 0.4, 1.0);`,
        'fragment',
      );
      injectAfter(
        shader,
        'normal_fragment_maps',
        `{
        float h = -0.003 * tyreGroove ${size ? '+ .00048*tyreRelief + .00019*beadRibbon' : ''};
        vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
        vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
        float det = dot(sx, r1);
        vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
        normal = normalize(max(abs(det), 1e-10) * normal - grad);
      }`,
        'fragment',
      );
    },
  );
  return { material, pose, mould };
}
/** The numeral on a board canvas (128 px square). */
export function paintNumber(ctx: CanvasRenderingContext2D, num: number, formula = false) {
  if (formula) {
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = 'italic 900 98px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111720';
    ctx.lineWidth = 10;
    ctx.strokeText(String(num), 61, 67, 108);
    ctx.fillStyle = '#f5f4ec';
    ctx.fillText(String(num), 61, 67, 108);
    return;
  }
  ctx.fillStyle = '#f4f4f1';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#111214';
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 64, 70);
}
/** White number board or a keylined Formula race numeral on a clear carrier. */
export function numberBoard(num: number, formula = false) {
  const material = new T.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.55 });
  if (formula) {
    material.userData.formulaNumber = true;
    material.alphaTest = 0.28;
    material.alphaToCoverage = true;
    material.roughness = 0.36;
  }
  if (typeof document === 'undefined') return material;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return material;
  paintNumber(ctx, num, formula);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  material.map = texture;
  return material;
}
