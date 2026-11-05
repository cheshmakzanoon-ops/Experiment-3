import * as T from 'three';

/**
 * Shared scene depth for soft particles (dust, spray, smoke).
 *
 * The scene pass draws opaque geometry and the regular transparents into one
 * target that owns the depth attachment, so a transparent drawn inside that
 * call cannot sample depth (feedback loop on Low; a stale, previous-frame
 * resolve on multisampled presets). A *late layer* is drawn after the scene
 * call, into the same target, while the multisampled attachment holds the
 * opaque depth and the resolved `DepthTexture` already holds this frame's copy
 * of it: sampling it is legal. `SceneAmbientPass.addLateLayer` calls each layer
 * with autoClear and the shadow-map update off, the same (TAA-jittered) camera,
 * and updates `softParticleUniforms` first.
 *
 * Usage (a material that lives in a late layer):
 *
 *   material.onBeforeCompile = (shader) => {
 *     Object.assign(shader.uniforms, softParticleUniforms);
 *     shader.fragmentShader = SOFT_PARTICLE_GLSL + shader.fragmentShader;
 *     // ...then multiply the fragment alpha by apexSoftParticle(viewDepth, 0.6)
 *   };
 *
 * and register the layer's draw once: `renderer.addLateLayer(draw)`.
 *
 * On Low (no multisampling) the depth texture is the attachment itself and must
 * not be sampled: `apexSceneDepthValid` is 0 there and `apexSoftParticle`
 * returns 1 (a hard edge, as before). No extra draw, pass or allocation.
 */
export interface SoftParticleUniforms extends Record<string, T.IUniform> {
  apexSceneDepth: T.IUniform<T.Texture | null>;
  /** Scene target size in pixels (gl_FragCoord is in these units). */
  apexSceneDepthSize: T.IUniform<T.Vector2>;
  /** Camera near and far, metres. */
  apexSceneDepthRange: T.IUniform<T.Vector2>;
  /** 1 while the resolved depth can be sampled, else 0. */
  apexSceneDepthValid: T.IUniform<number>;
}

export function createSoftParticleUniforms(): SoftParticleUniforms {
  return {
    apexSceneDepth: { value: null },
    apexSceneDepthSize: { value: new T.Vector2(1, 1) },
    apexSceneDepthRange: { value: new T.Vector2(0.1, 1000) },
    apexSceneDepthValid: { value: 0 },
  };
}
/** The shared objects every soft-particle material binds by identity. */
export const softParticleUniforms: SoftParticleUniforms = createSoftParticleUniforms();

/** Declarations and `apexSoftParticle(viewDepth, softness)`: 0 where the
 * particle's fragment is at or behind the opaque surface, rising linearly to 1
 * `softness` metres in front of it (and 1 over the sky or when depth is not
 * readable). `viewDepth` is the fragment's positive distance along the view
 * axis (`-vViewPosition.z`). */
export const SOFT_PARTICLE_GLSL = /* glsl */ `
#ifndef APEX_SOFT_PARTICLE_DECLARED
#define APEX_SOFT_PARTICLE_DECLARED
uniform sampler2D apexSceneDepth;
uniform vec2 apexSceneDepthSize;
uniform vec2 apexSceneDepthRange;
uniform float apexSceneDepthValid;
float apexSoftParticle(float viewDepth, float softness) {
  if (apexSceneDepthValid < 0.5) return 1.0;
  float d = texture2D(apexSceneDepth, gl_FragCoord.xy / apexSceneDepthSize).x;
  if (d >= 0.99999) return 1.0;
  float near = apexSceneDepthRange.x, far = apexSceneDepthRange.y;
  // Perspective depth in [0, 1] to positive view distance (three's packing.glsl).
  float ndc = d * 2.0 - 1.0;
  float scene = 2.0 * near * far / (far + near - ndc * (far - near));
  return clamp((scene - viewDepth) / max(softness, 1e-3), 0.0, 1.0);
}
#endif
`;

/** CPU reference of `apexSoftParticle` (tests, documentation). */
export function softParticleFade(
  sceneDistance: number,
  particleDistance: number,
  softness: number,
  readable = true,
) {
  if (
    ![sceneDistance, particleDistance, softness].every((v) => Number.isFinite(v) || v === Infinity)
  )
    throw new Error('Invalid soft particle input');
  if (!readable || sceneDistance === Infinity) return 1;
  return Math.min(1, Math.max(0, (sceneDistance - particleDistance) / Math.max(softness, 1e-3)));
}

/** Point the shared uniforms at this frame's resolved depth. `readable` is false
 * when the depth texture is the (unsampleable) attachment itself. */
export function bindSoftParticleDepth(
  camera: T.PerspectiveCamera,
  target: T.WebGLRenderTarget,
  depth: T.DepthTexture,
  uniforms: SoftParticleUniforms = softParticleUniforms,
) {
  uniforms.apexSceneDepth.value = depth;
  uniforms.apexSceneDepthSize.value.set(target.width, target.height);
  uniforms.apexSceneDepthRange.value.set(camera.near, camera.far);
  uniforms.apexSceneDepthValid.value = target.samples > 0 ? 1 : 0;
}
