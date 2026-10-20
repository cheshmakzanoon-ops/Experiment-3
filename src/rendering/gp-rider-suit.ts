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

/** Two tailoring recipes share the existing materials: the one-piece torso
 * and each continuous sleeve/trouser skin. Cut coordinates are captured before
 * skinning, so a panel follows the solved body through riding and recovery.
 * REF_065 shows the ribbed rear shoulder saddle and matte elbow insert;
 * REF_071 shows hip accordion panels and paired outer-leg seam stitching. */
export type GpSuitCut = 'plain' | 'torso' | 'limb';

const TAILOR_HELPERS = `
float gpSuitStretch;
float gpSuitRib;
float gpSuitWear;
float gpSuitRoundBox(vec2 p, vec2 halfSize, float radius) {
  vec2 q=abs(p)-halfSize+radius;
  return length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
}
float gpSuitCoverage(float distance, float aa) {
  return 1.-smoothstep(-aa,aa,distance);
}
// Around-body arc distance in metres, continuous at the UV wrap seam.
float gpSuitArc(float centre, float circumference) {
  return abs(fract(vGpSuitUv.x-centre+.5)-.5)*circumference;
}
`;

function tailoring(cut: Exclude<GpSuitCut, 'plain'>) {
  const distance =
    cut === 'limb'
      ? `
  if (vGpSuitCut.x > .5) {
    bool sleeve=vGpSuitCut.x<1.5;
    float joint=vGpSuitCut.y;
    float radius=max(.025,length(vGpSuitBind.xz));
    float circumference=6.28318530718*radius;
    // Stretch belongs to the flexing inner joint, not the abrasion panel.
    float inner=gpSuitArc(sleeve ? .25 : .75,circumference);
    stretchDistance=gpSuitRoundBox(
      vec2(inner,vGpSuitBind.y-joint),
      sleeve ? vec2(.047,.119) : vec2(.062,.142),.019);
    float rear=gpSuitArc(.75,circumference);
    ribDistance=gpSuitRoundBox(
      vec2(rear,vGpSuitBind.y-(sleeve ? .072 : .09)),
      sleeve ? vec2(.067,.048) : vec2(.105,.065),.014);
    // Two quiet assembly seams run down the outer sleeve/trouser panels.
    float boundary=gpSuitArc(.06+.017*sin(vGpSuitBind.y*9.),circumference);
    float opposite=gpSuitArc(.44-.017*sin(vGpSuitBind.y*9.),circumference);
    longSeam=min(boundary,opposite);
    longSeam=max(longSeam,max(.035-vGpSuitBind.y,vGpSuitBind.y-(joint+.17)));
    float jointDistance=(vGpSuitBind.y-joint)/.09;
    gpSuitWear=exp(-jointDistance*jointDistance) *
      smoothstep(.2,.75,sleeve ? -sin(vGpSuitUv.x*6.28318530718) :
        sin(vGpSuitUv.x*6.28318530718));
    ribPitch=sleeve ? .0046 : .0056;
    ribAlong=vGpSuitBind.y+vGpSuitBind.x*.14;
  }`
      : `
  // The saddle sits beside the airbag hump; the housing itself stays quiet.
  ribDistance=max(gpSuitRoundBox(
    vec2(abs(vGpSuitBind.x)-.137,vGpSuitBind.y-.432),vec2(.052,.052),.018),
    vGpSuitBind.z+.025);
  // The reinforced seat panel reads from chase/rear-quarter views.
  stretchDistance=max(gpSuitRoundBox(
    vec2(vGpSuitBind.x,vGpSuitBind.y-.041),vec2(.128,.077),.034),
    vGpSuitBind.z+.035);
  ribPitch=.0048;
  ribAlong=vGpSuitBind.y+abs(vGpSuitBind.x)*.34;
  float hipDistance=(vGpSuitBind.y-.19)/.1;
  gpSuitWear=exp(-hipDistance*hipDistance) *
    smoothstep(.065,.12,abs(vGpSuitBind.x));`;
  return `{
  float px=max(length(fwidth(vGpSuitBind)),.00004);
  float aa=max(px*.75,.00005);
  float stretchDistance=1., ribDistance=1., longSeam=1.;
  float ribPitch=.005, ribAlong=vGpSuitBind.y;
  gpSuitWear=0.;
  ${distance}
  gpSuitStretch=gpSuitCoverage(stretchDistance,aa);
  gpSuitRib=gpSuitCoverage(ribDistance,aa)*(1.-gpSuitStretch);
  float border=min(abs(stretchDistance),abs(ribDistance));
  // A recessed stitch channel and two rows of actual short stitch highlights.
  // Subpixel stitches fade away, leaving the readable tailored panel boundary.
  float seamWidth=.00095;
  float seam=(1.-smoothstep(seamWidth-aa,seamWidth+aa,min(border,longSeam))) *
    min(1.,seamWidth/aa);
  float stitchRows=min(abs(border-.0024),abs(border-.0043));
  stitchRows=min(stitchRows,abs(longSeam-.0021));
  float stitch=1.-smoothstep(.00023+aa,.0006+aa,stitchRows);
  float stitchPhase=fract((vGpSuitBind.y+vGpSuitBind.x*.13)/.0038);
  stitch*=smoothstep(.12,.22,stitchPhase)*(1.-smoothstep(.67,.8,stitchPhase));
  stitch*=1.-smoothstep(.0007,.0026,px);
  float ribResolve=1.-smoothstep(ribPitch*.45,ribPitch*1.3,px);
  float rib=sin(ribAlong*(6.28318530718/ribPitch));
  float weaveResolve=1.-smoothstep(.0008,.0032,px);
  float weave=sin(vGpSuitBind.y*2600.)*sin((vGpSuitBind.x+vGpSuitBind.z)*3100.);
  float crease=gpSuitNoise(vGpSuitBind*vec3(41.,107.,37.))-.5;
  float creaseResolve=1.-smoothstep(.004,.022,px);
  gpSuitHeight*=1.-gpSuitStretch*.9;
  gpSuitHeight+=gpSuitRib*rib*.00032*ribResolve +
    gpSuitStretch*weave*.000055*weaveResolve - seam*.00015 + stitch*.00011 +
    crease*.00019*gpSuitWear*creaseResolve;
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.023,.029),gpSuitStretch*.87);
  diffuseColor.rgb*=1.-gpSuitRib*.13-seam*.22;
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.55+vec3(.16),stitch*.7);
  gpSuitWear*=creaseResolve*(.4+.6*gpSuitNoise(vGpSuitBind*vec3(24.,11.,24.)));
}`;
}

