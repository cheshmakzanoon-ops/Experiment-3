import * as T from 'three';
import { humanHeadGeometry, installHumanHead } from './human-kit.ts';
import { chainShaderHook, injectBefore } from './studio/shader-hooks.ts';

/** Keep the brow, eyes, nose and temples of the original head sculpt. The
 * composite shell and padded throat hide the rest. Keeping the sculpt's
 * local frame lets the existing face shader follow the eyelids. */
export function gpEyePortFace(detail: 'high' | 'mid', entrant: number) {
  const source = humanHeadGeometry('bare', detail === 'high' ? 0 : 1);
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
  geometry.setAttribute('headPerson', new T.BufferAttribute(new Float32Array(vertices.length / 3).fill(entrant), 1));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  const material = new T.MeshStandardMaterial({ name: 'GP rider behind eye port', roughness: .7 });
  installHumanHead(material, 'bare');
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'GP recessed brow and eyes';
  mesh.receiveShadow = true;
  return mesh;
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
diffuseColor.a=mix(.59,.96,gpGrazing);`, 'fragment');
  });
}
