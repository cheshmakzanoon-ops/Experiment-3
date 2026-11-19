import * as T from 'three';

/** The installed r180 generator has no public blur-compilation entry point.
 * Use its own material factory and defines, rather than copy a shader that can
 * diverge from the eventual CubeUV consumer. The native-version regression
 * checks the exact cache key, program handle and reference-count ownership. */
interface PMREM180 {
  _setSize(size: number): void;
  _allocateTargets(): T.WebGLRenderTarget;
  _compileMaterial(material: T.ShaderMaterial): void;
  _blurMaterial: T.ShaderMaterial | null;
}

/** Constructs CPU target/geometry descriptors and links the installed blur
 * material. Nothing renders, uploads or allocates a GPU atlas. The unused
 * output descriptor is released immediately; the generator owns the remaining
 * descriptors and its material until the reflection owner disposes it. */
export function compileProbeBlur(generator: T.PMREMGenerator, size: number) {
  const native = generator as unknown as PMREM180;
  if (
    T.REVISION !== '180' ||
    typeof native._setSize !== 'function' ||
    typeof native._allocateTargets !== 'function' ||
    typeof native._compileMaterial !== 'function'
  )
    throw new Error('Reflection blur preparation requires the Three r180 PMREM interface');
  native._setSize(size);
  const unusedOutput = native._allocateTargets();
  try {
    const material = native._blurMaterial;
    if (!material?.isShaderMaterial || material.name !== 'SphericalGaussianBlur')
      throw new Error('Reflection blur preparation did not receive the native PMREM material');
    native._compileMaterial(material);
  } finally {
    unusedOutput.dispose();
  }
}
