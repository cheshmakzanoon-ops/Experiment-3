import * as T from 'three';
import { HUMAN_FACE_GLSL, HUMAN_TONE_GLSL, humanHeadGeometry } from './human-kit.ts';
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

/** Both shell and facial insert are opaque. The facial insert has an ID
 * starting at one. The default scalar attribute on every lacquered part is
 * zero, keeping the existing paint and decals on those pieces. */
export function installGpHelmetFace(material: T.MeshPhysicalMaterial) {
  chainShaderHook(material, 'gp-helmet-interior-v1', (shader) => {
    injectDeclarations(shader, 'common', 'attribute float gpFaceId; varying vec4 vGpFace;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vGpFace = vec4(position,gpFaceId);', 'vertex');
    injectDeclarations(shader, 'common', 'varying vec4 vGpFace;\n' + HUMAN_TONE_GLSL + HUMAN_FACE_GLSL, 'fragment');
    injectAfter(shader, 'color_fragment', `
float gpFaceRough = .62, gpFaceGlint = 0.;
float gpFacePixel = max(length(dFdx(vGpFace.xyz)),length(dFdy(vGpFace.xyz)));
if (vGpFace.w > .5) {
  float who = vGpFace.w - 1.;
  HumanFace face = humanFace(vGpFace.xyz,humanSkinTone(who),humanHairTone(who),who,0.,gpFacePixel,0.);
  diffuseColor.rgb = face.col;
  gpFaceRough = face.rough;
  gpFaceGlint = face.glint;
}`, 'fragment');
    injectAfter(shader, 'roughnessmap_fragment', 'if (vGpFace.w > .5) roughnessFactor=gpFaceRough;', 'fragment');
    injectAfter(shader, 'metalnessmap_fragment', 'if (vGpFace.w > .5) metalnessFactor=0.;', 'fragment');
    injectAfter(shader, 'lights_physical_fragment', `
#ifdef USE_CLEARCOAT
if (vGpFace.w > .5) material.clearcoat=0.;
#endif`, 'fragment');
    injectBefore(shader, 'opaque_fragment', 'outgoingLight+=vec3(.17,.15,.13)*gpFaceGlint;', 'fragment');
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
}
