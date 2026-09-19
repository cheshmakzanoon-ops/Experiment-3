import { MeshStandardMaterial, Vector4 } from 'three';
import treadShader from '../shaders/tread.frag?raw';
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
