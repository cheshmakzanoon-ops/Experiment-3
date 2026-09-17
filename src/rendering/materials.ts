import { MeshStandardMaterial } from 'three';
import carbonRoughness from '../shaders/carbon.frag?raw';
import carbonNormal from '../shaders/carbon-normal.frag?raw';

export function carbonMaterial() {
  const material = new MeshStandardMaterial({ color: 0x191f22, metalness: 0.26, roughness: 0.53 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCarbonUv;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCarbonUv = uv * vec2(220.0, 96.0);',
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
  material.customProgramCacheKey = () => 'apex-bandlimited-carbon-v1';
  return material;
}
