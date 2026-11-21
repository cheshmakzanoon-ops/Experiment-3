import { FARM_FIELDS, TRAMLINE } from '../../simulation/open-world/farm-fields.ts';

const g = (n: number) => n.toFixed(6);
const plots = FARM_FIELDS.map((f) => `
  if (abs(p.x - (${g(f.x)})) < ${g(f.boundX + 0.02)} && abs(p.y - (${g(f.z)})) < ${g(f.boundZ + 0.02)}) {
    origin = vec2(${g(f.x)}, ${g(f.z)}); axis = vec2(${g(f.dx)}, ${g(f.dz)});
    size = vec2(${g(f.length)}, ${g(f.width)}); pitch = ${g(f.spacing)};
    crop = ${f.crop === 'wheat' ? '1.0' : f.crop === 'barley' ? '2.0' : '3.0'};
  }`).join(' else ');

/** Terrain, tyres and nearby plants use the same field borders, row bearings
 * and tractor gauge. Pass pixel derivatives from outside all plot branches. */
export const FIELD_LAYER_GLSL = /* glsl */ `
uniform float owCultivated;
vec4 owFieldLayer(vec2 p, vec2 dx, vec2 dy, float meso, float grain) {
  if (owCultivated < 0.5 || p.y < -1485.0 || p.y > 190.0 || p.x < -2500.0 || p.x > 3230.0) return vec4(0.);
  vec2 origin = vec2(0.), axis = vec2(1., 0.), size = vec2(0.);
  float pitch = 1.0, crop = 0.;
  ${plots}
  if (crop < 0.5) return vec4(0.);
  vec2 across = vec2(-axis.y, axis.x), r = p - origin;
  vec2 uv = vec2(dot(r, axis), dot(r, across));
  float border = min(size.x - abs(uv.x), size.y - abs(uv.y));
  if (border <= 0.) return vec4(0.);
  float coverage = smoothstep(0., 1.15, border);
  float work = smoothstep(${g(TRAMLINE.headland)}, ${g(TRAMLINE.headland + 1.1)}, border);
  float footprint = max(abs(dot(dx, across)) + abs(dot(dy, across)), 0.0001);
  float lane = abs(uv.y - ${g(TRAMLINE.pitch)} * floor(uv.y / ${g(TRAMLINE.pitch)} + 0.5));
  float w = min(1.4, footprint * 0.5);
  float wheel = 1.0 - smoothstep(max(0., ${g(TRAMLINE.edge0)} - w), ${g(TRAMLINE.edge1)} + w, abs(lane - ${g(TRAMLINE.wheel)}));
  wheel = mix(0.0867, wheel, 1.0 - smoothstep(0.45, 3.2, footprint));
  float ridges = cos(6.283185 * uv.y / pitch) * (1. - smoothstep(pitch * 0.22, pitch * 0.9, footprint));
  float cut = cos(6.283185 * uv.y / 4.0) * (1. - smoothstep(1.2, 4., footprint));
  vec3 plant = crop < 1.5 ? vec3(0.34, 0.238, 0.080) : crop < 2.5 ? vec3(0.148, 0.193, 0.065) : vec3(0.225, 0.167, 0.095);
  plant *= (0.87 + 0.18 * meso + 0.09 * grain) * (1. + 0.13 * ridges + 0.065 * cut);
  vec3 rolled = vec3(0.126, 0.096, 0.058) * (0.85 + 0.28 * grain);
  vec3 headland = mix(rolled, vec3(0.19, 0.16, 0.087), 0.44 + 0.18 * cut);
  return vec4(mix(headland, mix(plant, rolled, wheel * 0.86), work), coverage);
}
`;
