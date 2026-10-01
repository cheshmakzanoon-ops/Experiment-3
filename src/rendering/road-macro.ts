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
