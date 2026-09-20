import { MeshStandardMaterial, Vector4, ShaderChunk, type DataTexture } from 'three';
import wetRoad from '../shaders/wetRoad.frag?raw';
import treadShader from '../shaders/tread.frag?raw';
import carbonRoughness from '../shaders/carbon.frag?raw';
import carbonNormal from '../shaders/carbon-normal.frag?raw';

export function carbonMaterial() {
  const material = new MeshStandardMaterial({ color: 0x121719, metalness: 0.16, roughness: 0.48 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCarbonUv;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCarbonUv = vec2(position.x + position.z * 0.7071, position.y + position.z * 0.7071) * 320.0;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCarbonUv;')
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n' + carbonRoughness,
      )
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n' + carbonNormal,
      );
  };
  material.customProgramCacheKey = () => 'apex-metre-carbon-v2';
  return material;
}

/** One uniform per physical wheel; no per-frame texture allocations or synthetic
 * dirt timer. The state is supplied by the live/replayed tire channels. */
export function treadMaterial() {
  const material = new MeshStandardMaterial({ color: 0x191c1d, roughness: 0.9 });
  const condition = { value: new Vector4() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.treadCondition = condition;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTreadUV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTreadUV = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec4 treadCondition; varying vec2 vTreadUV;',
      )
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + treadShader);
  };
  material.customProgramCacheKey = () => 'apex-contact-tread-v1';
  return { material, condition };
}

/** Pit water uses the same edge cell as Track.sample; laid rubber and marbles
 * are excluded there because the physics marks PIT as a deposit-free surface. */
export function installWetRoad(
  material: MeshStandardMaterial,
  stateTexture: DataTexture,
  deposits: boolean,
) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.trackState = { value: stateTexture };
    shader.uniforms.surfaceDeposits = { value: deposits ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 trackUV; varying vec2 vTrackUV;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrackUV = trackUV;');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform sampler2D trackState; uniform float surfaceDeposits; varying vec2 vTrackUV;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n' + wetRoad,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,mix(0.27,0.095,puddle),wet);',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      'vec3 dryRoadNormal = normal;\n#include <normal_fragment_maps>\nnormal = normalize(mix(normal, dryRoadNormal, wet * 0.9));',
    );
    // MeshPhysicalMaterial road ribbons carry a real dielectric water-film lobe.
    // Dry cells explicitly remove it; standing-water cells sharpen it. Standard
    // materials compile the same hook with the guarded branch removed.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_fragment>',
      `#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        material.clearcoat = wet * mix(0.58, 1.0, puddle);
        material.clearcoatRoughness = mix(0.26, mix(0.105, 0.055, puddle), wet);
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'apex-physical-asphalt-v3-water-film';
}

/** At grazing angles, collapsed screen derivatives can make the stock bump
 * perturbation normalize a zero vector. A single NaN texel contaminates every
 * roughness mip in a local reflection and subsequently the bloom pyramid.
 * Preserve the geometric normal at singularities, not a black/post-FX patch. */
export function installStableSurfaceBump(material: MeshStandardMaterial) {
  const previous = material.onBeforeCompile;
  const chunk = ShaderChunk.bumpmap_pars_fragment
    .replace(
      'vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );',
      `
      vec3 surfaceDx = dFdx(surf_pos.xyz);
      vec3 surfaceDy = dFdy(surf_pos.xyz);
      float dx2 = dot(surfaceDx, surfaceDx), dy2 = dot(surfaceDy, surfaceDy);
      if (min(dx2, dy2) < 1e-16) return surf_norm;
      vec3 vSigmaX = surfaceDx * inversesqrt(dx2);`,
    )
    .replace(
      'vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );',
      'vec3 vSigmaY = surfaceDy * inversesqrt(dy2);',
    )
    .replace(
      'vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );',
      `
      if (abs(fDet) < 1e-7) return surf_norm;
      vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);`,
    )
    .replace(
      'return normalize( abs( fDet ) * surf_norm - vGrad );',
      `
      vec3 perturbed = abs(fDet) * surf_norm - vGrad;
      float normal2 = dot(perturbed, perturbed);
      return normal2 > 1e-16 ? perturbed * inversesqrt(normal2) : surf_norm;`,
    );
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <bumpmap_pars_fragment>',
      chunk,
    );
  };
  material.customProgramCacheKey = () => 'apex-stable-surface-bump-v1';
}
