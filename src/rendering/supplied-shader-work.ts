import * as T from 'three';

const controls = new WeakMap<T.Material, { value: boolean }>();
/** Independent same-program oracle; ordinary rendering leaves this enabled. */
export function suppliedShaderWorkControl(material: T.Material) {
  return controls.get(material) ?? null;
}

/** Preserve every source attribute and lighting operation. Zero-weight skin
 * influences contribute exactly zero; a shared packed glTF roughness/metalness
 * texture has the same sampler, UV transform and lookup in both stages. */
export function installSuppliedShaderWork(material: T.MeshStandardMaterial, skeleton?: T.Skeleton) {
  if (controls.has(material)) return;
  const enabled = { value: true };
  const previous = material.onBeforeCompile;
  const beforeRender = material.onBeforeRender;
  const packed = { value: false };
  // This material belongs to the single supplied player's immutable rig. A
  // uniform palette avoids four texture fetches per active influence while
  // retaining the exact float32 matrices and the original texture oracle.
  const boneCount = skeleton?.bones.length ?? 0;
  const palette = { value: skeleton?.boneMatrices.subarray(0, boneCount * 16) };
  const updatePalette = () => {
    if (
      skeleton &&
      (palette.value?.buffer !== skeleton.boneMatrices.buffer ||
        palette.value?.byteOffset !== skeleton.boneMatrices.byteOffset)
    )
      palette.value = skeleton.boneMatrices.subarray(0, boneCount * 16);
  };
  const sharesPackedMap = () =>
    material.roughnessMap !== null && material.roughnessMap === material.metalnessMap;
  material.onBeforeRender = (...args) => {
    beforeRender.apply(material, args);
    updatePalette();
    // Later weather hooks may capture a static cache-key suffix. Even in a
    // reused program, separately transformed maps must retain separate reads.
    packed.value = sharesPackedMap();
  };
  const key = material.customProgramCacheKey();
  controls.set(material, enabled);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    const pars = '#include <skinning_pars_vertex>';
    if (
      boneCount > 0 &&
      boneCount <= 64 &&
      renderer.capabilities?.maxVertexUniforms >= boneCount * 4 + 128 &&
      shader.vertexShader.includes(pars)
    ) {
      const signature = 'mat4 getBoneMatrix( const in float i ) {';
      if (!T.ShaderChunk.skinning_pars_vertex.includes(signature))
        throw new Error('Unsupported supplied bone palette shader');
      const originalSkin = T.ShaderChunk.skinning_pars_vertex.replace(
        signature,
        'mat4 apexTextureBoneMatrix( const in float i ) {',
      );
      shader.vertexShader = shader.vertexShader.replace(
        pars,
        originalSkin +
          `
#ifdef USE_SKINNING
uniform mat4 apexBonePalette[${boneCount}];
mat4 getBoneMatrix( const in float i ) {
  if (apexShaderWork) return apexBonePalette[int(i)];
  return apexTextureBoneMatrix(i);
}
#endif`,
      );
      updatePalette();
      shader.uniforms.apexBonePalette = palette;
    }
    const skin = '#include <skinbase_vertex>';
    if (shader.vertexShader.includes(skin)) {
      // Keep the original weighted additions downstream, including zero and
      // negative weights. Do not renormalize, prune small weights or alter the
      // bind matrices. An opt-out executes the original four matrix reads.
      const source = T.ShaderChunk.skinbase_vertex;
      let optimized = source;
      for (const component of ['x', 'y', 'z', 'w']) {
        const name = `boneMat${component.toUpperCase()}`;
        const read = `mat4 ${name} = getBoneMatrix( skinIndex.${component} );`;
        if (!optimized.includes(read)) throw new Error('Unsupported supplied skin shader');
        optimized = optimized.replace(
          read,
          `mat4 ${name} = mat4(0.0);\n` +
            `if (!apexShaderWork || skinWeight.${component} != 0.0) ` +
            `${name} = getBoneMatrix( skinIndex.${component} );`,
        );
      }
      shader.vertexShader =
        'uniform bool apexShaderWork;\n' + shader.vertexShader.replace(skin, optimized);
    }
    const roughness = '#include <roughnessmap_fragment>';
    const metalness = '#include <metalnessmap_fragment>';
    // Decide from the current maps on EVERY compile, not the initial material.
    // Different texture objects remain independent even when they share an image.
    if (
      material.roughnessMap !== null &&
      material.roughnessMap === material.metalnessMap &&
      shader.fragmentShader.includes(roughness) &&
      shader.fragmentShader.indexOf(metalness) > shader.fragmentShader.indexOf(roughness)
    ) {
      const read = 'vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );';
      if (!T.ShaderChunk.metalnessmap_fragment.includes(read))
        throw new Error('Unsupported supplied metalness shader');
      shader.fragmentShader =
        'uniform bool apexShaderWork; uniform bool apexPackedORM;\n' +
        shader.fragmentShader.replace(
          metalness,
          T.ShaderChunk.metalnessmap_fragment.replace(
            read,
            'vec4 texelMetalness = (apexShaderWork && apexPackedORM) ? texelRoughness : ' +
              'texture2D( metalnessMap, vMetalnessMapUv );',
          ),
        );
    }
    packed.value = sharesPackedMap();
    shader.uniforms.apexPackedORM = packed;
    shader.uniforms.apexShaderWork = enabled;
  };
  // Map identity can change without changing Three's USE_*MAP defines. A new
  // compile must never reuse the packed branch for independently transformed maps.
  material.customProgramCacheKey = () =>
    `${key}:supplied-shader-work-v2:${boneCount}:${
      material.roughnessMap !== null && material.roughnessMap === material.metalnessMap
    }`;
  material.needsUpdate = true;
}
