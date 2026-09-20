import * as T from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const vertex = /* glsl */ `
  uniform mat4 previousViewProjection;
  uniform mat4 previousModel;
  uniform mat3 clipTransform;
  uniform float historyValid;
  varying vec4 currentClip;
  varying vec4 previousClip;
  varying float viewDepth;
  varying vec2 clipUV;
  void main() {
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    vec4 view = modelViewMatrix * local;
    currentClip = projectionMatrix * view;
    previousClip = historyValid > 0.5
      ? previousViewProjection * previousModel * local : currentClip;
    viewDepth = max(0.0, -view.z);
    clipUV = (clipTransform * vec3(uv, 1.0)).xy;
    gl_Position = currentClip;
  }
`;
const fragment = /* glsl */ `
  uniform sampler2D clipMap;
  uniform float clipThreshold;
  varying vec4 currentClip;
  varying vec4 previousClip;
  varying float viewDepth;
  varying vec2 clipUV;
  void main() {
    if (clipThreshold > 0.0 && texture2D(clipMap, clipUV).a < clipThreshold) discard;
    vec2 velocity = vec2(0.0);
    if (currentClip.w > 0.0001 && previousClip.w > 0.0001)
      velocity = 0.5 * (currentClip.xy / currentClip.w - previousClip.xy / previousClip.w);
    gl_FragColor = vec4(velocity, min(viewDepth, 65000.0), 1.0);
  }
`;
const compositeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const compositeFragment = /* glsl */ `
  uniform sampler2D image;
  uniform sampler2D motion;
  uniform vec2 resolution;
  uniform float shutter;
  uniform float maximumPixels;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(image, vUv);
    vec4 center = texture2D(motion, vUv);
    vec2 pixels = center.rg * resolution * shutter;
    float lengthPixels = length(pixels);
    if (center.a < 0.5 || lengthPixels < 0.25) { gl_FragColor = base; return; }
    pixels *= min(1.0, maximumPixels / max(lengthPixels, 0.0001));
    vec2 sweep = pixels / resolution;
    vec4 sum = base;
    float weight = 1.0;
    for (int i = 1; i <= 6; i++) {
      vec2 uv = vUv - sweep * (float(i) / 6.0);
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
      vec4 neighbor = texture2D(motion, uv);
      // Do not drag foreground bodywork, fences or the sky over the road.
      if (neighbor.a < 0.5 || abs(neighbor.b - center.b) > max(0.15, center.b * 0.025)) continue;
      float w = 1.0 - float(i) / 8.0;
      sum += texture2D(image, uv) * w; weight += w;
    }
    gl_FragColor = sum / weight;
  }
`;
interface History {
  matrix: T.Matrix4;
  frame: number;
  generation: number;
  original: T.Mesh['onBeforeRender'];
  callback: T.Mesh['onBeforeRender'];
}
/** Bounded screen-space velocity blur for rigid meshes and static instances.
 * Color remains current-frame only; history stores transforms, never old images.
 * The HTML HUD is outside this pass. Unsupported GPUs render normally. */
