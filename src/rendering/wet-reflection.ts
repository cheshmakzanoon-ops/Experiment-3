import * as T from 'three';

/** Objects that appear in the wet-road reflection opt in to this layer. */
export const WET_REFLECTION_LAYER = 5;

/** Wet-road planar reflection. Standing water on a broadcast-scale race track
 * mirrors cars, sky, lamps and large structures. One mirrored view is drawn
 * about the horizontal plane under the followed car, with an oblique near
 * plane at the water surface. Only large, reflection-relevant objects opt in
 * (WET_REFLECTION_LAYER), so the extra pass stays a small fraction of the main
 * view's draws. The road's water-film clearcoat lobe samples it with the same
 * Fresnel, puddle and wet masks as before. Mip levels blur it with that lobe's
 * roughness, and it fades with height from the plane and at the frame edge,
 * falling back to the probe environment. */
export const WET_REFLECTION = Object.freeze({
  /** Render-target scale of the drawing buffer, by quality. */
  scale: { low: 0, medium: 0.35, high: 0.5 } as const,
  /** Metres above/below the plane over which the reflection fades out. */
  planeFade: [0.4, 2.5] as const,
  /** Largest mip level used for rough (damp, not flooded) film. */
  maxLod: 5,
});

/** Vertical streak step in reflection UV: base + roughness gain (D22). */
export const WET_STREAK = Object.freeze({ base: 0.004, roughness: 0.03, taps: 7 });

export interface WetReflectionUniforms {
  wetReflection: { value: T.Texture };
  wetReflectionMatrix: { value: T.Matrix4 };
  /** x plane height (m), y strength 0..1, z max LOD, w unused. */
  wetReflectionState: { value: T.Vector4 };
}

export class WetRoadReflection {
  readonly camera = new T.PerspectiveCamera();
  readonly target: T.WebGLRenderTarget;
  readonly uniforms: WetReflectionUniforms;
  private readonly plane = new T.Plane();
  private readonly clip = new T.Vector4();
  private readonly q = new T.Vector4();
  private readonly normal = new T.Vector3(0, 1, 0);
  private readonly planePoint = new T.Vector3();
  private readonly cameraPosition = new T.Vector3();
  private readonly look = new T.Vector3();
  private readonly view = new T.Vector3();
  private readonly rotation = new T.Matrix4();
  private readonly size = new T.Vector2();
  private readonly viewport = new T.Vector4();
  private scale: number = WET_REFLECTION.scale.high;
  passes = 0;
  constructor() {
    this.target = new T.WebGLRenderTarget(4, 4, {
      type: T.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: T.LinearMipmapLinearFilter,
      magFilter: T.LinearFilter,
      generateMipmaps: true,
    });
    this.target.texture.name = 'Wet road planar reflection';
    this.camera.layers.set(WET_REFLECTION_LAYER);
    this.uniforms = {
      wetReflection: { value: this.target.texture },
      wetReflectionMatrix: { value: new T.Matrix4() },
      wetReflectionState: { value: new T.Vector4(0, 0, WET_REFLECTION.maxLod, 0) },
    };
  }
  setQuality(quality: 'low' | 'medium' | 'high') {
    this.scale = WET_REFLECTION.scale[quality];
  }
  get enabled() {
    return this.scale > 0;
  }
  /** Stop the road sampling the reflection. The texture and its matrix belong
   * to the main camera, so passes from other viewpoints (the environment
   * probe and mirrors) must not use them. The next update() re-enables it. */
  suspend() {
    this.uniforms.wetReflectionState.value.y = 0;
  }
  /** Mirror `source` about the horizontal plane y = planeY and render the
   * opted-in objects. `strength` 0 skips the pass and disables sampling. */
  update(
    renderer: T.WebGLRenderer,
    scene: T.Scene,
    source: T.PerspectiveCamera,
    planeY: number,
    strength: number,
  ) {
    const state = this.uniforms.wetReflectionState.value;
    state.x = planeY;
    state.y = 0;
    if (!(strength > 0) || !this.enabled || !Number.isFinite(planeY)) return;
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(64, Math.round(this.size.x * this.scale)),
      height = Math.max(64, Math.round(this.size.y * this.scale));
    if (this.target.width !== width || this.target.height !== height)
      this.target.setSize(width, height);
    source.updateMatrixWorld();
    this.cameraPosition.setFromMatrixPosition(source.matrixWorld);
    this.planePoint.set(this.cameraPosition.x, planeY, this.cameraPosition.z);
    // The camera must be above the water: under it there is nothing to mirror.
    if (this.cameraPosition.y <= planeY + 0.02) return;
    // Mirror the eye and its gaze about the plane (as three's Reflector does).
    this.rotation.extractRotation(source.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rotation).add(this.cameraPosition);
    this.view.subVectors(this.planePoint, this.cameraPosition).reflect(this.normal).negate();
    this.view.add(this.planePoint);
    const camera = this.camera;
    camera.position.copy(this.view);
    this.look.subVectors(this.planePoint, this.look).reflect(this.normal).negate().add(this.planePoint);
    camera.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(this.normal);
    camera.lookAt(this.look);
    camera.near = source.near;
    camera.far = source.far;
    camera.updateMatrixWorld();
    camera.projectionMatrix.copy(source.projectionMatrix);
    // Oblique near plane at the water surface (Lengyel): nothing below it.
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.planePoint);
    this.plane.applyMatrix4(camera.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = camera.projectionMatrix.elements;
    this.q.set(
      (Math.sign(this.clip.x) + p[8]) / p[0],
      (Math.sign(this.clip.y) + p[9]) / p[5],
      -1,
      (1 + p[10]) / p[14],
    );
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    p[2] = this.clip.x;
    p[6] = this.clip.y;
    p[10] = this.clip.z + 1;
    p[14] = this.clip.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    // Texture matrix from world position to the reflection's [0, 1] UV.
    this.uniforms.wetReflectionMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(source.projectionMatrix)
      .multiply(camera.matrixWorldInverse);
    const previousTarget = renderer.getRenderTarget(),
      shadowAuto = renderer.shadowMap.autoUpdate,
      shadowNeeded = renderer.shadowMap.needsUpdate;
    renderer.getViewport(this.viewport);
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    try {
      renderer.setRenderTarget(this.target);
      renderer.clear();
      renderer.render(scene, camera);
      this.passes++;
      state.y = Math.min(1, strength);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(this.viewport);
      renderer.shadowMap.autoUpdate = shadowAuto;
      renderer.shadowMap.needsUpdate = shadowNeeded;
    }
  }
  dispose() {
    this.target.dispose();
  }
}

