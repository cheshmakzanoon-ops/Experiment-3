import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';
import { useStudioUniforms } from '../studio/studio-frame.ts';

/** One sheet in its local mast frame. Wind is sampled from the presented
 * race snapshot. The hems drop in still air and stream along the actual
 * horizontal wind vector; both eyelets stay at a fixed height on the mast. */
const cloth = /* glsl */ `
vec3 gpPennantPoint(vec2 sheet) {
  float fly=clamp(sheet.x,0.,1.), top=clamp(sheet.y,0.,1.);
  mat3 frame=mat3(modelMatrix)*mat3(instanceMatrix);
  vec2 wind=vec2(dot(studioWind.xy,normalize(frame[0].xz)),
    dot(studioWind.xy,normalize(frame[2].xz)));
  float speed=length(wind), lift=smoothstep(.12,6.,speed);
  // In a dead calm the cloth hangs almost against the mast. Keep its small
  // horizontal offset continuous as the wind turns through zero.
  vec2 flow=wind/max(speed,.001);
  vec2 horizontal=mix(vec2(.20,.06),flow,smoothstep(.04,.9,speed));
  vec2 across=vec2(-horizontal.y,horizontal.x);
  float notch=.51*(1.-abs(2.*top-1.))*smoothstep(.70,1.,fly);
  float reach=(2.88-notch)*fly;
  vec2 origin=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xz;
  float phase=dot(origin,vec2(.12,.08))+studioTime*(1.8+.30*min(speed,14.));
  float wave=sin(phase-5.7*fly+.65*top)+.34*sin(1.69*phase-9.6*fly-1.3*top);
  float ripple=fly*(.035+.17*lift)*wave;
  vec2 offset=horizontal*reach*(.48+.52*lift)+across*ripple;
  float sag=(1.-lift)*reach*.79+.11*fly*fly;
  float y=(top-1.)*1.10-sag+.063*lift*fly*wave;
  return vec3(offset.x,y,offset.y);
}`;

function pennantSurface<M extends T.MeshStandardMaterial | T.MeshDepthMaterial>(material: M, depth: boolean) {
  chainShaderHook(material, 'gp-paddock-pennant-v1', (shader) => {
    useStudioUniforms(shader, ['studioWind', 'studioTime'], 'vertex');
    injectAfter(shader, 'common', cloth, 'vertex');
    injectAfter(shader, 'begin_vertex', 'transformed=gpPennantPoint(uv);', 'vertex');
    if (depth) return;
    injectAfter(shader, 'beginnormal_vertex', `
vec3 along=gpPennantPoint(uv+vec2(.008,0.))-gpPennantPoint(uv-vec2(.008,0.));
vec3 lift=gpPennantPoint(uv+vec2(0.,.008))-gpPennantPoint(uv-vec2(0.,.008));
objectNormal=normalize(cross(along,lift));`, 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vPennantUv;', 'vertex');
    injectAfter(shader, 'uv_vertex', 'vPennantUv=uv;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vPennantUv;', 'fragment');
    injectAfter(shader, 'color_fragment', `
float band=vPennantUv.x+.19*abs(vPennantUv.y-.5);
float px=max(fwidth(band),.0001);
float stripe=smoothstep(.27-px,.27+px,band)*(1.-smoothstep(.41-px,.41+px,band));
float pin=smoothstep(.46-px,.46+px,band)*(1.-smoothstep(.49-px,.49+px,band));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.80,.81,.75),max(stripe,pin*.78));`, 'fragment');
  });
  return material;
}

/** Anchor transforms are upright, at the upper eyelet of four roof masts.
 * One instanced draw, with the same deformation in the sunlight shadow. */
export function gpPaddockPennants(anchors: readonly T.Matrix4[], tint: number) {
  const grid = new T.PlaneGeometry(1, 1, 12, 4);
  // CPU bounds cover every direction and the full gravity sag. The original
  // unit plane would cull the free tip while it remained on screen.
  grid.boundingBox = new T.Box3(new T.Vector3(-3.2, -3.75, -3.2), new T.Vector3(3.2, .14, 3.2));
  grid.boundingSphere = new T.Sphere(new T.Vector3(0, -1.25, 0), 3.8);
  const colour = pennantSurface(new T.MeshStandardMaterial({
    name: 'GP paddock woven event pennants', color: tint, roughness: .84, side: T.DoubleSide,
  }), false);
  const flags = new T.InstancedMesh(grid, colour, anchors.length);
  flags.name = 'GP paddock wind pennants';
  anchors.forEach((matrix, index) => flags.setMatrixAt(index, matrix));
  flags.instanceMatrix.needsUpdate = true;
  flags.customDepthMaterial = pennantSurface(new T.MeshDepthMaterial({
    depthPacking: T.RGBADepthPacking, side: T.DoubleSide,
  }), true);
  flags.castShadow = flags.receiveShadow = true;
  flags.computeBoundingBox();
  flags.computeBoundingSphere();
  return flags;
}