export class MotionBlurPass extends Pass {
  readonly velocityTarget = new T.WebGLRenderTarget(1, 1, {
    type: T.HalfFloatType, format: T.RGBAFormat,
    minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true,
  });
  private white = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  private velocityMaterial: T.ShaderMaterial;
  private composite: T.ShaderMaterial;
  private quad: FullScreenQuad;
  private history = new WeakMap<T.Mesh, History>();
  private visible: T.Mesh[] = [];
  private hidden: T.Object3D[] = [];
  private previousViewProjection = new T.Matrix4();
  private currentViewProjection = new T.Matrix4();
  private previousPosition = new T.Vector3();
  private previousRotation = new T.Quaternion();
  private previousTime = NaN;
  private previousFov = 0;
  private clearColor = new T.Color();
  private generation = 0;
  private frame = 0;
  private ready = false;
  private disposed = false;
  private amount = 0;
  velocityFrames = 0;
  resets = 0;
  constructor(private scene: T.Scene, private camera: T.PerspectiveCamera, readonly supported: boolean) {
    super();
    this.enabled = false;
    this.white.needsUpdate = true;
    this.velocityTarget.texture.name = 'APEX rigid motion / linear depth';
    this.velocityMaterial = new T.ShaderMaterial({
      name: 'APEX rigid motion vectors', vertexShader: vertex, fragmentShader: fragment,
      uniforms: {
        previousViewProjection: { value: this.previousViewProjection },
        previousModel: { value: new T.Matrix4() }, historyValid: { value: 0 },
        clipMap: { value: this.white }, clipThreshold: { value: 0 },
        clipTransform: { value: new T.Matrix3() },
      },
      side: T.DoubleSide, blending: T.NoBlending, toneMapped: false,
    });
    this.composite = new T.ShaderMaterial({
      name: 'APEX depth-gated motion blur', vertexShader: compositeVertex,
      fragmentShader: compositeFragment, depthTest: false, depthWrite: false,
      blending: T.NoBlending, toneMapped: false,
      uniforms: { image: { value: null }, motion: { value: this.velocityTarget.texture },
        resolution: { value: new T.Vector2(1, 1) }, shutter: { value: 0 }, maximumPixels: { value: 24 } },
    });
    this.quad = new FullScreenQuad(this.composite);
  }
  setStrength(value: number) {
    const next = Number.isFinite(value) ? Math.max(0, Math.min(0.6, value)) : 0;
    if (next !== this.amount) this.reset();
    this.amount = next;
    this.composite.uniforms.shutter.value = next;
    this.enabled = !this.disposed && this.supported && next > 0;
  }
  reset() {
    this.ready = false; this.previousTime = NaN; this.generation++; this.resets++;
  }
  setSize(width: number, height: number) {
    this.velocityTarget.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    this.composite.uniforms.resolution.value.set(this.velocityTarget.width, this.velocityTarget.height);
    this.reset();
  }
  /** A dropped frame, seek or camera cut cannot become a full-screen smear. */
  prepareFrame(delta: number, simulationTime: number) {
    if (!this.enabled) return;
    if (!Number.isFinite(delta) || delta <= 0 || delta > 0.12 ||
      !Number.isFinite(simulationTime) ||
      (Number.isFinite(this.previousTime) && (simulationTime < this.previousTime || simulationTime - this.previousTime > 1)) ||
      (this.ready && (this.camera.position.distanceToSquared(this.previousPosition) > 625 ||
        Math.abs(this.camera.quaternion.dot(this.previousRotation)) < 0.96 ||
        Math.abs(this.camera.fov - this.previousFov) > 8))) this.reset();
    this.previousTime = simulationTime;
  }
  private remember(mesh: T.Mesh): History {
    let entry = this.history.get(mesh);
    if (entry) return entry;
    entry = { matrix: new T.Matrix4(), frame: -1, generation: -1,
      original: mesh.onBeforeRender, callback: mesh.onBeforeRender };
    const record = entry;
    record.callback = (_renderer, _scene, _camera, _geometry, _material, group) => {
      const u = this.velocityMaterial.uniforms;
      u.previousModel.value.copy(record.matrix);
      u.historyValid.value = this.ready && record.generation === this.generation && record.frame === this.frame - 1 ? 1 : 0;
      // Three's callback passes a geometry group here (not an Object3D Group).
      const index = (group as unknown as { materialIndex?: number } | null)?.materialIndex ?? 0;
      const source = (Array.isArray(mesh.material) ? mesh.material[index] : mesh.material) as
        T.Material & { map?: T.Texture | null };
      const map = source?.map;
      u.clipThreshold.value = map ? source.alphaTest : 0;
      u.clipMap.value = map ?? this.white;
      if (map) {
        if (map.matrixAutoUpdate) map.updateMatrix();
        u.clipTransform.value.copy(map.matrix);
      } else u.clipTransform.value.identity();
      this.velocityMaterial.uniformsNeedUpdate = true;
    };
    this.history.set(mesh, entry);
    return entry;
  }
  render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget) {
    if (this.disposed || !this.enabled) return;
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    const background = this.scene.background, override = this.scene.overrideMaterial;
    const shadow = renderer.shadowMap.enabled, alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    this.currentViewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.visible.length = 0; this.hidden.length = 0;
    this.scene.traverseVisible((object) => {
      if (object.userData.excludeMotionBlur || object instanceof T.Points || object instanceof T.Line) {
        this.hidden.push(object); return;
      }
      if (!(object instanceof T.Mesh)) return;
      const entry = this.remember(object);
      entry.original = object.onBeforeRender;
      object.onBeforeRender = entry.callback;
      this.visible.push(object);
    });
    try {
      for (const object of this.hidden) object.visible = false;
      renderer.autoClear = false; renderer.shadowMap.enabled = false;
      this.scene.background = null; this.scene.overrideMaterial = this.velocityMaterial;
      renderer.setRenderTarget(this.velocityTarget);
      renderer.setClearColor(0x000000, 0); renderer.clear(true, true, false);
      renderer.render(this.scene, this.camera);
      this.velocityFrames++;
    } finally {
      for (const object of this.hidden) object.visible = true;
      for (const mesh of this.visible) mesh.onBeforeRender = this.history.get(mesh)!.original;
      this.scene.background = background; this.scene.overrideMaterial = override;
      renderer.shadowMap.enabled = shadow; renderer.autoClear = autoClear;
      renderer.setClearColor(this.clearColor, alpha); renderer.setRenderTarget(target);
    }
    // Commit history only after the actual velocity draw succeeds.
    for (const mesh of this.visible) {
      const entry = this.history.get(mesh)!;
      entry.matrix.copy(mesh.matrixWorld); entry.frame = this.frame; entry.generation = this.generation;
    }
    this.previousViewProjection.copy(this.currentViewProjection);
    this.previousPosition.copy(this.camera.position); this.previousRotation.copy(this.camera.quaternion);
    this.previousFov = this.camera.fov; this.ready = true; this.frame++;
    this.composite.uniforms.image.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  diagnostics() {
    return { supported: this.supported, active: this.enabled, strength: this.amount,
      velocityFrames: this.velocityFrames, resets: this.resets,
      width: this.velocityTarget.width, height: this.velocityTarget.height, maximumPixels: 24 };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.enabled = false;
    this.velocityTarget.dispose(); this.velocityMaterial.dispose(); this.composite.dispose();
    this.quad.dispose(); this.white.dispose();
    this.visible.length = 0; this.hidden.length = 0;
    this.history = new WeakMap();
  }
}
