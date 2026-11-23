import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mesh } from './geometry.ts';
import { chainShaderHook, injectAfter, injectDeclarations } from './studio/shader-hooks.ts';

/** The carbon housing stays on the crash structure at every bodywork LOD. */
export function mountTailLampHousing(parent: T.Group, carbon: T.Material) {
  mesh(parent, new RoundedBoxGeometry(0.106, 0.074, 0.025, 2, 0.006), carbon, 0, -0.23, -2.278);
}

/** A smoked polycarbonate face over fifteen reflector cups. When a cup is
 * smaller than a pixel its radiance converges to the array's mean, so the
 * rear light keeps its energy in mirrors and in spray. */
export function mountTailLamp(parent: T.Group) {
  const material = new T.MeshPhysicalMaterial({
    name: 'Polycarbonate rain light',
    color: 0x760d10,
    roughness: 0.22,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    emissive: 0xff1b0a,
    emissiveIntensity: 0.4,
  });
  chainShaderHook(material, 'formula-tail-optics-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec2 vSignalCell;', 'vertex');
    injectAfter(
      shader,
      'begin_vertex',
      'vSignalCell = (position.xy / vec2(.092, .058) + .5) * vec2(5., 3.);',
      'vertex',
    );
    injectDeclarations(shader, 'common', 'varying vec2 vSignalCell;', 'fragment');
    injectAfter(
      shader,
      'emissivemap_fragment',
      `
      vec2 cellDelta = fract(vSignalCell) - .5;
      float r = length(cellDelta);
      vec2 cellFootprint = fwidth(vSignalCell);
      float width = max(cellFootprint.x, cellFootprint.y);
      float resolve = 1. - smoothstep(.22, .9, width);
      float cup = 1. - smoothstep(.34, .47, r);
      float emitter = 1. - smoothstep(.10, .24, r);
      totalEmissiveRadiance *= mix(1., .24 + .75 * cup + 4.4 * emitter, resolve);
      diffuseColor.rgb *= mix(.83, .52 + .60 * cup, resolve);
    `,
      'fragment',
    );
  });
  const face = new T.Shape();
  const x = 0.046,
    y = 0.029,
    r = 0.004;
  face.moveTo(-x + r, -y);
  face.lineTo(x - r, -y);
  face.quadraticCurveTo(x, -y, x, -y + r);
  face.lineTo(x, y - r);
  face.quadraticCurveTo(x, y, x - r, y);
  face.lineTo(-x + r, y);
  face.quadraticCurveTo(-x, y, -x, y - r);
  face.lineTo(-x, -y + r);
  face.quadraticCurveTo(-x, -y, -x + r, -y);
  const geometry = new T.ShapeGeometry(face, 3).rotateY(Math.PI).translate(0, 0, -0.0115);
  const lens = new T.Mesh(geometry, material);
  lens.position.set(0, -0.23, -2.28);
  lens.receiveShadow = true;
  parent.add(lens);
  lens.name = 'Recorded rear signal';
  // The inset optical face shares the housing's opaque silhouette.
  lens.castShadow = false;
  return lens;
}
