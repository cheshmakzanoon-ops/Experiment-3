import * as T from 'three';

const controls = new WeakMap<T.Material, { value: boolean }>();
export function pointLightWorkControl(material: T.Material) {
  return controls.get(material) ?? null;
}

/** A zero-intensity light contributes exactly zero. Keep the light slots and
 * original nonzero path (including arbitrarily faint or signed colours), but
 * avoid its attenuation and BRDF calculations. The branch is uniform across
 * fragments; it cannot invalidate texture derivatives or change shadow state. */
export function guardZeroPointLights(source: string) {
  const marker = '#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const end = source.indexOf('#pragma unroll_loop_end', start);
  const assignment = 'pointLight = pointLights[ i ];';
  const at = source.indexOf(assignment, start);
  const closing = source.lastIndexOf('}', end);
  if (end < 0 || at < start || at >= end || closing <= at)
    throw new Error('Unsupported point-light shader layout');
  const branch = '\nif (!apexPointLightWork || any(notEqual(pointLight.color, vec3(0.0)))) {';
  return (
    source.slice(0, at + assignment.length) +
    branch +
    source.slice(at + assignment.length, closing) +
    '}\n' +
    source.slice(closing)
  );
}

export function installPointLightWork(material: T.Material) {
  if (!(material instanceof T.MeshStandardMaterial) || controls.has(material)) return;
  const control = { value: true };
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  controls.set(material, control);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    const original = shader.fragmentShader;
    const expanded = original.replace(
      '#include <lights_fragment_begin>',
      T.ShaderChunk.lights_fragment_begin,
    );
    const guarded = guardZeroPointLights(expanded);
    if (guarded === expanded) return; // A custom material owns a different lighting path.
    shader.fragmentShader = 'uniform bool apexPointLightWork;\n' + guarded;
    shader.uniforms.apexPointLightWork = control;
  };
  material.customProgramCacheKey = () => key + '|exact-zero-point-light-v1';
  material.needsUpdate = true;
}
