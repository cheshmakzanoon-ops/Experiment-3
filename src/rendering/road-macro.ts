/** Road tone at the scale of metres to tens of metres: ageing variation and
 * resurfaced repair patches with sealed seams. The 0.64 m aggregate tile
 * averages to one flat grey once mip-mapped, so beyond about 20 m the road had
 * no visible structure apart from the laid rubber. Presentation only: grip,
 * water and deposits come from the simulation's track state as before. */
export const ROAD_MACRO = Object.freeze({
  /** Along-track cell that may hold one repair patch, metres. */
  cell: 37,
  /** Chance that a cell holds a patch. */
  chance: 0.22,
  /** Patch length range, metres. */
  length: [3, 16] as const,
  /** Share of patches that span the whole road width (the rest cover a lane). */
  fullWidth: 0.35,
  /** Lane patch half-width range and centre range from the centreline, metres. */
  halfWidth: [1.6, 3.2] as const,
  centre: [-4, 4] as const,
  /** Albedo of fresh (darker) and faded (lighter) repairs, and the share fresh. */
  fresh: 0.82,
  faded: 1.07,
  freshShare: 0.6,
  /** Sealant line half-width, metres, and how much it darkens. */
  seam: 0.05,
  seamDarkening: 0.35,
  /** Broad and mid-scale tone ranges (albedo factors). */
  broad: [0.92, 1.06] as const,
  mid: [0.95, 1.04] as const,
});