/** Metre-scale hide, tailored stretch panels and filtered stitches. The
 * surface owns no time-dependent state or extra texture; weather installs
 * afterward and owns the final damp roughness. No stitches become geometry. */
export function installGpSuitFinish(
  material: T.MeshPhysicalMaterial,
  perforated: boolean,
  cut: GpSuitCut = 'plain',
) {
  const key = `gp-suit-${perforated ? 'perforated' : 'plain'}-${cut}-v2`;
  chainShaderHook(material, key, (shader) => {
    const coordinates =
      cut === 'plain'
        ? ''
        : `
varying vec2 vGpSuitUv;
${cut === 'limb' ? 'varying vec2 vGpSuitCut;' : ''}`;
    injectDeclarations(
      shader,
      'common',
      `varying vec3 vGpSuitBind;${coordinates}
${cut === 'limb' ? '#ifdef USE_SKINNING\nattribute vec2 gpSuitCut;\n#endif' : ''}`,
      'vertex',
    );
    injectAfter(
      shader,
      'begin_vertex',
      `vGpSuitBind = position;
${cut !== 'plain' ? 'vGpSuitUv = uv;' : ''}
${cut === 'limb' ? '#ifdef USE_SKINNING\nvGpSuitCut = gpSuitCut;\n#else\nvGpSuitCut = vec2(0.);\n#endif' : ''}`,
      'vertex',
    );
    injectDeclarations(
      shader,
      'common',
      `varying vec3 vGpSuitBind;${coordinates}
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
}
${cut === 'plain' ? '' : TAILOR_HELPERS}`,
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
}
${cut === 'plain' ? '' : tailoring(cut)}`,
      'fragment',
    );
    injectAfter(
      shader,
      'roughnessmap_fragment',
      `roughnessFactor=clamp(roughnessFactor+gpSuitGrain*.05+gpSuitPore*.045,.48,.9);
${
  cut === 'plain'
    ? ''
    : `roughnessFactor=mix(roughnessFactor,.86,gpSuitStretch);
roughnessFactor=mix(roughnessFactor,.77,gpSuitRib);
roughnessFactor-=gpSuitWear*.055*(1.-gpSuitStretch);`
}`,
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