/** Opt every mesh (and light, which three also culls by layer) under `root`
 * into the reflection pass. Layers are per object, not inherited. */
export function reflectInWetRoad(root: T.Object3D) {
  root.traverse((object) => object.layers.enable(WET_REFLECTION_LAYER));
}

/** GLSL for the road: replaces the clearcoat (water film) environment
 * radiance by the planar reflection where it is valid. */
export const WET_REFLECTION_GLSL = /* glsl */ `
#ifdef USE_CLEARCOAT
if (wetReflectionState.y > 0.0 && material.clearcoat > 0.0) {
  vec4 wetReflectionClip = wetReflectionMatrix * vec4(vFinishWorld, 1.0);
  vec2 wetReflectionUv = wetReflectionClip.xy / wetReflectionClip.w;
  // Ripples and aggregate tilt the film: offset in view space, a few pixels.
  vec3 wetReflectionTilt = geometryClearcoatNormal - normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
  wetReflectionUv += wetReflectionTilt.xy * 0.06;
  vec2 wetReflectionEdge = smoothstep(vec2(0.0), vec2(0.05), wetReflectionUv) *
    (1.0 - smoothstep(vec2(0.95), vec2(1.0), wetReflectionUv));
  float wetReflectionHeight = 1.0 - smoothstep(${WET_REFLECTION.planeFade[0].toFixed(2)}, ${WET_REFLECTION.planeFade[1].toFixed(2)},
    abs(vFinishWorld.y - wetReflectionState.x));
  float wetReflectionWeight = wetReflectionState.y * wetReflectionEdge.x * wetReflectionEdge.y *
    wetReflectionHeight * step(0.0, wetReflectionClip.w);
  float wetReflectionLod = sqrt(material.clearcoatRoughness) * wetReflectionState.z;
  // D22: wet asphalt stretches reflections vertically (anisotropic film),
  // 7 taps along the reflection's vertical, wider on rougher film.
  float wetStreak = ${WET_STREAK.base.toFixed(4)} + ${WET_STREAK.roughness.toFixed(4)} * material.clearcoatRoughness;
  vec3 wetReflectionColor = textureLod(wetReflection, wetReflectionUv, wetReflectionLod).rgb;
  float wetStreakWeight = 1.0;
  for (int k = 1; k <= 3; k++) {
    float w = exp(-0.55 * float(k * k));
    vec2 o = vec2(0.0, wetStreak * float(k));
    wetReflectionColor += w * (textureLod(wetReflection, clamp(wetReflectionUv + o, 0.0, 1.0), wetReflectionLod).rgb +
      textureLod(wetReflection, clamp(wetReflectionUv - o, 0.0, 1.0), wetReflectionLod).rgb);
    wetStreakWeight += 2.0 * w;
  }
  wetReflectionColor /= wetStreakWeight;
  clearcoatRadiance = mix(clearcoatRadiance, wetReflectionColor, wetReflectionWeight);
}
#endif
`;