/** The shader's hash (Hoskins' hash12): stable at lap-scale coordinates. */
export function roadHash(x: number, y: number) {
  const f = (v: number) => v - Math.floor(v);
  let a = f(x * 0.1031),
    b = f(y * 0.1031),
    c = f(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return f((a + b) * c);
}

export interface RoadPatch {
  start: number;
  length: number;
  /** Lateral extent from the centreline, metres (±30 for a full-width patch). */
  low: number;
  high: number;
  tone: number;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The patch the shader draws in along-track cell `cell`, if any. */
export function roadPatch(cell: number): RoadPatch | null {
  const M = ROAD_MACRO,
    h = (k: number) => roadHash(cell, k + 0.5);
  if (h(0) >= M.chance) return null;
  const length = mix(M.length[0], M.length[1], h(1));
  const start = cell * M.cell + h(2) * (M.cell - length);
  const full = h(3) < M.fullWidth;
  const half = mix(M.halfWidth[0], M.halfWidth[1], h(4)),
    centre = mix(M.centre[0], M.centre[1], h(5));
  return {
    start,
    length,
    low: full ? -30 : centre - half,
    high: full ? 30 : centre + half,
    tone: h(6) < M.freshShare ? M.fresh : M.faded,
  };
}

/** Every patch on a lap of `length` metres. */
export function roadPatches(length: number) {
  const patches: RoadPatch[] = [];
  for (let cell = 0; cell * ROAD_MACRO.cell < length; cell++) {
    const patch = roadPatch(cell);
    if (patch && patch.start + patch.length <= length) patches.push(patch);
  }
  return patches;
}

const f = (v: number) => v.toFixed(4);

/** Functions for the road shader's common section. */
export const ROAD_MACRO_GLSL = /* glsl */ `
float apexRoadHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float apexRoadNoise(vec2 p) {
  vec2 i = floor(p), q = fract(p), u = q * q * (3.0 - 2.0 * q);
  return mix(mix(apexRoadHash(i), apexRoadHash(i + vec2(1.0, 0.0)), u.x),
    mix(apexRoadHash(i + vec2(0.0, 1.0)), apexRoadHash(i + 1.0), u.x), u.y);
}
// m: (lateral, along-track) metres. Layers fade out where they would alias.
float apexRoadMacro(vec2 m) {
  vec2 dm = fwidth(m);
  float tone = mix(${f(ROAD_MACRO.broad[0])}, ${f(ROAD_MACRO.broad[1])}, apexRoadNoise(m * vec2(0.08, 0.025)));
  float midAA = 1.0 - smoothstep(0.25, 0.6, max(dm.x * 0.45, dm.y * 0.12));
  tone *= mix(1.0, mix(${f(ROAD_MACRO.mid[0])}, ${f(ROAD_MACRO.mid[1])}, apexRoadNoise(m * vec2(0.45, 0.12) + 17.0)), midAA);
  float cell = floor(m.y / ${f(ROAD_MACRO.cell)});
  if (apexRoadHash(vec2(cell, 0.5)) < ${f(ROAD_MACRO.chance)}) {
    float len = mix(${f(ROAD_MACRO.length[0])}, ${f(ROAD_MACRO.length[1])}, apexRoadHash(vec2(cell, 1.5)));
    float s0 = cell * ${f(ROAD_MACRO.cell)} + apexRoadHash(vec2(cell, 2.5)) * (${f(ROAD_MACRO.cell)} - len);
    bool full = apexRoadHash(vec2(cell, 3.5)) < ${f(ROAD_MACRO.fullWidth)};
    float halfWidth = mix(${f(ROAD_MACRO.halfWidth[0])}, ${f(ROAD_MACRO.halfWidth[1])}, apexRoadHash(vec2(cell, 4.5)));
    float centre = mix(${f(ROAD_MACRO.centre[0])}, ${f(ROAD_MACRO.centre[1])}, apexRoadHash(vec2(cell, 5.5)));
    float lo = full ? -30.0 : centre - halfWidth, hi = full ? 30.0 : centre + halfWidth;
    float d = min(min(m.y - s0, s0 + len - m.y), min(m.x - lo, hi - m.x));
    float aa = max(max(dm.x, dm.y), 1e-4);
    float patchTone = apexRoadHash(vec2(cell, 6.5)) < ${f(ROAD_MACRO.freshShare)} ? ${f(ROAD_MACRO.fresh)} : ${f(ROAD_MACRO.faded)};
    tone *= mix(1.0, patchTone, smoothstep(-aa, aa, d));
    // Sealant along the cut, dropped once it is narrower than a pixel.
    float seam = 1.0 - smoothstep(${f(ROAD_MACRO.seam)} - aa, ${f(ROAD_MACRO.seam)} + aa, abs(d));
    tone *= 1.0 - ${f(ROAD_MACRO.seamDarkening)} * seam * (1.0 - smoothstep(0.06, 0.25, aa));
  }
  return tone;
}
`;

/** Applied to the road albedo right after the base map. */
export const ROAD_MACRO_APPLY = 'diffuseColor.rgb *= apexRoadMacro(vRoadMetres);\n';

/** Small sealed repairs on top of the macro layer: cut-and-filled rectangles a
 * lane or less across, 10-15 % darker and a little smoother than the road,
 * bordered by a thin sealant seam. Presentation only, like ROAD_MACRO. */
export const ROAD_REPAIRS = Object.freeze({
  /** Along-track cell that may hold one repair, metres. */
  cell: 23,
  chance: 0.3,
  /** Repair length and half-width ranges, metres. */
  length: [1, 4] as const,
  halfWidth: [0.5, 1.8] as const,
  /** Centre range from the centreline, metres (inside the 8 m half-width). */
  centre: [-5, 5] as const,
  /** Albedo factor range: 10-15 % darker. */
  tone: [0.85, 0.9] as const,
  /** Roughness reduction of the fresh binder. */
  roughness: 0.05,
  /** Sealant seam half-width along the cut, metres. */
  seam: 0.012,
});

/** The repair the shader draws in along-track cell `cell` of a lap of
 * `lapLength` metres, if any. The last, partial cell never holds one, so no
 * repair is cut by the start-line wrap. */
export function roadRepair(cell: number, lapLength: number): RoadPatch | null {
  const R = ROAD_REPAIRS,
    h = (k: number) => roadHash(cell, k + 20.5);
  if (!(lapLength > 0) || (cell + 1) * R.cell > lapLength || h(0) >= R.chance) return null;
  const length = mix(R.length[0], R.length[1], h(1));
  const start = cell * R.cell + h(2) * (R.cell - length);
  const half = mix(R.halfWidth[0], R.halfWidth[1], h(3)),
    centre = mix(R.centre[0], R.centre[1], h(4));
  return {
    start,
    length,
    low: centre - half,
    high: centre + half,
    tone: mix(R.tone[0], R.tone[1], h(5)),
  };
}

/** Meandering crack sealant ("tar snakes"): iso-lines of a world-space noise
 * inside sparse crack regions. Fresh bitumen, glossier than the road. */
export const ROAD_SEALANT = Object.freeze({
  /** sRGB colour of the sealant. */
  colour: 0x2a2927,
  /** Line half-width range, metres (lines 1-2 cm wide). */
  halfWidth: [0.005, 0.01] as const,
  roughness: 0.45,
  /** Meander frequency (1/m) of the crack field. */
  frequency: 0.55,
  /** Frequency (1/m) and threshold range of the regions that carry cracks. */
  region: 0.045,
  regionThreshold: [0.6, 0.7] as const,
});

const linear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const sealant = [16, 8, 0].map((shift) => linear((ROAD_SEALANT.colour >> shift) & 255));

/** Repairs and sealant for the road shader's common section. Uses the macro
 * layer's hash and noise, so ROAD_MACRO_GLSL must precede it. */
export const ROAD_REPAIR_GLSL = /* glsl */ `
const vec3 apexSealantColour = vec3(${sealant.map(f).join(', ')});
// x: repair coverage, y: repair albedo factor, z: seam coverage.
vec3 apexRoadRepair(vec2 m, float lap) {
  // Footprint per axis, taken before the per-cell early return.
  vec2 dm = max(fwidth(m), vec2(1e-4));
  float cell = floor(m.y / ${f(ROAD_REPAIRS.cell)});
  if ((cell + 1.0) * ${f(ROAD_REPAIRS.cell)} > lap || apexRoadHash(vec2(cell, 20.5)) >= ${f(ROAD_REPAIRS.chance)})
    return vec3(0.0, 1.0, 0.0);
  float len = mix(${f(ROAD_REPAIRS.length[0])}, ${f(ROAD_REPAIRS.length[1])}, apexRoadHash(vec2(cell, 21.5)));
  float s0 = cell * ${f(ROAD_REPAIRS.cell)} + apexRoadHash(vec2(cell, 22.5)) * (${f(ROAD_REPAIRS.cell)} - len);
  float halfWidth = mix(${f(ROAD_REPAIRS.halfWidth[0])}, ${f(ROAD_REPAIRS.halfWidth[1])}, apexRoadHash(vec2(cell, 23.5)));
  float centre = mix(${f(ROAD_REPAIRS.centre[0])}, ${f(ROAD_REPAIRS.centre[1])}, apexRoadHash(vec2(cell, 24.5)));
  float tone = mix(${f(ROAD_REPAIRS.tone[0])}, ${f(ROAD_REPAIRS.tone[1])}, apexRoadHash(vec2(cell, 25.5)));
  float dy = min(m.y - s0, s0 + len - m.y), dx = min(m.x - centre + halfWidth, centre + halfWidth - m.x);
  // Distance to the nearest cut and the pixel footprint across that cut:
  // lateral for the long sides, along-track for the ends. An isotropic
  // footprint smeared the long seams several pixels wide at grazing angles.
  float d = min(dx, dy), fd = dx < dy ? dm.x : dm.y;
  // Box-filtered fill and seam: the seam's exact pixel coverage, so it thins
  // with distance instead of widening. The whole outline drops out together
  // once the coarser footprint is far sub-pixel (no lone side dashes).
  float seam = clamp((min(d + 0.5 * fd, ${f(ROAD_REPAIRS.seam)}) - max(d - 0.5 * fd, -${f(ROAD_REPAIRS.seam)})) / fd, 0.0, 1.0)
    * (1.0 - smoothstep(0.04, 0.2, max(dm.x, dm.y)));
  return vec3(clamp(d / fd + 0.5, 0.0, 1.0), tone, seam);
}
// Coverage of crack sealant at world position p (metres): a domain-warped
// iso-line, broken into separate runs, inside sparse crack regions. Box-
// filtered over the pixel footprint; dropped once far narrower than a pixel.
float apexRoadSealant(vec2 p) {
  float region = smoothstep(${f(ROAD_SEALANT.regionThreshold[0])}, ${f(ROAD_SEALANT.regionThreshold[1])},
    apexRoadNoise(p * ${f(ROAD_SEALANT.region)} + vec2(31.7, 12.9)));
  if (region <= 0.0) return 0.0;
  vec2 q = p * ${f(ROAD_SEALANT.frequency)};
  // Cracks wander at several scales: warp the field by finer noise.
  q += (vec2(apexRoadNoise(p * 2.9 + vec2(1.3, 8.1)), apexRoadNoise(p * 2.9 + vec2(9.4, 2.6))) - 0.5) * 0.55;
  q += (vec2(apexRoadNoise(p * 9.0 + vec2(5.5, 0.7)), apexRoadNoise(p * 9.0 + vec2(2.2, 6.6))) - 0.5) * 0.12;
  float n = apexRoadNoise(q) * 0.7 + apexRoadNoise(q * 2.3 + vec2(7.1, 3.3)) * 0.3;
  // Runs of sealant a metre or two long, not closed contour loops.
  float run = smoothstep(0.42, 0.58, apexRoadNoise(p * 0.9 + vec2(17.3, 4.4)));
  float metresPerPixel = max(length(fwidth(p)), 1e-5);
  float halfWidth = mix(${f(ROAD_SEALANT.halfWidth[0])}, ${f(ROAD_SEALANT.halfWidth[1])},
    apexRoadNoise(p * 1.9 + vec2(4.2, 9.7))) * run / metresPerPixel;
  float distancePx = abs(n - 0.5) / max(fwidth(n), 1e-6);
  float coverage = clamp(min(2.0 * halfWidth, halfWidth + 0.5 - distancePx), 0.0, 1.0);
  return coverage * region * smoothstep(0.08, 0.3, 2.0 * halfWidth);
}
`;
