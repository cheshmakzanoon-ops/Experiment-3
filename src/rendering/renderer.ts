import * as T from 'three';
import { InertialCamera, ViewOrientation } from './camera-dynamics.ts';
import { ReflectionSystem } from './reflections.ts';
import { DebrisView } from './debris.ts';
import { GpuTimer } from './gpu-timer.ts';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FormulaCar } from './car.ts';
import { CircuitScene } from './circuit.ts';
import { Effects } from './effects.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { F, H, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
export type CameraMode = 'chase' | 'cockpit' | 'pod' | 'trackside';
export type Quality = 'low' | 'medium' | 'high';
export class RacingRenderer {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(58, 1, 0.045, 7000);
  readonly circuit: CircuitScene;
  readonly cars: FormulaCar[] = [];
  readonly effects = new Effects();
  readonly debris = new DebrisView();
  readonly sun = new T.DirectionalLight(0xffead0, 3.3);
  private hemisphere = new T.HemisphereLight(0xe7f2ef, 0x737765, 2);
  private sky = new Sky();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private env: T.WebGLRenderTarget;
  private target = new T.Vector3();
  private desired = new T.Vector3();
  private velocity = new T.Vector3();
  private gaze = new T.Vector3();
  private direction = new T.Vector3();
  private orbitTime = 0;
  private initialized = false;
  private trackPoint = trackPoint();
  mode: CameraMode = 'chase';
  quality: Quality = 'medium';
  shake = 0.35;
  lookX = 0;
  lookY = 0;
  fps = 60;
  frameMs = 16.7;
  renderMs = 0;
  debug = false;
  private follow = 0;
  private inertia = new InertialCamera();
  private viewOrientation = new ViewOrientation();
  private reflection = new ReflectionSystem();
  private gpuTimer: GpuTimer;
  private previousAnchor = new T.Vector3();
  private temporary = new T.Vector3();
  private eyeLocal = new T.Vector3();
  private reflectionMaterials: T.MeshStandardMaterial[] = [];
  private debugGroup = new T.Group();
  private arrows: T.ArrowHelper[] = [];
  private frameSamples = new Float32Array(300);
  private sampleIndex = 0;
  private sampleCount = 0;
  constructor(
    readonly canvas: HTMLCanvasElement,
    track: Track,
  ) {
    const context = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!context)
      throw new Error(
        'This browser or graphics driver does not provide WebGL2. Enable hardware acceleration, then reload.',
      );
    this.renderer = new T.WebGLRenderer({
      canvas,
      context,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.gpuTimer = new GpuTimer(context);
    this.scene.add(this.debris.mesh);
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.sky.scale.setScalar(450000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.8;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.set(-0.55, 0.35, -0.65);
    this.scene.add(this.sky);
    const envScene = new T.Scene();
    envScene.add(this.sky.clone());
    const generator = new T.PMREMGenerator(this.renderer);
    this.env = generator.fromScene(envScene, 0.04, 0.1, 700000);
    generator.dispose();
    this.scene.environment = this.env.texture;
    this.scene.environmentIntensity = 0.7;
    this.scene.fog = new T.FogExp2(0xb9c7c1, 0.00044);
    this.scene.add(this.hemisphere, this.sun, this.sun.target);
    this.sun.position.set(-160, 190, -130);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -65,
      right: 65,
      top: 65,
      bottom: -65,
      near: 20,
      far: 500,
    });
    this.sun.shadow.bias = -0.00012;
    this.sun.shadow.normalBias = 0.035;
    this.circuit = new CircuitScene(track);
    this.scene.add(this.circuit.group, this.effects.group, this.debugGroup);
    for (let i = 0; i < 4; i++) {
      const a = new T.ArrowHelper(new T.Vector3(0, 1, 0), new T.Vector3(), 1, 0x46ffd1, 0.2, 0.1);
      this.arrows.push(a);
      this.debugGroup.add(a);
    }
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.1, 0.3, 1.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }
  setCars(n: number) {
    while (this.cars.length < n) {
      const car = new FormulaCar(this.cars.length);
      this.cars.push(car);
      this.scene.add(car.root);
      if (car.id === 0) {
        this.reflection.attachMirrors(car.mirrors);
        this.reflection.quality(this.quality);
        this.reflectionMaterials.push(car.paint, this.circuit.roadMaterial);
      }
    }
    this.cars.forEach((c, i) => (c.root.visible = i < n));
  }
  setQuality(q: Quality) {
    this.quality = q;
    this.reflection.quality(q);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.bloom.enabled = q === 'high';
    this.circuit.crowd.visible = q !== 'low';
    this.effects.enabled = q !== 'low';
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, q === 'high' ? 1.65 : q === 'medium' ? 1.25 : 1),
    );
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth,
      h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }
  changeCamera(mode?: CameraMode) {
    const modes: CameraMode[] = ['chase', 'cockpit', 'pod', 'trackside'];
    this.mode = mode ?? modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.initialized = false;
    this.inertia.reset();
    this.viewOrientation.reset();
    this.lookX = 0;
    this.lookY = 0;
    return this.mode;
  }
  reset() {
    this.initialized = false;
    this.inertia.reset();
    this.viewOrientation.reset();
    this.effects.clear();
    this.sampleCount = 0;
    this.sampleIndex = 0;
    this.follow = 0;
  }
  draw(
    a: Float32Array,
    b: Float32Array,
    alpha: number,
    dt: number,
    menu = false,
    replay = false,
    wallDelta = dt,
  ) {
    const start = performance.now();
    dt = clamp(dt, 1 / 300, 0.08);
    this.frameMs = this.frameMs * 0.95 + wallDelta * 1000 * 0.05;
    this.fps = 1000 / this.frameMs;
    this.frameSamples[this.sampleIndex++ % 300] = wallDelta * 1000;
    this.sampleCount = Math.min(300, this.sampleCount + 1);
    this.setCars(b[H.CARS]);
    this.orbitTime += dt;
    const time = b[H.TIME],
      o = carBase(this.follow);
    for (let id = 0; id < b[H.CARS]; id++) {
      const base = carBase(id);
      const distance = this.temporary
        .set(b[base + F.X], b[base + F.Y], b[base + F.Z])
        .distanceTo(this.camera.position);
      this.cars[id].setLod(distance, this.quality, id === this.follow);
      this.cars[id].update(
        a,
        b,
        carBase(id),
        alpha,
        dt,
        time,
        !menu && this.mode === 'cockpit' && id === this.follow,
      );
    }
    const car = this.cars[this.follow],
      speed = b[o + F.SPEED];
    const cloud = b[H.CLOUD];
    this.sun.intensity = 3.4 * (1 - cloud * 0.86);
    this.hemisphere.intensity = 1.65 + cloud * 0.8;
    this.scene.environmentIntensity = 0.7 - cloud * 0.15;
    const fog = this.scene.fog as T.FogExp2;
    fog.density = 0.00042 + b[H.RAIN] * 0.000025;
    fog.color.setRGB(0.7 - cloud * 0.14, 0.76 - cloud * 0.14, 0.73 - cloud * 0.12);
    this.sky.material.uniforms.turbidity.value = 5 + cloud * 8;
    this.target.copy(car.root.position);
    this.direction.set(0, 0, 1).applyQuaternion(car.root.quaternion);
    if (menu) {
      const angle = 0.65 + Math.sin(this.orbitTime * 0.07) * 0.12;
      this.desired
        .set(Math.sin(angle) * 6.8, 2.45, Math.cos(angle) * 6.8)
        .applyQuaternion(car.root.quaternion)
        .add(this.target);
      this.gaze
        .copy(this.target)
        .add(new T.Vector3(-0.8, 0.15, 0).applyQuaternion(car.root.quaternion));
      this.camera.fov = 45;
    } else if (this.mode === 'trackside') {
      const s = Math.floor(b[o + F.S] / 100) * 100 + 70;
      this.circuit.track.at(s, this.trackPoint);
      const p = this.trackPoint;
      this.desired.set(p.x + p.nx * 18, p.y + 3.5, p.z + p.nz * 18);
      this.gaze.copy(this.target).addScaledVector(this.direction, speed * 0.12);
      this.camera.fov = 42;
    } else {
      const seated = this.mode === 'cockpit' || this.mode === 'pod';
      if (seated) {
        this.inertia.step(
          dt,
          b[o + F.G_LAT],
          b[o + F.G_LONG],
          b[o + F.G_VERT],
          b[o + F.IMPACT],
          this.shake,
        );
        this.inertia.eye(car.root.position, car.root.quaternion, this.mode === 'pod', this.desired);
        const orientation = this.viewOrientation.update(car.root.quaternion, dt);
        this.direction.set(0, -0.035, 1).applyQuaternion(orientation).normalize();
        this.gaze.copy(this.desired).addScaledVector(this.direction, 40);
      } else {
        this.desired
          .set(0, 2.5 + speed * 0.004, -6.7 - speed * 0.009)
          .applyQuaternion(car.root.quaternion)
          .add(this.target);
        this.gaze.copy(this.target).addScaledVector(this.direction, 8);
        this.gaze.y += 0.3;
      }
      if (this.lookX || this.lookY) {
        this.direction
          .set(Math.sin(this.lookX), this.lookY, Math.cos(this.lookX))
          .applyQuaternion(car.root.quaternion);
        this.gaze.copy(this.desired).addScaledVector(this.direction, 30);
      }
      this.camera.fov = (this.mode === 'chase' ? 57 : 68) + Math.min(7, speed * 0.075);
    }
    if (!this.initialized || this.mode !== 'chase' || menu) {
      this.camera.position.copy(this.desired);
      this.velocity.set(0, 0, 0);
      this.initialized = true;
    } else {
      // Translation feed-forward removes the steady-speed spring lag. Only
      // changes of the chase offset are filtered in this world-space spring.
      this.camera.position.add(this.temporary.copy(this.target).sub(this.previousAnchor));
      // Critically damped positional camera spring; bounded integration substeps.
      const omega = 15,
        n = Math.ceil(dt * 120),
        h = dt / n;
      for (let k = 0; k < n; k++) {
        this.velocity.addScaledVector(
          this.direction.copy(this.desired).sub(this.camera.position),
          omega * omega * h,
        );
        this.velocity.multiplyScalar(Math.exp(-2 * omega * h));
        this.camera.position.addScaledVector(this.velocity, h);
      }
    }
    this.previousAnchor.copy(this.target);
    this.camera.up.set(0, 1, 0);
    if (!menu && (this.mode === 'cockpit' || this.mode === 'pod')) {
      this.temporary.set(0, 1, 0).applyQuaternion(car.root.quaternion);
      this.camera.up.lerp(this.temporary, 0.2).normalize();
    }
    this.camera.lookAt(this.gaze);
    this.camera.updateProjectionMatrix();
    this.sun.target.position.copy(this.target);
    this.sun.position.copy(this.target).add(this.temporary.set(-160, 190, -130));
    this.sun.target.updateMatrixWorld();
    this.circuit.update(b);
    this.effects.update(b, dt, !menu && !replay);
    this.debris.update(b);
    this.debugGroup.visible = this.debug;
    if (this.debug)
      for (let i = 0; i < 4; i++) {
        const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
        this.arrows[i].position
          .copy(car.wheelPivots[i].position)
          .applyQuaternion(car.root.quaternion)
          .add(car.root.position);
        this.arrows[i].setLength(Math.max(0.03, b[p + 1] / 3500), 0.15, 0.08);
      }
    this.reflection.beginFrame(this.orbitTime, !menu && this.mode === 'cockpit');
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.eyeLocal.copy(this.camera.position);
    car.root.worldToLocal(this.eyeLocal);
    this.renderer.info.reset();
    this.gpuTimer.begin();
    try {
      this.reflection.updateProbe(
        this.renderer,
        this.scene,
        car.root,
        this.reflectionMaterials,
        this.quality === 'high' && !menu,
      );
      this.reflection.renderMirrors(this.renderer, this.scene, car.root, dt);
      this.composer.render();
    } finally {
      this.gpuTimer.end();
    }
    this.renderMs = this.renderMs * 0.9 + (performance.now() - start) * 0.1;
  }
  visualDiagnostics() {
    const car = this.cars[this.follow];
    const wheel = new T.Vector3(0, 0.01, -0.025);
    car.steering.localToWorld(wheel);
    const distance = wheel.distanceTo(this.camera.position);
    const ray = new T.Raycaster(
      this.camera.position,
      wheel.clone().sub(this.camera.position).normalize(),
      0.001,
      distance + 0.005,
    );
    const visibleHit = ray.intersectObject(car.root, true).find((hit) => {
      for (let object: T.Object3D | null = hit.object; object; object = object.parent)
        if (!object.visible) return false;
      return true;
    });
    const screenVisible = !!visibleHit && visibleHit.distance >= distance - 0.008;
    wheel.project(this.camera);
    const halo = new T.Vector3(0, 0.35, 0.64);
    car.root.localToWorld(halo);
    halo.project(this.camera);
    return {
      screenVisible,
      wheelProjection: wheel.toArray(),
      haloProjection: halo.toArray(),
      mirrors: this.reflection.diagnostics(this.renderer),
    };
  }
  stats() {
    const info = this.renderer.info.render;
    const sorted = Array.from(this.frameSamples.subarray(0, this.sampleCount)).sort(
      (a, b) => a - b,
    );
    return {
      carLods: this.cars.map((car) => car.lodLevel),
      camera: this.mode,
      cameraLocalPosition: this.eyeLocal.toArray(),
      mirrorUpdates: this.reflection.mirrorUpdates,
      mirrorWidth: this.reflection.mirrorWidth,
      reflectionProbeUpdates: this.reflection.probeUpdates,
      gpuMilliseconds: this.gpuTimer.milliseconds,
      gpuTimerSupported: this.gpuTimer.supported,
      fps: this.fps,
      frameMs: this.frameMs,
      p1FPS: sorted.length ? 1000 / sorted[Math.floor((sorted.length - 1) * 0.99)] : 0,
      renderCPUms: this.renderMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
    };
  }
  dispose() {
    this.reflection.dispose();
    this.gpuTimer.dispose();
    this.bloom.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Points) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
        }
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    this.env.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
