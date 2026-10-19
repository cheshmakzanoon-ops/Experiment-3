import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** Original GP airbag housing: a broad nape and a shallow taper into the
 * lumbar panel, using the same six profile stations as the spine protector.
 * Reference observations: MotoGP26 REF_018, REF_065 and REF_071. */
export const GP_AIRBAG_PROFILE = [
  [0.12, -0.075, 0.012, 0.018, 0.013],
  [0.23, -0.096, 0.058, 0.024, 0.026],
  [0.36, -0.104, 0.079, 0.026, 0.045],
  [0.46, -0.086, 0.084, 0.025, 0.065],
  [0.54, -0.052, 0.05, 0.019, 0.047],
  [0.565, -0.036, 0.003, 0.003, 0.004],
] as const;

export type GpSuitRegion = 'torso' | 'upper-arm' | 'forearm' | 'thigh' | 'shin';
/** Metres. Cut and pressure folds alter the existing skin only; the IK
 * joints, grips, pegs, recovery poses and collision bodies are unchanged. */
export const GP_SUIT_MAX_FOLD = 0.0032;
const PRESSURE: Record<GpSuitRegion, readonly [number, number, number, number]> = {
  torso: [0.31, 0.17, 4.3, 0.0032],
  'upper-arm': [0.71, 0.15, 3.7, 0.0018],
  forearm: [0.75, 0.14, 4.1, 0.0012],
  thigh: [0.73, 0.19, 4.4, 0.0021],
  shin: [0.56, 0.2, 3.6, 0.0008],
};

/** Average coincident skin normals without welding UVs or closing a designed
 * garment boundary. Loft UV seams used to leave a long crease on each limb. */
export function smoothGpSuitSeams(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal');
  if (!position || !normal) throw new Error('GP suit requires positions and normals');
  const coincident = new Map<string, number[]>();
  for (let i = 0; i < position.count; i++) {
    const key = [position.getX(i), position.getY(i), position.getZ(i)]
      .map((n) => Math.round(n * 1e6))
      .join('/');
    const group = coincident.get(key);
    if (group) group.push(i);
    else coincident.set(key, [i]);
  }
  const sum = new T.Vector3();
  for (const indices of coincident.values()) {
    if (indices.length < 2) continue;
    sum.set(0, 0, 0);
    for (const i of indices) sum.add(new T.Vector3().fromBufferAttribute(normal, i));
    sum.normalize();
    for (const i of indices) normal.setXYZ(i, sum.x, sum.y, sum.z);
  }
  normal.needsUpdate = true;
  return geometry;
}

/** Stationary, sparsely spaced compression folds. No per-frame deformation,
 * random state, extra attributes, triangles, textures or material slots. */
export function shapeGpSuitGeometry(geometry: T.BufferGeometry, region: GpSuitRegion) {
  const position = geometry.getAttribute('position'),
    uv = geometry.getAttribute('uv');
  if (!position || !uv || position.count !== uv.count)
    throw new Error('GP suit requires complete positions and UVs');
  const [centre, width, frequency, amplitude] = PRESSURE[region];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i),
      t = uv.getY(i),
      angle = uv.getX(i) * Math.PI * 2;
    if (![x, y, z, t, angle].every(Number.isFinite))
      throw new Error('Non-finite GP suit coordinate');
    const radius = Math.hypot(x, z);
    if (radius < 0.008) continue;
    // Zero at garment ends: the existing elbow/hip/neck joins retain their
    // position. Pressure follows a curved line across the skin, not a ring.
    const edge = T.MathUtils.smoothstep(t, 0.08, 0.2) * (1 - T.MathUtils.smoothstep(t, 0.84, 0.96)),
      envelope = Math.exp(-(((t - centre) / width) ** 2)) * edge,
      phase = Math.PI * 2 * (t * frequency + Math.sin(angle) * 0.14),
      relief = amplitude * envelope * Math.sin(phase) * (0.35 + 0.65 * Math.sin(angle) ** 2);
    position.setXYZ(i, x + (x / radius) * relief, y, z + (z / radius) * relief);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  smoothGpSuitSeams(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Retain fine hide grain, but remove the uniform sine drape from the old
 * finish: the real pressure folds now belong to the shaped garment. Tiny
 * staggered perforations use metre coordinates and disappear below a pixel.
 * Weather is installed afterward and owns the final wet roughness. */
export function installGpSuitFinish(material: T.MeshPhysicalMaterial, perforated: boolean) {
  const key = `gp-suit-${perforated ? 'perforated' : 'plain'}-v1`;
  chainShaderHook(material, key, (shader) => {
    injectDeclarations(shader, 'common', 'varying vec3 vGpSuitBind;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpSuitBind = position;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      `varying vec3 vGpSuitBind;
float gpSuitHeight;
float gpSuitPore;
float gpSuitGrain;
float gpSuitHash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float gpSuitNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(gpSuitHash(i),gpSuitHash(i+vec3(1,0,0)),f.x),
    mix(gpSuitHash(i+vec3(0,1,0)),gpSuitHash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(gpSuitHash(i+vec3(0,0,1)),gpSuitHash(i+vec3(1,0,1)),f.x),
    mix(gpSuitHash(i+vec3(0,1,1)),gpSuitHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      `{
  float px=length(fwidth(vGpSuitBind));
  float fine=1.-smoothstep(.0012,.0042,px);
  gpSuitGrain=(gpSuitNoise(vGpSuitBind*570.)-.5)*fine;
  gpSuitPore=0.;
  ${
    perforated
      ? `vec2 grid=vGpSuitBind.xy/.0038;
  grid.x+=mod(floor(grid.y),2.)*.5;
  float d=length((fract(grid)-.5)*.0038);
  float aa=max(fwidth(d),.00004);
  vec3 boundNormal=cross(dFdx(vGpSuitBind),dFdy(vGpSuitBind));
  float facing=abs(boundNormal.z)/max(length(boundNormal),1.e-10);
  gpSuitPore=(1.-smoothstep(.00029-aa,.00043+aa,d))*fine*smoothstep(.25,.75,facing);`
      : ''
  }
  gpSuitHeight=gpSuitGrain*.000065-gpSuitPore*.00012;
  diffuseColor.rgb*=1.+gpSuitGrain*.027-gpSuitPore*.14;
}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      'roughnessFactor=clamp(roughnessFactor+gpSuitGrain*.05+gpSuitPore*.045,.48,.9);',
      'fragment',
    );
    injectAfter(
      shader,
      'normal_fragment_maps',
      `{
  vec3 dx=dFdx(-vViewPosition), dy=dFdy(-vViewPosition);
  vec3 r1=cross(dy,normal), r2=cross(normal,dx);
  float det=dot(dx,r1);
  vec3 gradient=sign(det)*(dFdx(gpSuitHeight)*r1+dFdy(gpSuitHeight)*r2);
  normal=normalize(max(abs(det),1.e-10)*normal-gradient);
}`,
      'fragment',
    );
  });
  return material;
}
