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

/** The physical direct-light body contains arithmetic only: shadow/texture
 * sampling already happened in its caller. Exact-zero incident radiance cannot
 * change any diffuse, specular, coat or sheen accumulator. Keeping this guard
 * inside the function leaves all texture derivatives and source-light setup
 * untouched, including finite-distance cutoff and fully shadowed fragments. */
export function guardZeroDirectRadiance(source: string) {
  const marker = 'void RE_Direct_Physical(';
  const start = source.indexOf(marker);
  if (start < 0) return source;
  const brace = source.indexOf('{', start);
  if (brace < 0 || source.indexOf(marker, start + marker.length) >= 0)
    throw new Error('Unsupported physical direct-light shader layout');
  return (
    source.slice(0, brace + 1) +
    '\nif (apexPointLightWork && all(equal(directLight.color, vec3(0.0)))) return;' +
    source.slice(brace + 1)
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
    const expanded = original
      .replace('#include <lights_fragment_begin>', T.ShaderChunk.lights_fragment_begin)
      .replace(
        '#include <lights_physical_pars_fragment>',
        T.ShaderChunk.lights_physical_pars_fragment,
      );
    const guarded = guardZeroDirectRadiance(guardZeroPointLights(expanded));
    if (guarded === expanded) return; // A custom material owns a different lighting path.
    shader.fragmentShader = 'uniform bool apexPointLightWork;\n' + guarded;
    shader.uniforms.apexPointLightWork = control;
  };
  material.customProgramCacheKey = () => key + '|exact-zero-radiance-v2';
  material.needsUpdate = true;
}
