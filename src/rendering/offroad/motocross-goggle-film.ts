import * as T from 'three';
import { chainShaderHook, injectAfter, injectDeclarations } from '../studio/shader-hooks.ts';

/** Vary the optical density of the smoked lens toward its brow and the
 * thickness of its dielectric coating over the wrap. The thin laminated
 * edges change highlight roughness and fade below a pixel at race distance. */
export function installMxGoggleFilm(material: T.MeshPhysicalMaterial) {
  material.ior = 1.58;
  chainShaderHook(material, 'mx-goggle-film-v1', (shader) => {
    injectDeclarations(shader, 'common', 'varying vec2 vMxLensUv;', 'vertex');
    injectAfter(shader, 'begin_vertex', 'vMxLensUv = uv;', 'vertex');
    injectDeclarations(
      shader,
      'common',
      'varying vec2 vMxLensUv; float mxFilmEdge, mxLensBrow;',
      'fragment',
    );
    injectAfter(
      shader,
      'color_fragment',
      /* glsl */ `{
      vec2 edge = min(vMxLensUv, 1.0-vMxLensUv)*vec2(0.216,0.069);
      float inset = min(edge.x, edge.y);
      float pixel = max(fwidth(inset), 0.00008);
      vec2 edgeDist = abs(vec2(inset)-vec2(0.0027,0.0041));
      vec2 line = 1.0-smoothstep(vec2(0.0),vec2(pixel+0.00023),edgeDist);
      mxFilmEdge = max(line.x,line.y)*min(1.0,0.00046/pixel);
      float side = abs(2.0*vMxLensUv.x-1.0);
      mxLensBrow = smoothstep(0.17,0.98,vMxLensUv.y);
      diffuseColor.rgb *= mix(vec3(1.18,1.12,1.01),vec3(0.55,0.74,0.86),
        0.70*mxLensBrow + 0.30*side*side);
      diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.10,0.16,0.17),0.32*mxFilmEdge);
    }`,
      'fragment',
    );
    injectAfter(
      shader,
      'lights_physical_fragment',
      /* glsl */ `
#ifdef USE_IRIDESCENCE
      material.iridescenceThickness = mix(205.0,295.0,0.65*mxLensBrow+0.35*abs(vMxLensUv.x*2.0-1.0));
#endif
#ifdef USE_CLEARCOAT
      material.clearcoatRoughness = min(1.0,material.clearcoatRoughness+0.12*mxFilmEdge);
#endif`,
      'fragment',
    );
  });
}

/** Die-cut printed end of the uppermost tear-off. It folds back against the
 * clutch-side goggle outrigger and fits into its existing trim batch. */
export function motocrossFilmTab(anchor: T.Vector3) {
  // x, y, z and half-height of the folded strip, in metres from the rim.
  const folds = [
    [0, 0, 0, 0.004],
    [0.005, 0.001, -0.003, 0.0041],
    [0.014, 0.0008, -0.008, 0.0054],
    [0.02, -0.001, -0.018, 0.0055],
    [0.019, -0.004, -0.03, 0.003],
  ];
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (const [i, [x, y, z, h]] of folds.entries()) {
    const next = folds[Math.min(i + 1, folds.length - 1)],
      previous = folds[Math.max(i - 1, 0)];
    const dx = next[0] - previous[0],
      dz = next[2] - previous[2];
    const scale = 0.00028 / Math.hypot(dx, dz);
    for (const [up, face] of [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ]) {
      positions.push(
        anchor.x + x - dz * face * scale,
        anchor.y + y + h * up,
        anchor.z + z + dx * face * scale,
      );
      uv.push(i / (folds.length - 1), (up + 1) * 0.5);
    }
    if (i === 0) continue;
    for (let side = 0; side < 4; side++) {
      const a = (i - 1) * 4 + side,
        b = (i - 1) * 4 + ((side + 1) % 4);
      indices.push(a, a + 4, b, b, a + 4, b + 4);
    }
  }
  const end = (folds.length - 1) * 4;
  indices.push(0, 1, 2, 0, 2, 3, end, end + 2, end + 1, end, end + 3, end + 2);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
