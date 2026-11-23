import * as T from 'three';
import { FLAG_RANGE } from './studio/crowd-flags.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';
import { useStudioUniforms } from './studio/studio-frame.ts';

// Positions are metres from the spectator's hand. Both derivatives follow
// the same cloth shape used for projection, including the sagging hem.
const heldCloth = /* glsl */ `
void gpFanFlag(vec2 sheet, out vec3 point, out vec3 surfaceNormal) {
  mat4 frame = modelMatrix * instanceMatrix;
  float individual = dot(frame[3].xz, vec2(.37,.23));
  float beat = individual + studioTime * (1.09 + .21 * sin(individual));
  float swing = .073*sin(beat) + .036*sin(beat*1.81);
  float cs = cos(swing), sn = sin(swing);
  mat3 hand = mat3(cs,sn,0., -sn,cs,0., 0.,0.,1.);
  if (sheet.y < -.5) {
    point = hand * position;
    surfaceNormal = hand * normal;
    return;
  }
  vec2 wind = vec2(dot(studioWind.xy, normalize(frame[0].xz)), dot(studioWind.xy, normalize(frame[2].xz)));
  // A moving hand stirs the cloth in a lull. Strong crosswinds dominate
  // regardless of a grandstand's orientation beside the circuit.
  wind += vec2(.42*cos(beat), .23*sin(beat));
  float speed = length(wind), lift = smoothstep(.12,5.8,speed);
  vec2 flow = wind / sqrt(dot(wind,wind) + .04);
  vec2 along = mix(vec2(.115,.045), flow*.90, .12+.88*lift);
  vec2 across = vec2(-flow.y,flow.x);
  float u = sheet.x, v = sheet.y;
  float phase = .35*individual - studioTime*(2.4 + .34*min(speed,15.));
  float a = 6.6*u + .83*v + phase, b = 10.8*u - 1.26*v + 1.54*phase;
  float wave = sin(a) + .31*sin(b);
  float waveU = 6.6*cos(a) + 3.348*cos(b);
  float waveV = .83*cos(a) - .3906*cos(b);
  float amp = .033+.057*lift;
  float sag = (.53-.48*lift)*u*(.70+.30*u);
  float sagU = (.53-.48*lift)*(.70+.60*u);
  vec3 fold = vec3(across.x*amp, .024*lift, across.y*amp);
  point = hand * (vec3(along.x*u, 1.+.60*v-sag, along.y*u) + fold*u*wave);
  vec3 du = vec3(along.x,-sagU,along.y) + fold*(wave+u*waveU);
  vec3 dv = vec3(0.,.60,0.) + fold*u*waveV;
  vec3 n = cross(du,dv);
  surfaceNormal = hand * (dot(n,n) > .0000001 ? normalize(n) : normal);
}`;

/** Spectator flags share one instanced material for every GP stand. */
export function gpSpectatorFlagMaterial() {
  const material = new T.MeshStandardMaterial({
    name: 'GP supporters printed cloth', side: T.DoubleSide, roughness: .88,
  });
  chainShaderHook(material, 'gp-supporter-cloth-v1', (shader) => {
    useStudioUniforms(shader, ['studioTime', 'studioWind'], 'vertex');
    injectAfter(shader, 'common', heldCloth, 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vSupporterUv; varying float vSupporterPrint;', 'vertex');
    injectAfter(shader, 'uv_vertex', `
vec3 gpClothPoint, gpClothNormal;
gpFanFlag(uv, gpClothPoint, gpClothNormal);
vSupporterUv=uv;
vSupporterPrint=fract(sin(dot(instanceMatrix[3].xz,vec2(.53,.27)))*417.3);`, 'vertex');
    injectAfter(shader, 'beginnormal_vertex', 'objectNormal=gpClothNormal;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'transformed=gpClothPoint;', 'vertex');
    injectAfter(shader, 'project_vertex', `
float gpFlagLens=clamp(projectionMatrix[1][1]/2.14,.65,3.5);
if (length((modelViewMatrix*instanceMatrix[3]).xyz)>${FLAG_RANGE.toFixed(1)}*gpFlagLens)
  gl_Position=vec4(0.,0.,2.,1.);`, 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vSupporterUv; varying float vSupporterPrint;', 'fragment');
    injectAfter(shader, 'color_fragment', `
float mark=vSupporterPrint < .34 ? vSupporterUv.y-.22*vSupporterUv.x :
  vSupporterPrint < .68 ? vSupporterUv.x+.47*abs(vSupporterUv.y-.5) : vSupporterUv.y+.54*vSupporterUv.x;
float inkWidth=max(fwidth(mark),.002);
float stripe=smoothstep(.38-inkWidth,.38+inkWidth,mark)*(1.-smoothstep(.54-inkWidth,.54+inkWidth,mark));
float piping=smoothstep(.62-inkWidth,.62+inkWidth,mark)*(1.-smoothstep(.65-inkWidth,.65+inkWidth,mark));
diffuseColor.rgb=vSupporterUv.y < -.5 ? vec3(.085,.078,.067) :
  mix(diffuseColor.rgb,vec3(.77,.76,.69),max(stripe,.85*piping));`, 'fragment');
  });
  return material;
}
