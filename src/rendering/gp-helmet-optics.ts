import * as T from 'three';
import type { GpRiderSight } from './motorcycle-camera.ts';
import { HUMAN_FACE_GLSL, HUMAN_TONE_GLSL, humanHeadGeometry, skinWrapLighting } from './human-kit.ts';
import { chainShaderHook, injectAfter, injectBefore, injectDeclarations } from './studio/shader-hooks.ts';

/** Keep the brow, eyes, nose and temples of the original head sculpt. The
 * composite shell and padded throat hide the rest. Keeping the sculpt's
 * local frame lets the existing face shader follow the eyelids. */
export function gpEyePortFace(detail: 'high' | 'mid', entrant: number, material: T.MeshPhysicalMaterial) {
  const source = humanHeadGeometry('bare', detail === 'high' ? 1 : 2);
  const points = source.getAttribute('position'), normals = source.getAttribute('normal');
  const sourceIndex = source.index!;
  const remap = new Int32Array(points.count).fill(-1);
  const vertices: number[] = [], shading: number[] = [], index: number[] = [];
  for (let i = 0; i < sourceIndex.count; i += 3) {
    const a = sourceIndex.getX(i), b = sourceIndex.getX(i + 1), c = sourceIndex.getX(i + 2);
    const yA = points.getY(a), yB = points.getY(b), yC = points.getY(c);
    if (Math.max(yA, yB, yC) < -.048 || Math.min(yA, yB, yC) > .067 ||
        Math.max(points.getZ(a), points.getZ(b), points.getZ(c)) < .019) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) {
        remap[v] = vertices.length / 3;
        vertices.push(points.getX(v), points.getY(v), points.getZ(v));
        shading.push(normals.getX(v), normals.getY(v), normals.getZ(v));
      }
      index.push(remap[v]);
    }
  }
  source.dispose();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(shading, 3));
  geometry.setAttribute('gpFaceId', new T.BufferAttribute(new Float32Array(vertices.length / 3).fill(entrant + 1), 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'GP recessed brow and eyes';
  mesh.receiveShadow = true;
  return mesh;
}

/** The helmet already follows the preview with the neck. The eyes cover the
 * remaining angle into a turn or over a crest. The lid closes faster than it
 * opens, with a phase and interval stable for the same entrant on every LOD. */
export function gpEyePose(out: T.Vector3, entrant: number, time?: number, sight?: GpRiderSight) {
  const weight = T.MathUtils.clamp(Number.isFinite(sight?.weight) ? sight!.weight : 0, 0, 1);
  const yaw = Number.isFinite(sight?.yaw) ? sight!.yaw : 0;
  const grade = Number.isFinite(sight?.gradeChange) ? sight!.gradeChange : 0;
  let lid = 0;
  if (time !== undefined && Number.isFinite(time)) {
    const seed = Math.imul(entrant + 17, 0x45d9f3b) >>> 0;
    const interval = 3.8 + (seed & 1023) / 380;
    const phase = T.MathUtils.euclideanModulo(time + interval * ((seed >>> 10) & 1023) / 1024, interval);
    lid = T.MathUtils.smoothstep(phase, 0, .045) * (1 - T.MathUtils.smoothstep(phase, .065, .175));
  }
  return out.set(T.MathUtils.clamp(.36*yaw*weight, -.21, .21),
    T.MathUtils.clamp(.32*grade*weight, -.085, .085), lid);
}

/** Both shell and facial insert are opaque. The facial insert has an ID
 * starting at one. The default scalar attribute on every lacquered part is
 * zero, keeping the existing paint and decals on those pieces. */
export function installGpHelmetFace(material: T.MeshPhysicalMaterial, eyes: T.Vector3) {
  chainShaderHook(material, 'gp-helmet-interior-v3', (shader) => {
    shader.uniforms.gpEyePose = { value: eyes };
    injectDeclarations(shader, 'common', 'attribute float gpFaceId; varying vec4 vGpFace;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpFace = vec4(position,gpFaceId);', 'vertex');
    injectDeclarations(shader, 'common', `
#define GP_HELMET_GAZE
uniform vec3 gpEyePose;
varying vec4 vGpFace;
float gpFacialSkin;
${HUMAN_TONE_GLSL}
${HUMAN_FACE_GLSL}`, 'fragment');
    shader.fragmentShader = skinWrapLighting(shader.fragmentShader, 'gpFacialSkin');
    injectAfter(shader, 'color_fragment', `
gpFacialSkin = 0.;
float gpFaceRough = .62, gpFaceRelief = 0., gpCornea = 0., gpPortOcclusion = 1.;
float gpFacePixel = max(length(dFdx(vGpFace.xyz)),length(dFdy(vGpFace.xyz)));
if (vGpFace.w > .5) {
  float who = vGpFace.w - 1.;
  HumanFace face = humanFace(vGpFace.xyz,humanSkinTone(who),humanHairTone(who),who,0.,gpFacePixel,0.);
  diffuseColor.rgb = face.col;
  gpFacialSkin = face.skin;
  gpCornea = face.eye;
  // The open centre sees the sky. The brow lip and temple pads limit the
  // hemisphere visible to skin within about two centimetres of the shell.
  float temple = smoothstep(.047, .071, abs(vGpFace.x));
  float brow = smoothstep(.021, .053, vGpFace.y);
  gpPortOcclusion = 1. - max(.46 * temple, .36 * brow);
  gpFaceRough = mix(face.rough, .115, gpCornea);
  // A shallow tear film follows the lid aperture and reflects the incident light.
  vec2 irisOffset = vec2(abs(vGpFace.x) - .031, vGpFace.y - .0105);
  float cap = 1. - smoothstep(.0035, .0105, length(irisOffset));
  gpFaceRelief = face.bump + .00038 * cap * gpCornea;
}`, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', 'if (vGpFace.w > .5) roughnessFactor=gpFaceRough;', 'fragment');
    injectAfter(shader, 'metalnessmap_fragment', 'if (vGpFace.w > .5) metalnessFactor=0.;', 'fragment');
    injectAfter(shader, 'normal_fragment_maps', `
if (vGpFace.w > .5) normal = humanBumpNormal(-vViewPosition, normal, gpFaceRelief, faceDirection);`, 'fragment');
    injectAfter(shader, 'lights_physical_fragment', `
if (vGpFace.w > .5) {
  // Skin and the transparent tear film have their own dielectric reflection.
  material.specularColor = vec3(mix(.028, .020, gpCornea));
  #ifdef USE_CLEARCOAT
  material.clearcoat = 0.;
  #endif
}`, 'fragment');
    injectAfter(shader, 'aomap_fragment', `
reflectedLight.indirectDiffuse *= gpPortOcclusion;
reflectedLight.indirectSpecular *= sqrt(gpPortOcclusion);`, 'fragment');
  });
}

/** The single-surface coated lens keeps its environment and rain highlights.
 * Opaque geometry behind it supplies the rider's face and inner pads. */
export function installGpVisorGlazing(visor: T.MeshPhysicalMaterial) {
  visor.transparent = true;
  visor.depthWrite = false;
  visor.side = T.FrontSide;
  visor.metalness = .26;
  visor.iridescence = .53;
  chainShaderHook(visor, 'gp-visor-glazing-v1', (shader) => {
    injectBefore(shader, 'opaque_fragment', `
float gpViewCos=abs(dot(normalize(vViewPosition),normal));
float gpGrazing=pow(1.-clamp(gpViewCos,0.,1.),3.);
diffuseColor.a=mix(.69,.97,gpGrazing);`, 'fragment');
  });
  chainShaderHook(visor, 'gp-visor-tearoff-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec2 vGpFilm;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpFilm=uv;', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec2 vGpFilm;', 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', `
      float gpPullTab=step(1.5,vGpFilm.x);
      float gpFilmHeight=mix(.076,.022,smoothstep(.45,.98,abs(2.*vGpFilm.x-1.)));
      vec2 gpFilmXY=abs(vGpFilm-.5)*vec2(.35,gpFilmHeight);
      vec2 gpDie=gpFilmXY-vec2(.35*.453-.005,gpFilmHeight*.5-.0088);
      float gpFilmDist=length(max(gpDie,0.))+min(max(gpDie.x,gpDie.y),0.)-.005;
      float gpPixel=max(fwidth(gpFilmDist),.00004);
      float gpEdge=0.;
      for(int i=0;i<2;i++) {
        float d=abs(gpFilmDist+float(i)*(.00028+.00063*smoothstep(.08,.15,gpFilmXY.x)));
        gpEdge+=clamp((.00014+.5*gpPixel-d)/gpPixel,0.,1.)*
          min(1.,.00052/gpPixel);
      }
      gpEdge=min(gpEdge,1.)*(1.-gpPullTab);
      roughnessFactor=mix(roughnessFactor, .16, max(gpEdge*.50,gpPullTab));
    `, 'fragment');
    injectBefore(shader, 'opaque_fragment', `
      vec3 gpFilmReflection=reflectedLight.indirectSpecular+reflectedLight.directSpecular;
      outgoingLight+=gpEdge*(.35*gpFilmReflection+.14*outgoingLight);
      diffuseColor.a=mix(diffuseColor.a,min(.98,diffuseColor.a+.11),gpEdge);
      if(gpPullTab>.5){
        float gpFold=smoothstep(.49,.68,vGpFilm.x-2.);
        outgoingLight=.55*outgoingLight+gpFilmReflection*(.72+.42*gpFold);
        diffuseColor.a=mix(.24,.58,clamp(.64*gpGrazing+.40*gpFold,0.,1.));
      }
    `, 'fragment');
  });
}
