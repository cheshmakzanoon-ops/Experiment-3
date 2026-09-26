import { readRaceReviewFrame } from './race-review.ts';
import { WeatherPresentation } from './weather-presentation.ts';
import { applyCircuitLightPalette } from './lighting-coherence.ts';
import { PEOPLE_ASSET } from './people-asset.ts';
import { loadDriverAsset, type DriverAsset } from './driver-asset.ts';
import { loadHeroShells, type HeroShells } from './hero-shells.ts';
import { AdaptiveExposurePass } from './adaptive-exposure.ts';
import { LocalAtmosphere } from './local-atmosphere.ts';
import { RaceComposition } from './race-composition.ts';
import { captureRenderedCanvas } from './frame-capture.ts';
import { reviewHardware } from '../ui/review-hardware.ts';
import type { ReviewFrame } from './presentation-review.ts';
import { photoSubject } from './photo-subject.ts';
import { HeadquartersStage } from './headquarters-stage.ts';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { GeometrySurvey } from './geometry-survey.ts';
import { DrivingGuide } from './driving-guide.ts';
import { GridPreparationView } from './grid-preparation.ts';
import { PhotoStage, ScenePresentationScope } from './photo-stage.ts';
import { VenueLighting } from './venue-lighting.ts';
import {
  photoLens,
  photoFov,
  photoOffset,
  validatePhoto,
  type PhotoSettings,
} from './photo-camera.ts';
import { type Livery } from '../storage/livery.ts';
import {
  configureSky,
  circuitLightState,
  shadowAnchor,
  SkyEnvironment,
  SUN_OFFSET,
  lightingDirection,
  lightingMode,
  type LightingMode,
} from './daylight.ts';
import { EngineeringView } from './engineering-view.ts';
import type { EngineeringSample } from '../workers/diagnostics.ts';
import * as T from 'three';
import type { FrameMetrics } from '../core/performance.ts';
import type { BuildProgress } from './build-queue.ts';
import { TracksideDirector } from './trackside.ts';
import { CameraClock, InertialCamera, ViewOrientation } from './camera-dynamics.ts';
import { ReflectionSystem } from './reflections.ts';
import { DebrisView } from './debris.ts';
import { PitCrewView, serviceWheelOffset } from './pit-crew.ts';
import { MotionBlurPass } from './motion-blur.ts';
import { GpuTimer } from './gpu-timer.ts';
import { GpuFrameGate } from './gpu-frame-gate.ts';
import { TextureBudget } from './texture-budget.ts';
import {
  graphicsPreset,
  validateGraphics,
  bufferSize,
  type GraphicsOptions,
  type Quality,
} from './options.ts';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FormulaCar } from './car.ts';
import { CircuitScene } from './circuit.ts';
import { Effects } from './effects.ts';
import { PresentedFrame } from './frame-state.ts';
import { EffectPlayback } from './effect-playback.ts';
import { AudioViewTracker } from '../audio/spatial.ts';
import { Track } from '../simulation/track.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';
export type CameraMode = 'chase' | 'cockpit' | 'pod' | 'trackside';
export type { Quality } from './options.ts';
export class RacingRenderer {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(58, 1, 0.045, 7000);
  readonly circuit: CircuitScene;
  readonly cars: FormulaCar[] = [];
  readonly audioView = new AudioViewTracker();
  readonly effects = new Effects();
  readonly presented = new PresentedFrame();
  readonly effectPlayback = new EffectPlayback(this.effects);
  readonly debris = new DebrisView();
  readonly pitCrew = new PitCrewView();
  readonly gridPreparation = new GridPreparationView();
  readonly photoStage = new PhotoStage();
  private headquarters: HeadquartersStage | null = null;
  private scenePresentation = new ScenePresentationScope(this.scene);
  private nightFog = new T.Color(0x111b2c);
  readonly guide: DrivingGuide;
  readonly venueLighting: VenueLighting;
  private lightingMode: LightingMode = 'day';
  get lighting(): LightingMode {
    return this.lightingMode;
  }
  set lighting(value: LightingMode) {
    this.lightingMode = lightingMode(value);
  }
  // Legacy inspection routes retain their boolean day/night contract.
  get night() {
    return this.lightingMode === 'night';
  }
  set night(value: boolean) {
    this.lightingMode = lightingMode(value);
  }
  colorblind = false;
  readonly sun = new T.DirectionalLight(0xffead0, 3.3);
  private hemisphere = new T.HemisphereLight(0xc3d8f3, 0x33372e, 0.3);
  private sky = new Sky();
  private composer: EffectComposer;
  private exposure = new AdaptiveExposurePass();
  private atmosphere: LocalAtmosphere;
  private weatherPresentation = new WeatherPresentation();
  private composition = new RaceComposition();
  private bloom: UnrealBloomPass;
  private photoFocus: BokehPass | null = null;
  private geometrySurvey: GeometrySurvey | null = null;
  private motionBlur: MotionBlurPass;
  private fxaa = new ShaderPass(FXAAShader);
  private textures = new TextureBudget();
  graphics: GraphicsOptions = graphicsPreset('medium');
  private renderWidth = 1;
  private renderHeight = 1;
  private environment: SkyEnvironment;
  private disposed = false;
  private heroShells: HeroShells | null = null;
  private driverAsset: DriverAsset | null = null;
  private target = new T.Vector3();
  private desired = new T.Vector3();
  private velocity = new T.Vector3();
  private gaze = new T.Vector3();
  private direction = new T.Vector3();
  private orbitTime = 0;
  private initialized = false;
  private trackside: TracksideDirector;
  mode: CameraMode = 'chase';
  photo: PhotoSettings | null = null;
  quality: Quality = 'medium';
  shake = 0.35;
  lookX = 0;
  lookY = 0;
  fps = 60;
  frameMs = 16.7;
  renderMs = 0;
  private lastRenderCPUms = 0;
  debug = false;
  private follow = 0;
  private cameraClock = new CameraClock();
  private inertia = new InertialCamera();
  private viewOrientation = new ViewOrientation();
  private reflection = new ReflectionSystem();
  private gpuTimer: GpuTimer;
  private gpuFrames: GpuFrameGate;
  private previousAnchor = new T.Vector3();
  private temporary = new T.Vector3();
  private eyeLocal = new T.Vector3();
  private reflectionMaterials: T.MeshStandardMaterial[] = [];
  readonly engineeringView = new EngineeringView();
  engineering: EngineeringSample | null = null;
  replayView = false;
  // Requested mode changes on input; diagnostics describe a completed rendered
  // frame, so camera/listener data cannot claim two different views.
  private renderedMode: CameraMode | null = null;
  private frameSamples = new Float32Array(300);
  private sampleIndex = 0;
  private sampleCount = 0;
  constructor(
    readonly canvas: HTMLCanvasElement,
    track: Track,
    deferred = false,
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
    this.gpuFrames = new GpuFrameGate(context);
    this.atmosphere = new LocalAtmosphere(track);
    this.guide = new DrivingGuide(track);
    this.venueLighting = new VenueLighting(track);
    this.scene.add(
      this.guide.mesh,
      this.gridPreparation.root,
      this.photoStage.root,
      this.venueLighting.root,
    );
    this.scene.add(this.debris.mesh, this.pitCrew.root);
    this.renderer.info.autoReset = false;
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.sky.scale.setScalar(450000);
    this.sky.userData.excludeMotionBlur = true;
    configureSky(this.sky);
    this.environment = new SkyEnvironment(this.sky);
    this.scene.add(this.sky);
    this.scene.environmentIntensity = 0.7;
    this.scene.fog = new T.FogExp2(0xb9c7c1, 0.00044);
    this.scene.add(this.hemisphere, this.sun, this.sun.target);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -38,
      right: 38,
      top: 38,
      bottom: -38,
      near: 20,
      far: 500,
    });
    this.sun.shadow.bias = -0.000015;
    this.sun.shadow.normalBias = 0.008;
    this.circuit = new CircuitScene(track, true);
    this.circuit.construction.add('Event hall broadcast bounds', 1, () =>
      this.venueLighting.registerSightlines(this.circuit.sightlines),
    );
    this.circuit.construction.add('Environment lighting', 1, () => {
      this.environment.update(this.renderer, this.scene, 0);
    });
    // Bind after every static venue task and spatial batching; early binding
    // misses the district, grandstand, foliage and infrastructure materials.
    this.circuit.construction.add('Local weather materials', 5, () => {
      this.weatherPresentation.install(this.scene);
      this.atmosphere.install(this.scene);
    });
    this.trackside = new TracksideDirector(track, (from, to) =>
      this.circuit.sightlines.blocked(from, to),
    );
    this.scene.add(this.circuit.group, this.effects.group, this.engineeringView.group);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.exposure);
    this.motionBlur = new MotionBlurPass(
      this.scene,
      this.camera,
      this.renderer.extensions.has('EXT_color_buffer_float'),
    );
    this.composer.addPass(this.motionBlur);
    this.bloom = new UnrealBloomPass(new T.Vector2(1, 1), 0.1, 0.3, 1.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.fxaa);
    if (!deferred) {
      this.circuit.construction.runSynchronously();
      this.textures.register(this.circuit.group);
    }
    this.resize();
  }
  /** The factory owns partial resources until the complete scene is ready.
   * Cancellation disposes the partial scene; a failed job is never hidden. */
  static async create(
    canvas: HTMLCanvasElement,
    track: Track,
    progress: (value: BuildProgress) => void,
    cancelled: () => boolean,
  ): Promise<RacingRenderer | null> {
    const renderer = new RacingRenderer(canvas, track, true);
    renderer.circuit.construction.add('Player car and live instruments', 1, () =>
      renderer.setCars(1),
    );
    try {
      progress({ completed: 0, total: 1, fraction: 0, label: 'Loading Blender-authored bodywork' });
      renderer.heroShells = await loadHeroShells(cancelled);
      renderer.driverAsset = await loadDriverAsset(cancelled);
      if (cancelled()) {
        renderer.dispose();
        return null;
      }
      if (!(await renderer.circuit.construction.run(progress, cancelled))) {
        renderer.dispose();
        return null;
      }
      renderer.textures.register(renderer.circuit.group);
      return renderer;
    } catch (error) {
      renderer.dispose();
      if (cancelled()) return null;
      throw error;
    }
  }
  setCars(n: number) {
    while (this.cars.length < n) {
      const car = new FormulaCar(
        this.cars.length,
        this.heroShells ?? undefined,
        this.driverAsset ?? undefined,
      );
      this.cars.push(car);
      this.scene.add(car.root);
      this.textures.register(car.root);
      this.weatherPresentation.install(car.root);
      this.atmosphere.install(car.root);
      if (car.id === 0) {
        this.reflection.attachMirrors(car.mirrors);
        this.reflection.quality(this.graphics.mirrorQuality);
        this.reflectionMaterials.push(...car.reflectivePaint, this.circuit.roadMaterial);
      }
    }
    this.cars.forEach((c, i) => (c.root.visible = i < n));
  }
  warmupFrames = 0;
  /** Build the grid and warm real GPU paths while the physics worker is paused.
   * Yield between car construction and shader stages so progress can repaint.
   * No recording sample or race time is invented during loading. */
  async prepare(
    frame: Float32Array,
    progress: (message: string) => void,
    cancelled: () => boolean,
    yieldFrame: () => Promise<void> = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve())),
  ) {
    const total = frame[H.CARS];
    if (!Number.isInteger(total) || total < 1 || total > 12) throw new Error('Invalid warmup grid');
    for (let n = this.cars.length + 1; n <= total; n++) {
      if (cancelled()) return false;
      progress(`Building original Formula car ${n} / ${total}…`);
      this.setCars(n);
      await yieldFrame();
    }
    if (cancelled()) return false;
    this.setCars(total);
    for (let i = 0; i < total; i++)
      this.cars[i].update(frame, frame, carBase(i), 1, 1 / 120, frame[H.TIME], false);
    progress('Compiling circuit and vehicle materials…');
    await yieldFrame();
    if (cancelled()) return false;
    await this.renderer.compileAsync(this.scene, this.camera);
    if (cancelled()) return false;
    const camera = this.mode;
    try {
      for (const mode of ['chase', 'cockpit'] as const) {
        progress(
          mode === 'chase'
            ? 'Warming shadows and scene reflections…'
            : 'Warming cockpit, mirrors and post-processing…',
        );
        await yieldFrame();
        if (cancelled()) return false;
        this.changeCamera(mode);
        this.draw(frame, frame, 1, 1 / 120, false, true);
        this.warmupFrames++;
        await this.renderer.compileAsync(this.scene, this.camera);
        if (cancelled()) return false;
      }
    } finally {
      if (!cancelled()) {
        this.changeCamera(camera);
        this.reset();
      }
    }
    return true;
  }
  setQuality(q: Quality, options: GraphicsOptions = graphicsPreset(q)) {
    this.quality = q;
    this.graphics = validateGraphics(options, q);
    const g = this.graphics;
    this.reflection.quality(g.mirrorQuality);
    this.renderer.shadowMap.enabled = g.shadowSize > 0;
    if (this.sun.shadow.mapSize.x !== g.shadowSize && g.shadowSize > 0) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapPass?.dispose();
      this.sun.shadow.mapPass = null;
      this.sun.shadow.mapSize.set(g.shadowSize, g.shadowSize);
      this.sun.shadow.needsUpdate = true;
    }
    this.bloom.enabled = g.bloom;
    this.motionBlur.setStrength(g.motionBlur);
    this.fxaa.enabled = g.antialias;
    this.circuit.crowd.visible = g.crowd;
    this.circuit.vegetationGroup.traverse((object) => {
      if (object instanceof T.InstancedMesh)
        object.count = Math.floor(object.userData.fullCount * g.vegetationDensity);
    });
    this.effects.enabled = g.particleDensity > 0;
    this.effects.density = g.particleDensity;
    this.textures.configure(
      g.textureSize,
      Math.min(g.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.resize();
  }
  resize() {
    this.exposure.reset();
    const w = this.canvas.clientWidth || innerWidth,
      h = this.canvas.clientHeight || innerHeight;
    const size = bufferSize(
      w,
      h,
      Math.min(devicePixelRatio, 1.5) * this.graphics.resolutionScale,
      this.renderer.capabilities.maxTextureSize,
    );
    const ratio = Math.min(size.width / w, size.height / h);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    const actual = this.renderer.getDrawingBufferSize(new T.Vector2());
    this.renderWidth = actual.x;
    this.renderHeight = actual.y;
    this.fxaa.uniforms.resolution.value.set(1 / actual.x, 1 / actual.y);
  }
  setLivery(livery: Livery) {
    const car = this.cars[0];
    if (!car) return;
    car.setLivery(livery);
    for (const material of car.reflectivePaint)
      if (material.map) this.textures.refresh(material.map);
    this.reflection.invalidate();
  }
  setPhoto(value: PhotoSettings | null, cars = this.cars.length) {
    const previous = this.photo;
    this.photo = value ? validatePhoto(value, cars) : null;
    if (previous?.view !== this.photo?.view || previous?.target !== this.photo?.target) {
      this.trackside.reset();
      this.composition.reset();
      this.exposure.reset();
    }
    if (this.photo?.backdrop === 'headquarters' && !this.headquarters) {
      this.headquarters = new HeadquartersStage();
      this.scene.add(this.headquarters.root);
      this.textures.register(this.headquarters.root);
      this.textures.configure(
        this.graphics.textureSize,
        Math.min(this.graphics.anisotropy, this.renderer.capabilities.getMaxAnisotropy()),
      );
    }
    if (this.photo?.depthOfField && !this.photoFocus) {
      this.photoFocus = new BokehPass(
        this.scene,
        this.camera,
        photoLens(this.photo, this.photo.distance),
      );
      this.composer.insertPass(this.photoFocus, 1);
    }
    if (this.photoFocus) this.photoFocus.enabled = !!this.photo?.depthOfField;
    if (this.photo && this.photo.survey !== 'off') {
      this.geometrySurvey ??= new GeometrySurvey();
      if (!previous || previous.survey === 'off' || previous.target !== this.photo.target)
        this.geometrySurvey.dirty = true;
    }
    this.follow = this.photo?.target ?? 0;
    this.initialized = false;
    this.motionBlur.reset();
    this.audioView.reset();
    this.reflection.invalidate();
  }
  /** Called by the application's RAF loop before mutating presentation state. */
  canSubmitFrame(): boolean {
    return this.gpuFrames.ready();
  }
  /** Called immediately after draw; preserveDrawingBuffer is not required. */
  capturePhoto(): Promise<Blob> {
    // Called in the same presentation task: own the pixels before async PNG encoding.
    return captureRenderedCanvas(this.canvas);
  }
  changeCamera(mode?: CameraMode) {
    // The meter invalidates old-view reads while preserving adapted brightness.
    this.composition.reset();
    this.motionBlur.reset();
    this.audioView.reset();
    this.cameraClock.reset();
    const modes: CameraMode[] = ['chase', 'cockpit', 'pod', 'trackside'];
    this.mode = mode ?? modes[(modes.indexOf(this.mode) + 1) % modes.length];
    this.initialized = false;
    this.inertia.reset();
    this.viewOrientation.reset();
    this.trackside.reset();
    this.lookX = 0;
    this.lookY = 0;
    return this.mode;
  }
  reset() {
    this.exposure.reset();
    this.composition.reset();
    this.reflection.invalidate();
    this.motionBlur.reset();
    this.audioView.reset();
    this.cameraClock.reset();
    this.initialized = false;
    this.inertia.reset();
    this.viewOrientation.reset();
    this.trackside.reset();
    this.effectPlayback.reset();
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
    const cameraMode: CameraMode =
      this.photo && this.photo.view !== 'orbit' ? this.photo.view : this.mode;
    const start = performance.now();
    dt = clamp(dt, 1 / 300, 0.08);
    this.frameMs = this.frameMs * 0.95 + wallDelta * 1000 * 0.05;
    this.fps = 1000 / this.frameMs;
    this.frameSamples[this.sampleIndex++ % 300] = wallDelta * 1000;
    this.sampleCount = Math.min(300, this.sampleCount + 1);
    this.setCars(b[H.CARS]);
    this.orbitTime += dt;
    const presented = this.presented.sample(a, b, alpha);
    const cameraDt = this.cameraClock.step(presented[H.TIME], menu && !this.photo);
    if (this.cameraClock.discontinuous) {
      // Exposure owns its own simulation clock and camera-cut generation.
      this.composition.reset();
      this.inertia.reset();
      this.viewOrientation.reset();
      this.trackside.reset();
      this.audioView.reset();
      this.initialized = false;
    }
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
        (!this.photo || this.photo.view === 'cockpit') &&
          (!menu || !!this.photo) &&
          cameraMode === 'cockpit' &&
          id === this.follow,
      );
    }
    const car = this.cars[this.follow],
      speed = b[o + F.SPEED];
    const studio = !!this.photo && this.photo.backdrop !== 'circuit';
    const illumination: LightingMode = studio ? 'day' : this.lighting;
    const daylight = circuitLightState(presented[H.CLOUD], presented[H.RAIN], illumination);
    if (this.night && !studio)
      this.nightFog.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    if (studio) {
      daylight.sun = 1.4;
      daylight.fill = 0.25;
      daylight.environment = 0.3;
    }
    this.venueLighting.update(
      illumination !== 'day',
      car.root.position,
      illumination === 'sunset' ? 0.18 : 1,
    );
    applyCircuitLightPalette(this.sun, this.hemisphere, daylight.cover, illumination);
    this.sun.intensity = daylight.sun;
    this.hemisphere.intensity = daylight.fill;
    this.scene.environmentIntensity = daylight.environment;
    // Explicit local envMaps do not inherit scene.environmentIntensity.
    // Keep their exposure in the same authored range as the sky environment.
    for (const material of this.reflectionMaterials)
      material.envMapIntensity = daylight.environment;
    this.renderer.toneMappingExposure = daylight.exposure * 2 ** (this.photo?.exposure ?? 0);
    const fog = this.scene.fog as T.FogExp2;
    fog.density = daylight.fogDensity;
    fog.color.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    this.sky.material.uniforms.turbidity.value = daylight.turbidity;
    this.sky.material.uniforms.cloudCover.value = daylight.cover;
    this.sky.material.uniforms.skyRadiance.value = daylight.skyRadiance;
    this.sky.material.uniforms.nightAmount.value = illumination === 'night' ? 1 : 0;
    this.sky.material.uniforms.sunsetAmount.value = illumination === 'sunset' ? 1 : 0;
    this.sky.material.uniforms.sunPosition.value.copy(lightingDirection(illumination));
    this.target.copy(car.root.position);
    this.direction.set(0, 0, 1).applyQuaternion(car.root.quaternion);
    if (this.photo?.view === 'orbit') {
      const offset = photoOffset(this.photo);
      // Read actual articulated world transforms after this snapshot's car update.
      // A close helmet photograph must orbit the helmet, not the chassis centre.
      photoSubject(car, this.photo.focusSubject, this.gaze);
      this.desired
        .set(offset[0], offset[1] - 0.15, offset[2])
        .applyQuaternion(car.root.quaternion)
        .add(this.gaze);
      this.camera.fov = photoFov(this.photo.focalLength);
    } else if (menu && !this.photo) {
      const angle = 0.65 + Math.sin(this.orbitTime * 0.07) * 0.12;
      this.desired
        .set(Math.sin(angle) * 6.8, 2.45, Math.cos(angle) * 6.8)
        .applyQuaternion(car.root.quaternion)
        .add(this.target);
      this.gaze
        .copy(this.target)
        .add(this.temporary.set(-0.8, 0.15, 0).applyQuaternion(car.root.quaternion));
      this.camera.fov = 45;
    } else if (cameraMode === 'trackside') {
      const composition = this.composition.update(presented, this.follow);
      this.trackside.update(
        presented[o + F.S],
        composition.target,
        composition.velocity,
        cameraDt,
        this.camera.aspect,
        composition.radius,
        true,
        composition.visibility,
      );
      this.desired.copy(this.trackside.position);
      this.gaze.copy(this.trackside.gaze);
      this.camera.fov = this.trackside.fov;
    } else {
      const seated = cameraMode === 'cockpit' || cameraMode === 'pod';
      if (seated) {
        if (cameraDt > 0)
          this.inertia.step(
            cameraDt,
            b[o + F.G_LAT],
            b[o + F.G_LONG],
            b[o + F.G_VERT],
            b[o + F.IMPACT],
            this.shake,
          );
        this.inertia.eye(
          car.root.position,
          car.root.quaternion,
          cameraMode === 'pod',
          this.desired,
        );
        const orientation = this.viewOrientation.update(car.root.quaternion, cameraDt);
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
      this.camera.fov = (cameraMode === 'chase' ? 57 : 68) + Math.min(7, speed * 0.075);
    }
    if (!this.initialized || cameraMode !== 'chase' || menu || this.photo) {
      this.camera.position.copy(this.desired);
      this.velocity.set(0, 0, 0);
      this.initialized = true;
    } else {
      // Translation feed-forward removes the steady-speed spring lag. Only
      // changes of the chase offset are filtered in this world-space spring.
      this.camera.position.add(this.temporary.copy(this.target).sub(this.previousAnchor));
      // Critically damped positional camera spring; bounded integration substeps.
      const omega = 15,
        n = Math.max(1, Math.ceil(cameraDt * 120)),
        h = cameraDt / n;
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
    if (
      (!this.photo || this.photo.view !== 'orbit') &&
      (!menu || !!this.photo) &&
      (cameraMode === 'cockpit' || cameraMode === 'pod')
    ) {
      this.temporary.set(0, 1, 0).applyQuaternion(car.root.quaternion);
      this.camera.up.lerp(this.temporary, 0.2).normalize();
    }
    this.camera.lookAt(this.gaze);
    if (this.photo) this.camera.rotateZ((this.photo.roll * Math.PI) / 180);
    this.camera.updateProjectionMatrix();
    shadowAnchor(
      this.target,
      this.sun.shadow.mapSize.x,
      this.sun.shadow.camera.right,
      this.sun.target.position,
      illumination,
    );
    this.sun.position.copy(this.sun.target.position).add(lightingDirection(illumination));
    this.sun.target.updateMatrixWorld();
    this.circuit.update(b);
    this.atmosphere.update(presented, this.graphics.localFog && !studio);
    this.weatherPresentation.update(presented, !studio);
    this.circuit.staff.update(
      presented,
      this.camera.position,
      this.circuit.crowd.visible && !studio && !menu,
    );
    if (this.circuit.crowd.visible)
      for (const cluster of this.circuit.crowdClusters)
        cluster.update(presented[H.TIME], this.camera.position, presented[H.RAIN], presented);
    this.effectPlayback.update(presented, !menu, !replay);
    this.effects.setSignalLights(presented, !studio);
    this.debris.update(b);
    this.pitCrew.update(presented, this.camera.position, !menu && !studio);
    this.gridPreparation.update(
      presented,
      this.camera.position,
      (!menu || !!this.photo) && !studio,
    );
    this.guide.update(presented, !menu && !this.photo, this.colorblind);
    this.replayView = replay;
    this.engineeringView.update(this.engineering, b[H.TIME], this.debug, replay);
    this.reflection.beginFrame(
      menu ? this.orbitTime : presented[H.TIME],
      (!this.photo || this.photo.view === 'cockpit') &&
        (!menu || !!this.photo) &&
        cameraMode === 'cockpit',
    );
    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.audioView.update(
      this.camera,
      this.presented.value[H.TIME],
      cameraMode === 'trackside' ? this.trackside.activeId + 1 : 0,
      !menu && (cameraMode === 'cockpit' || cameraMode === 'pod'),
      this.follow,
    );
    this.eyeLocal.copy(this.camera.position);
    car.root.worldToLocal(this.eyeLocal);
    this.renderer.info.reset();
    this.gpuTimer.begin();
    const originalOverride = this.scene.overrideMaterial;
    try {
      if (studio) {
        const road = this.circuit.track.at(presented[o + F.S], { ...this.circuit.track.points[0] });
        const stage =
          this.photo?.backdrop === 'headquarters' ? this.headquarters! : this.photoStage;
        stage.position(car.root, road.y);
        this.scenePresentation.begin(stage.background, true);
        this.scenePresentation.visibilityFor(stage.root, true);
        for (const group of [
          this.circuit.group,
          this.sky,
          this.venueLighting.root,
          this.effects.group,
          this.debris.mesh,
          this.gridPreparation.root,
          this.pitCrew.root,
          this.engineeringView.group,
        ])
          this.scenePresentation.visibilityFor(group, false);
        for (const other of this.cars)
          if (other !== car) this.scenePresentation.visibilityFor(other.root, false);
      } else if (this.night) {
        this.scenePresentation.begin(this.venueLighting.nightBackground, false, this.nightFog);
        // Retain the real skydome and its recorded-cloud night shader.
      }
      // Include weather-driven environment captures in real GPU/draw metrics.
      this.environment.update(this.renderer, this.scene, daylight.cover, illumination);
      let wheelWater = 0;
      for (let wheel = 0; wheel < 4; wheel++)
        wheelWater = Math.max(wheelWater, b[o + WHEEL_BASE + wheel * WHEEL_STRIDE + W.WATER]);
      const wetReflection = wheelWater > 0.04 || b[H.RAIN] > 0.01;
      this.reflection.updateProbe(
        this.renderer,
        this.scene,
        car.root,
        this.reflectionMaterials,
        this.graphics.reflections === 'local' && !menu && !studio,
        wetReflection ? 0.55 : 1.5,
      );
      this.reflection.renderMirrors(this.renderer, this.scene, car.root, dt);
      this.motionBlur.setStrength(this.photo ? 0 : this.graphics.motionBlur);
      this.motionBlur.prepareFrame(wallDelta, b[H.TIME]);
      if (this.photoFocus?.enabled && this.photo) {
        // Optical-axis depth, rather than Euclidean distance, matches the depth shader.
        this.camera.updateMatrixWorld();
        const depth = -this.temporary.copy(this.gaze).applyMatrix4(this.camera.matrixWorldInverse)
          .z;
        const lens = photoLens(this.photo, depth);
        for (const key of ['focus', 'aperture', 'maxblur'] as const)
          this.photoFocus.materialBokeh.uniforms[key].value = lens[key];
      }
      // The meter sees linear scene pixels; only the final output exposure adapts.
      // Photo exposure and studio lighting remain manual and exactly held.
      this.renderer.toneMappingExposure = this.exposure.prepare(
        presented[H.TIME],
        `${illumination}:${cameraMode}:${cameraMode === 'trackside' ? this.trackside.activeId : -1}:${this.follow}`,
        daylight.exposure * 2 ** (this.photo?.exposure ?? 0),
        this.graphics.autoExposure && !this.photo && !menu,
      );
      this.composer.render();
      if (this.photo && this.photo.survey !== 'off' && this.geometrySurvey) {
        if (this.geometrySurvey.dirty)
          this.geometrySurvey.rebuild(
            [this.circuit.group, ...this.cars.filter((c) => c.root.visible).map((c) => c.root)],
            car.root.position,
          );
        this.geometrySurvey.render(
          this.renderer,
          this.camera,
          this.photo.survey === 'points' ? 1 : this.photo.split,
        );
      }
    } finally {
      // BokehPass temporarily installs a depth override; restore even on GPU failure.
      this.scene.overrideMaterial = originalOverride;
      this.scenePresentation.restore();
      this.gpuTimer.end();
    }
    this.gpuFrames.submittedFrame();
    this.renderedMode = cameraMode;
    this.lastRenderCPUms = performance.now() - start;
    this.renderMs = this.renderMs * 0.9 + this.lastRenderCPUms * 0.1;
  }
  reviewHardware() {
    return reviewHardware(this.renderer.getContext());
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
      driver: car.driver.diagnostics(),
      authoredBodywork: this.heroShells?.diagnostics() ?? null,
      authoredDriver: this.driverAsset?.diagnostics() ?? null,
      // Bounded CPU summary; no texture readback or per-person geometry walk.
      pitPersonnel: this.pitCrew.summary(),
      crowdPersonnel: {
        ...PEOPLE_ASSET,
        clusters: this.circuit.crowdClusters.length,
        population: this.circuit.crowdClusters.reduce((n, c) => n + c.levels[0].count, 0),
        // LOD selections, not a claim that off-frustum instances were drawn.
        selectedByLevel: [0, 1, 2, 3].map((level) =>
          this.circuit.crowdClusters.reduce(
            (n, c) => n + (c.levels[level].visible ? c.levels[level].count : 0),
            0,
          ),
        ),
      },
      pitCrews: this.pitCrew.activeCrews,
      haloProjection: halo.toArray(),
      mirrors: this.reflection.diagnostics(this.renderer),
      particles: this.effects.diagnostics(),
    };
  }
  /** Copy unaveraged counters without allocating/sorting a debug snapshot. */
  readPerformanceMetrics(target: FrameMetrics) {
    target.renderCPUms = this.lastRenderCPUms;
    target.drawCalls = this.renderer.info.render.calls;
    target.triangles = this.renderer.info.render.triangles;
    target.gpuMs = this.gpuTimer.milliseconds;
    target.gpuSequence = this.gpuTimer.sampleSequence;
  }
  /** Cheap opt-in review counters. Frame identity comes from the SAME presented
   * snapshot/camera used by audio, car lights, spray and replay presentation. */
  readReviewMetrics(target: ReviewFrame) {
    this.readPerformanceMetrics(target);
    const frame = this.presented.value,
      b = carBase(this.follow);
    target.physicsMs = frame[H.STEP_MS];
    target.time = frame[H.TIME];
    target.s = frame[b + F.S];
    target.laps = frame[b + F.LAPS];
    target.x = this.camera.position.x;
    target.y = this.camera.position.y;
    target.z = this.camera.position.z;
    target.qx = this.camera.quaternion.x;
    target.qy = this.camera.quaternion.y;
    target.qz = this.camera.quaternion.z;
    target.qw = this.camera.quaternion.w;
    target.fov = this.camera.fov;
    target.rig = this.mode === 'trackside' ? this.trackside.activeId : -1;
    target.exposure = this.renderer.toneMappingExposure;
    target.textures = this.renderer.info.memory.textures;
    target.geometries = this.renderer.info.memory.geometries;
    target.programs = this.renderer.info.programs?.length ?? 0;
    target.nearCars = target.midCars = target.farCars = 0;
    for (const car of this.cars) {
      if (!car.root.visible) continue;
      if (car.lodLevel === 0) target.nearCars++;
      else if (car.lodLevel === 1) target.midCars++;
      else target.farCars++;
    }
    target.rain = frame[H.RAIN];
    target.cloud = frame[H.CLOUD];
    target.water = frame[H.WATER];
    target.mirrors = this.reflection.mirrorUpdates;
    target.probes = this.reflection.probeUpdates;
    readRaceReviewFrame(frame, this.follow, 0, this.pitCrew.actorCountFor(this.follow), target);
    target.sprayParticles = this.effects.activeSprayCountFor(target.leader);
  }
  reviewCar() {
    return this.follow;
  }
  stats() {
    const info = this.renderer.info.render;
    const sorted = Array.from(this.frameSamples.subarray(0, this.sampleCount)).sort(
      (a, b) => a - b,
    );
    const slowCount = Math.ceil(sorted.length * 0.01);
    let slowTotal = 0;
    for (let i = sorted.length - slowCount; i < sorted.length; i++) slowTotal += sorted[i];
    return {
      authoredBodywork: this.heroShells?.diagnostics() ?? null,
      authoredDriver: this.driverAsset?.diagnostics() ?? null,
      // Bounded CPU summary; no texture readback or per-person geometry walk.
      pitPersonnel: this.pitCrew.summary(),
      crowdPersonnel: {
        ...PEOPLE_ASSET,
        clusters: this.circuit.crowdClusters.length,
        population: this.circuit.crowdClusters.reduce((n, c) => n + c.levels[0].count, 0),
        // LOD selections, not a claim that off-frustum instances were drawn.
        selectedByLevel: [0, 1, 2, 3].map((level) =>
          this.circuit.crowdClusters.reduce(
            (n, c) => n + (c.levels[level].visible ? c.levels[level].count : 0),
            0,
          ),
        ),
      },
      // Read-only presented state, not the newer live-worker frame during replay.
      pitState: {
        car: this.follow,
        time: this.presented.value[H.TIME],
        phase: this.presented.value[carBase(this.follow) + F.PIT_PHASE],
        clock: this.presented.value[carBase(this.follow) + F.PIT_CLOCK],
        speed: this.presented.value[carBase(this.follow) + F.SPEED],
        inPit: this.presented.value[carBase(this.follow) + F.IN_PIT],
        jackHeight: this.presented.value[carBase(this.follow) + F.JACK_HEIGHT],
        wheelOffsets: [0, 1, 2, 3].map((wheel) =>
          serviceWheelOffset(
            this.presented.value[carBase(this.follow) + F.PIT_PHASE],
            this.presented.value[carBase(this.follow) + F.PIT_CLOCK],
            this.presented.value[carBase(this.follow) + WHEEL_BASE + wheel * WHEEL_STRIDE + W.LOAD],
          ),
        ),
      },
      // CPU-only snapshot of the actual posed rig. Inspecting limb coupling must
      // not raycast the complete hero car or synchronously read mirror pixels.
      driverPose: {
        car: this.follow,
        time: this.presented.value[H.TIME],
        wheelRadians: this.cars[this.follow].steering.rotation.z,
        arms: this.cars[this.follow].driver.diagnostics(),
      },
      photo: this.photo ? { ...this.photo } : null,
      geometrySurvey: {
        count: this.geometrySurvey?.count ?? 0,
        candidates: this.geometrySurvey?.candidates ?? 0,
        active: !!this.photo && this.photo.survey !== 'off',
        source: 'rendered geometry; not LiDAR',
      },
      photoFocus: {
        enabled: this.photoFocus?.enabled ?? false,
        focus: this.photoFocus?.materialBokeh.uniforms.focus.value ?? null,
      },
      night: this.night,
      guide: this.guide.diagnostics(),
      gridPreparation: this.gridPreparation.diagnostics(),
      venueLighting: this.venueLighting.diagnostics(),
      environmentAssets: this.circuit.environmentDiagnostics(),
      playerPaint: this.cars[0]
        ? {
            primary: `#${this.cars[0].paint.color.getHexString()}`,
            accent: `#${this.cars[0].accent.color.getHexString()}`,
            flankSizes: this.cars[0].reflectivePaint
              .filter((m) => m.map && m.userData.liverySide !== undefined)
              .map((m) => {
                const image = m.map!.image as HTMLCanvasElement;
                const pixel = image.getContext('2d')?.getImageData(0, 0, 1, 1).data;
                return {
                  width: image.width,
                  height: image.height,
                  corner: pixel ? Array.from(pixel) : [],
                };
              }),
          }
        : null,
      warmupFrames: this.warmupFrames,
      graphics: { ...this.graphics },
      renderWidth: this.renderWidth,
      renderHeight: this.renderHeight,
      construction: { ...this.circuit.construction.statistics },
      carLods: this.cars.map((car) => car.lodLevel),
      camera: this.renderedMode,
      requestedCamera: this.mode,
      presentedCamera: this.renderedMode,
      tracksideRig: this.trackside.activeId,
      tracksideCuts: this.trackside.cuts,
      broadcastOccluded: this.trackside.occluded,
      broadcastVisibilityCuts: this.trackside.visibilityCuts,
      broadcastSolidOccluders: this.circuit.sightlines.count,
      broadcastSubjectRadius: this.trackside.subjectRadius,
      broadcastFramingFits: this.trackside.framingFits,
      broadcastVisibleSubjectSamples: this.trackside.subjectVisibleSamples,
      broadcastSubjectSampleCount: this.trackside.subjectSampleCount,
      broadcastSubjectWithinRange: this.trackside.subjectWithinRange,
      cameraLocalPosition: this.eyeLocal.toArray(),
      mirrorUpdates: this.reflection.mirrorUpdates,
      mirrorWidth: this.reflection.mirrorWidth,
      reflectionProbeUpdates: this.reflection.probeUpdates,
      skyEnvironmentUpdates: this.environment.captures,
      lighting: this.lighting,
      vegetationTrees: this.circuit.vegetationGroup.userData.treeCount,
      trackInfrastructure: {
        drains: this.circuit.trackInfrastructure.drains.length,
        marshalPosts: this.circuit.trackInfrastructure.marshalPosts.length,
        utilities: this.circuit.trackInfrastructure.utilities.length,
        cameras: this.circuit.trackInfrastructure.cameras.length,
      },
      localProbeActive: this.reflection.localProbeActive,
      motionBlur: this.motionBlur.diagnostics(),
      automaticExposure: this.exposure.diagnostics(),
      localAtmosphere: this.atmosphere.diagnostics(),
      weatherPresentation: this.weatherPresentation.diagnostics(),
      raceComposition: this.composition.diagnostics(),
      gpuFrameQueue: this.gpuFrames.diagnostics(),
      gpuMilliseconds: this.gpuTimer.milliseconds,
      gpuTimerSupported: this.gpuTimer.supported,
      fps: this.fps,
      frameMs: this.frameMs,
      p1FPS: slowTotal ? (1000 * slowCount) / slowTotal : 0,
      renderCPUms: this.renderMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      textures: this.renderer.info.memory.textures,
      geometries: this.renderer.info.memory.geometries,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.heroShells?.dispose();
    this.driverAsset?.dispose();
    this.pitCrew.dispose();
    this.reflection.dispose();
    this.gpuTimer.dispose();
    this.gpuFrames.dispose();
    this.motionBlur.dispose();
    this.exposure.dispose();
    this.weatherPresentation.dispose();
    this.photoFocus?.dispose();
    this.geometrySurvey?.dispose();
    this.bloom.dispose();
    this.fxaa.dispose();
    this.textures.dispose();
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    const skeletons = new Set<T.Skeleton>();
    this.scene.traverse((o) => {
      if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
      // Instance attributes are owned by the object, not its shared geometry.
      // Release them before disposing the renderer's WebGL bookkeeping.
      if (o instanceof T.InstancedMesh) o.dispose();
      if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.Line) {
        geometries.add(o.geometry);
        if (o instanceof T.Mesh) {
          if (o.customDepthMaterial) materials.add(o.customDepthMaterial);
          if (o.customDistanceMaterial) materials.add(o.customDistanceMaterial);
        }
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
        }
      }
    });
    for (const skeleton of skeletons) skeleton.dispose();
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    this.circuit.stateTexture.dispose();
    this.environment.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
