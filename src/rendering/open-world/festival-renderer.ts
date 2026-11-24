import { CropFields } from './crop-fields.ts';
import { FARM_FIELDS } from '../../simulation/open-world/farm-fields.ts';
import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AudioViewTracker } from '../../audio/spatial.ts';
import { clamp } from '../../core/math.ts';
import type { FestivalEvent } from '../../simulation/open-world/festival-events.ts';
import { footwayHeight, townFootways } from '../../simulation/open-world/town-footways.ts';
import { carvedGroundHeight } from '../../simulation/open-world/ground-height.ts';
import type { Structure } from '../../simulation/open-world/placement.ts';
import type { OpenWorld } from '../../simulation/open-world/world.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../simulation/protocol.ts';
import { MATERIAL } from '../../simulation/surface-material.ts';
import { BroadcastGradePass } from '../broadcast-grade.ts';
import {
  bindSkyCelestial,
  circuitLightState,
  configureSky,
  lightingDirection,
  shadowAnchor,
  skyFogPalette,
  SkyEnvironment,
  type LightingMode,
} from '../daylight.ts';
import { PresentedFrame } from '../frame-state.ts';
import { LensBloomPass } from '../lens-bloom.ts';
import { applyCircuitLightPalette } from '../lighting-coherence.ts';
import {
  bufferSize,
  detailTier,
  graphicsPreset,
  validateGraphics,
  type GraphicsOptions,
  type QualityPreset,
} from '../options.ts';
import type { SceneAmbientPass } from '../scene-ambient-pass.ts';
import { prewarmSky } from '../sky-light.ts';
import { compileSceneTarget } from '../preparation.ts';
import { prepareMaterials } from '../materials/library.ts';
import { postLensFrame } from '../studio/lens-effects.ts';
import { SKY_CLOUDS, SkyClouds } from '../studio/sky-clouds.ts';
import { UltraPipeline } from '../ultra/pipeline.ts';
import { PhotoSky } from '../assets/photo-sky.ts';
import { scannedGround } from '../ground/scan-store.ts';
import { FESTIVAL_PALETTE } from '../assets/sky-catalogue.ts';
import { aerialFogColor } from '../studio/aerial-perspective.ts';
import { WetRoadReflection } from '../wet-reflection.ts';
import { Buildings } from './buildings.ts';
import { FestivalCars } from './festival-cars.ts';
import { InertialCamera } from '../camera-dynamics.ts';
import { cabinEye, cabinFov, mountEye, mountFov } from '../vehicle-bodies/cabin.ts';
import { carLod } from '../lod.ts';
import { feedDetailDistance } from '../view-detail.ts';
import { EventMarkers } from './markers.ts';
import { RoadMeshes } from './roads.ts';
import { TERRAIN_BUDGETS, TerrainStreamer } from './terrain.ts';
import { Vegetation } from './vegetation.ts';
import { photoVegetationEnabled, VegetationLibrary } from '../vegetation/library.ts';
import { speciesForPalette } from '../vegetation/species.ts';
import { Water } from './water.ts';
import { festivalRoadDetail } from './festival-road-surface.ts';
import { Effects } from '../effects.ts';
import { EffectPlayback } from '../effect-playback.ts';
import { ReflectionSystem } from '../reflections.ts';
import {
  iblUniforms,
  installSpecularIBL,
  installSpecularIBLMaterial,
  setIblEnergy,
} from '../studio/ibl-energy.ts';
import { StreetLightPools } from './street-light-pools.ts';
import { FestivalPracticalLights } from './festival-practical-lights.ts';
import { surfaceDampness } from '../weather-presentation.ts';
import { SolvaneDetails } from './solvane-details.ts';
import { StreetDetails } from './street-details.ts';
import { FestivalContactShadows } from './contact-shadows.ts';
import { FestivalCameraClearance } from './camera-clearance.ts';
import { FestivalChaseDynamics, advanceChaseSpring } from './chase-dynamics.ts';
import { driftFeedback, type DriftCue } from '../../simulation/open-world/drift-feedback.ts';
import { HorizonGuidance } from './horizon-guidance.ts';
import { FestivalTrails } from './festival-trails.ts';
import { HorizonDressing } from './horizon-dressing.ts';
import {
  adjustDaylight,
  bindWeatherAtmosphere,
  newWeatherAtmosphere,
  tintLights,
  weatherAtmosphere,
} from '../weather-atmosphere.ts';
import { FestivalAtmosphere } from './festival-atmosphere.ts';
import { FestivalFramePipeline } from './festival-frame-pipeline.ts';
import { FestivalShadows } from './festival-shadows.ts';
import {
  createFestivalContactOffset,
  festivalContactEnabled,
  festivalDiffuserEnabled,
} from './festival-contacts.ts';

export type FestivalCamera = 'chase' | 'far' | 'hood' | 'cockpit';
const NO_MIRRORS: readonly T.Mesh[] = [];
const CAMERAS: readonly FestivalCamera[] = ['chase', 'far', 'hood', 'cockpit'];
/** Chase rigs (m): distance behind, height, look-ahead, look lift, fov. */
const RIGS = {
  chase: { distance: 5.8, height: 1.85, perMs: 0.018, lookAhead: 9, lift: 0.82, fov: 57 },
  far: { distance: 11, height: 3.6, perMs: 0.03, lookAhead: 10, lift: 1.1, fov: 58 },
} as const;

/**
 * Renderer of the festival region. It shares the application's WebGL
 * context (the circuit renderer stays loaded but idle) and reuses the
 * production lighting and image chain: the physical sky dome with baked
 * clouds and its PMREM environment (daylight.ts), the circuit light palette,
 * sun shadows anchored in light space, the multisampled ambient scene pass,
 * lens bloom, output transform, FXAA and the broadcast grade, and the ULTRA
 * modules (TAA+CAS, SSR, temporal GTAO, sun shafts, AgX/Neutral) where the
 * preset and device enable them. The world is streamed terrain, the road
 * network meshes, procedural buildings, instanced vegetation, sea and river
 * and the event markers.
 */
export class FestivalRenderer {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(60, 1, 0.3, 26000);
  readonly terrain: TerrainStreamer;
  readonly roads: RoadMeshes;
  readonly streetLights: StreetLightPools;
  readonly practicalLights: FestivalPracticalLights;
  readonly buildings: Buildings;
  readonly dressing: HorizonDressing;
  readonly crops: CropFields;
  readonly atmosphere: FestivalAtmosphere;
  details: SolvaneDetails | null = null;
  private detailLoading: Promise<boolean> | null = null;
  streetDetails: StreetDetails | null = null;
  private streetLoading: Promise<boolean> | null = null;
  readonly contacts = new FestivalContactShadows();
  private readonly cameraAnchor = new T.Vector3();
  private readonly cameraClearance: FestivalCameraClearance;
  private readonly weatherAir = newWeatherAtmosphere();
  readonly chaseDynamics = new FestivalChaseDynamics();
  driftCue: DriftCue | null = null;
  readonly vegetation = new Vegetation();
  /** Photographic trees and shrubs, when loaded (see loadPhotoVegetation). */
  photoVegetation: VegetationLibrary | null = null;
  private photoLoading: Promise<boolean> | null = null;
  readonly water: Water;
  readonly markers: EventMarkers;
  readonly cars = new FestivalCars();
  readonly effects = new Effects();
  private readonly effectPlayback = new EffectPlayback(this.effects);
  readonly guidance = new HorizonGuidance();
  readonly trails = new FestivalTrails();
  private readonly reflection = new ReflectionSystem();
  private readonly reflectionMaterials: T.MeshStandardMaterial[] = [];
  private mirrorSurfaces = NO_MIRRORS;
  private reflectionVersion = -1;
  private readonly vehicleRoots: T.Object3D[] = [];
  private readonly vehiclePaint: T.MeshStandardMaterial[] = [];
  private vehiclePaintVersion = 0;
  private reflectedVehicleVersion = -1;
  private readonly events: ReadonlyMap<string, FestivalEvent>;
  private readonly orbit: OrbitControls;
  private photoAnchor: 'car' | 'world' = 'car';
  photo = false;
  readonly audioView = new AudioViewTracker();
  readonly presented = new PresentedFrame();
  readonly sun = new T.DirectionalLight(0xfff0dc, 3.9);
  private readonly hemisphere = new T.HemisphereLight(0x8fb6ea, 0x4a4237, 0.14);
  private readonly sky = new Sky();
  private readonly environment: SkyEnvironment;
  /** Photographed CC0 sky of the region (assets/photo-sky.ts). */
  readonly photoSky = new PhotoSky(FESTIVAL_PALETTE, true);
  private readonly composer: EffectComposer;
  private readonly scenePass: SceneAmbientPass;
  private readonly imagePipeline: FestivalFramePipeline;
  private readonly bloom = new LensBloomPass();
  private readonly grade = new BroadcastGradePass();
  private readonly fxaa = new ShaderPass(FXAAShader);
  readonly ultra: UltraPipeline;
  private readonly shadows: FestivalShadows;
  private readonly wet = new WetRoadReflection();
  graphics: GraphicsOptions = graphicsPreset('medium');
  preset: QualityPreset = 'medium';
  lighting: LightingMode = 'day';
  mode: FestivalCamera = 'chase';
  reducedMotion = false;
  shake = 0.35;
  private readonly seatMotion = new InertialCamera();
  lookX = 0;
  private lookY = 0;
  private readonly target = new T.Vector3();
  private readonly desired = new T.Vector3();
  private readonly gaze = new T.Vector3();
  private readonly velocity = new T.Vector3();
  private readonly forward = new T.Vector3();
  private readonly temp = new T.Vector3();
  private readonly basis = new T.Quaternion();
  private readonly euler = new T.Euler();
  private initialized = false;
  private lastTime = NaN;
  private readonly lastSubject = new T.Vector3(NaN, NaN, NaN);
  private lastVehicle = -1;
  private disposed = false;
  private readonly heightAt = (x: number, z: number, y?: number) => this.groundHeight(x, z, y);
  readonly discovered = new Set<string>();
  activeEvent: string | null = null;
  gate: { x: number; z: number } | null = null;
  stats = { drawCalls: 0, triangles: 0, renderMs: 0 };
  constructor(
    readonly renderer: T.WebGLRenderer,
    readonly canvas: HTMLCanvasElement,
    readonly world: OpenWorld,
    events: readonly FestivalEvent[],
    readonly structures: readonly Structure[],
    tileWorker: Worker,
  ) {
    const scene = this.scene;
    this.cameraClearance = new FestivalCameraClearance(structures);
    this.events = new Map(events.map((event) => [event.spec.id, event]));
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.minDistance = 2.5;
    this.orbit.maxDistance = 22;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.enablePan = false;
    this.reflection.probeFacesPerFrame = 1;
    this.reflection.probeExclusions = [
      this.cars.root,
      this.effects.group,
      this.guidance.root,
      this.trails.root,
      this.contacts.root,
    ];
    this.effects.looseColours = new Map([
      [MATERIAL.DIRT, [0.43, 0.32, 0.19] as const],
      [MATERIAL.MUD, [0.23, 0.19, 0.14] as const],
      [MATERIAL.SAND, [0.69, 0.59, 0.4] as const],
      [MATERIAL.SNOW, [0.81, 0.85, 0.89] as const],
      [MATERIAL.GRAVEL_ROAD, [0.51, 0.47, 0.39] as const],
    ]);
    this.effects.contactOffset = createFestivalContactOffset(this.heightAt);
    this.effects.contactEnabled = festivalContactEnabled;
    this.effects.diffuserEnabled = festivalDiffuserEnabled;
    this.effects.setDryCloudDetail(true);
    scene.name = 'Festival region';
    this.sky.scale.setScalar(450000);
    this.sky.userData.excludeMotionBlur = true;
    configureSky(this.sky);
    const clouds = SkyClouds.forSky(this.sky.material, lightingDirection);
    this.photoSky.setQuality(this.preset, true);
    this.environment = new SkyEnvironment(this.sky, clouds, this.photoSky, true);
    scene.add(this.sky);
    scene.environmentIntensity = 0.7;
    scene.fog = new T.FogExp2(0xb9c7c1, 0.00012);
    scene.add(this.hemisphere, this.sun, this.sun.target);
    this.shadows = new FestivalShadows(renderer, scene, this.sun);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -70,
      right: 70,
      top: 70,
      bottom: -70,
      near: 20,
      far: 900,
    });
    this.sun.shadow.bias = -0.00003;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.terrain = new TerrainStreamer(tileWorker, TERRAIN_BUDGETS.medium);
    this.terrain.material.userData.ow.owCultivated.value = Number(world.region.id === 'solvane');
    this.crops = new CropFields((x, z) => this.terrain.exactHeight(x, z), world.region.id === 'solvane' ? FARM_FIELDS : []);
    this.roads = new RoadMeshes(world.network, world.field);
    this.streetLights = new StreetLightPools(this.roads.lampSockets);
    scene.add(this.streetLights.root);
    this.buildings = new Buildings(structures, world.network);
    this.dressing = new HorizonDressing(world, structures);
    this.practicalLights = new FestivalPracticalLights(this.dressing.lightSockets);
    scene.add(this.practicalLights.root);
    this.water = new Water(world.field);
    this.atmosphere = new FestivalAtmosphere(world.field.region.seaLevel);
    this.markers = new EventMarkers(events, this.heightAt);
    this.reflection.mirrorExclusions = [this.guidance.root, this.markers.root, this.contacts.root];
    this.reflection.mirrorDetail = {
      before: (camera, height) => {
        this.cars.bodies.showFeedDetail((position, previous) =>
          carLod(
            feedDetailDistance(
              position.distanceTo(camera.position), camera.fov, camera.aspect, height,
              Math.max(1, this.renderer.domElement.height),
            ),
            previous, detailTier(this.preset), false,
          ),
        );
      },
      after: () => this.cars.bodies.restoreFeedDetail(),
    };
    this.reflection.probeExclusions.push(this.markers.root);
    scene.add(
      this.terrain.root,
      this.roads.root,
      this.buildings.root,
      this.dressing.root,
      this.crops.root,
      this.vegetation.root,
      this.water.root,
      this.markers.root,
      this.cars.root,
      this.effects.group,
      this.guidance.root,
      this.trails.root,
      this.contacts.root,
    );
    installSpecularIBL(scene);
    installSpecularIBLMaterial(this.terrain.material);
    // These materials belong to this region. Catalogue cars use shared
    // materials, and navigation emissives retain their own presentation.
    this.atmosphere.installMaterial(this.terrain.material);
    this.terrain.material.userData.ow.owSeaLevel.value = world.field.region.seaLevel;
    for (const root of [this.roads.root, this.buildings.root, this.water.root])
      this.atmosphere.install(root);
    this.atmosphere.watch(this.dressing.root);
    this.atmosphere.installMaterial(this.crops.material);
    this.atmosphere.watch(this.vegetation.root);
    this.composer = new EffectComposer(renderer);
    this.imagePipeline = new FestivalFramePipeline(
      renderer,
      this.camera,
      this.sun,
      scene,
      this.composer,
      this.graphics,
    );
    this.scenePass = this.imagePipeline.scenePass;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.grade);
    this.ultra = new UltraPipeline({
      renderer,
      scene,
      camera: this.camera,
      composer: this.composer,
      scenePass: this.scenePass,
      bloom: this.bloom,
      grade: this.grade,
      sun: this.sun,
      farShadow: this.shadows.far,
      wetReflection: this.wet,
      roadMaterial: this.roads.materials.asphalt,
    });
    prewarmSky('day');
  }
  /** Separately posed motorcycles belong to the same reflection system,
   * and must not appear inside the probe taken at their own position. */
  registerVehicleRoot(root: T.Object3D) {
    if (this.vehicleRoots.includes(root)) return;
    this.vehicleRoots.push(root);
    this.reflection.probeExclusions.push(root);
    this.refreshVehicleMaterials();
  }
  refreshVehicleMaterials() {
    const unique = new Set<T.MeshStandardMaterial>();
    for (const root of this.vehicleRoots) {
      installSpecularIBL(root);
      root.traverse((object) => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          if (material instanceof T.MeshPhysicalMaterial && material.clearcoat > 0)
            unique.add(material);
      });
    }
    this.vehiclePaint.length = 0;
    this.vehiclePaint.push(...unique);
    this.vehiclePaintVersion++;
  }
  /** Keep road queries analytic on the requested height layer. Off-road
   * points and ground beneath bridges use the existing carved surface. */
  groundHeight(x: number, z: number, y?: number) {
    const net = this.world.network,
      p = {
        s: 0,
        x: 0,
        y: 0,
        z: 0,
        tx: 0,
        tz: 1,
        nx: 1,
        nz: 0,
        curvature: 0,
        width: 0,
        bank: 0,
        gradient: 0,
      };
    const l = net.nearest(x, z, p, y),
      e = net.edges[net.edgeOf[net.lastSegment]],
      reach = e.spec.halfWidth + e.spec.shoulder,
      layered = y !== undefined && Number.isFinite(y);
    // A height-matching segment can end far ahead of this point. Its
    // lateral offset alone does not establish a road footprint here.
    if (net.lastLayerMatch && Math.abs(l) < reach && (!layered || net.lastDistance < reach)) {
      const base = net.surfaceHeight(p, l, e.spec.halfWidth, e.spec.crown);
      const d = net.lastDistance - e.spec.halfWidth;
      if (e.roadClass === 'town' && d > 0) {
        const strength = townFootways(net).strength(e, net.lastSegment, net.lastT, l);
        return base + footwayHeight(d, strength);
      }
      return base;
    }
    return carvedGroundHeight(this.world.carver, x, z);
  }
  /** Load the photographic trees and shrubs (not on LOW); call before the
   * world streams so every tile is planted the same way. Failures keep the
   * procedural crowns. */
  loadPhotoVegetation(): Promise<boolean> {
    if (this.disposed || this.photoVegetation || !photoVegetationEnabled(this.preset))
      return Promise.resolve(false);
    if (this.photoLoading) return this.photoLoading;
    this.photoLoading = VegetationLibrary.load(
      this.renderer,
      speciesForPalette(FESTIVAL_PALETTE, true, true),
    )
      .then((library) => {
        if (this.disposed || !library.trees.length) {
          library.dispose();
          return false;
        }
        this.photoVegetation = library;
        this.dressing.usePhotoVegetation(library);
        // Trees never stand on roads: the natural ground alone (cheap per tile).
        this.vegetation.setPhotoLibrary(library, (x, z) => this.world.field.height(x, z));
        this.shadows.invalidate();
        this.streetLights.invalidate();
        this.reflection.sceneryChanged();
        return true;
      })
      .catch((error: unknown) => {
        if (!this.disposed) console.warn('Festival photographic vegetation unavailable:', error);
        return false;
      })
      .finally(() => {
        this.photoLoading = null;
      });
    return this.photoLoading;
  }
  loadAuthoredDetails(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.details) return Promise.resolve(true);
    if (this.detailLoading) return this.detailLoading;
    this.detailLoading = SolvaneDetails.load(this.world, this.structures, () => this.disposed)
      .then((kit) => {
        if (this.disposed) {
          kit.dispose();
          return false;
        }
        this.details = kit;
        this.atmosphere.install(kit.root);
        this.scene.add(kit.root);
        this.shadows.invalidate();
        this.streetLights.invalidate();
        this.reflection.sceneryChanged();
        this.reflection.probeExclusions.push(kit.aero);
        this.guidance.useFlagTemplate(kit.flagTemplate(this.preset === 'low'));
        if (kit.stats.boats === this.dressing.stats.boats) this.dressing.useAuthoredBoats();
        return true;
      })
      .catch((error: unknown) => {
        if (!this.disposed) console.warn('Festival authored detail fallback:', error);
        return false;
      })
      .finally(() => {
        this.detailLoading = null;
      });
    return this.detailLoading;
  }
  loadStreetDetails(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.streetDetails) return Promise.resolve(true);
    if (this.streetLoading) return this.streetLoading;
    this.streetLoading = StreetDetails.load(this.world, this.structures, () => this.disposed)
      .then((kit) => {
        // Closing the session can race the microtask after the loader resolves.
        if (this.disposed) {
          kit.dispose();
          return false;
        }
        this.streetDetails = kit;
        this.atmosphere.install(kit.root);
        this.scene.add(kit.root);
        this.shadows.invalidate();
        this.streetLights.invalidate();
        this.reflection.sceneryChanged();
        return true;
      })
      .catch((error: unknown) => {
        if (!this.disposed) console.warn('Festival street detail fallback:', error);
        return false;
      })
      .finally(() => {
        this.streetLoading = null;
      });
    return this.streetLoading;
  }
  setQuality(preset: QualityPreset, options: GraphicsOptions = graphicsPreset(preset)) {
    const flagTierChanged = (preset === 'low') !== (this.preset === 'low');
    this.preset = preset;
    if (this.details && flagTierChanged)
      this.guidance.useFlagTemplate(this.details.flagTemplate(preset === 'low'));
    this.graphics = this.ultra.deviceGraphics(validateGraphics(options, preset));
    const g = this.graphics,
      tier = detailTier(preset);
    this.renderer.shadowMap.enabled = g.shadowSize > 0;
    if (g.shadowSize > 0 && this.sun.shadow.mapSize.x !== g.shadowSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(g.shadowSize, g.shadowSize);
    }
    this.sun.castShadow = g.shadowSize > 0;
    this.shadows.configure(g.shadowSize);
    this.streetLights.configureShadows(
      preset,
      g.shadowSize > 0,
      this.renderer.capabilities.maxTextureSize,
    );
    this.reflection.quality(g.mirrorQuality);
    this.bloom.enabled = g.bloom;
    this.imagePipeline.configure(g);
    this.fxaa.enabled = g.antialias && this.scenePass.samples === 0;
    this.grade.enabled = g.filmGrade;
    this.effects.enabled = g.particleDensity > 0;
    this.effects.density = g.particleDensity;
    this.trails.enabled = preset !== 'low';
    const budget = TERRAIN_BUDGETS[tier];
    this.terrain.budget = { ...budget, trees: budget.trees * clamp(g.vegetationDensity, 0, 1) };
    this.environment.highDetail = g.reflections === 'local';
    this.water.setDetail(tier === 'high');
    festivalRoadDetail.value = tier === 'high' ? 1 : 0;
    this.terrain.material.userData.ow.owGrassDetail.value = tier === 'high' ? 1 : 0;
    this.photoSky.setQuality(preset, true);
    scannedGround.attach(this.renderer, preset);
    this.ultra.configure(preset, g);
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth,
      h = this.canvas.clientHeight || innerHeight;
    const size = bufferSize(
      w,
      h,
      Math.min(devicePixelRatio, 1.5) * this.graphics.resolutionScale,
      this.renderer.capabilities.maxTextureSize,
    );
    const ratio = Math.min(size.width / w, size.height / h);
    const current = this.renderer.getSize(new T.Vector2());
    if (current.x !== w || current.y !== h || this.renderer.getPixelRatio() !== ratio)
      this.renderer.setDrawingBufferSize(w, h, ratio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    const actual = this.renderer.getDrawingBufferSize(new T.Vector2());
    this.fxaa.uniforms.resolution.value.set(1 / actual.x, 1 / actual.y);
    this.imagePipeline.reset();
  }
  moveCockpitLook(dx: number, dy: number) {
    if (this.mode !== 'cockpit' || this.photo) return;
    this.lookX = clamp(this.lookX - dx * 0.002, -1.3, 1.3);
    this.lookY = clamp(this.lookY - dy * 0.002, -0.45, 0.6);
  }
  centreLook() {
    this.lookX = 0;
    this.lookY = 0;
  }
  changeCamera(mode?: FestivalCamera) {
    const next = mode ?? CAMERAS[(CAMERAS.indexOf(this.mode) + 1) % CAMERAS.length];
    this.mode = next === 'cockpit' && !this.cars.bodies.cabinOf(0) ? 'chase' : next;
    this.lookX = 0;
    this.lookY = 0;
    this.initialized = false;
    this.audioView.reset();
    this.imagePipeline.reset();
  }
  /** Pause is owned by FestivalSession. This only changes the presentation. */
  setPhoto(active: boolean, anchor: 'car' | 'world' = 'car') {
    if (active !== this.photo) this.imagePipeline.reset();
    this.photo = active;
    this.photoAnchor = anchor;
    this.orbit.enabled = active;
    if (active) {
      this.orbit.target.copy(this.target).add(new T.Vector3(0, 0.6, 0));
      this.camera.fov = 45;
      this.camera.updateProjectionMatrix();
      this.orbit.update();
    } else {
      this.initialized = false;
      this.audioView.reset();
    }
  }
  photoAngle(angle: number) {
    if (!this.photo) return;
    const offset = this.camera.position.clone().sub(this.orbit.target);
    offset.applyAxisAngle(new T.Vector3(0, 1, 0), angle);
    this.camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update();
  }
  /** Night amount of the current lighting (lamps, windows, headlights). */
  get night() {
    return this.lighting === 'night' ? 1 : this.lighting === 'sunset' ? 0.25 : 0;
  }
  /** Do, behind the loading screen, the GPU work the first draws would otherwise
   * do in front of the player: bake the procedural material maps, link the scene's
   * shader programs, then draw the real view twice so the shadow pass and the
   * post-processing chain build theirs too (the circuit does the same in
   * Renderer.prepare). Journey evidence (software GL, medium preset): with no
   * warm-up the first festival frames spent 59 s in getProgramInfoLog (program
   * links) and 26 s in a synchronous readRenderTargetPixels (the procedural bake)
   * inside 165 s of "frozen" world, after the loading screen had already gone; a
   * scene-only compile left 80 s of shadow/post-processing links for the first
   * frames (60 s in getShaderInfoLog). Nothing drawn changes. */
  async prepareGpu(
    frame: Float32Array,
    progress: (message: string) => void,
    cancelled: () => boolean,
    yieldFrame: () => Promise<void> = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  ) {
    const stopped = () => cancelled() || this.disposed;
    progress('Baking festival materials…');
    await yieldFrame();
    if (stopped()) return false;
    prepareMaterials(this.renderer);
    progress('Compiling the festival materials…');
    await yieldFrame();
    if (stopped()) return false;
    await compileSceneTarget(
      this.renderer,
      this.scene,
      this.camera,
      this.composer.readBuffer,
      undefined,
      { cancelled: stopped },
    );
    progress('Warming the festival view…');
    for (let i = 0; i < 2; i++) {
      await yieldFrame();
      if (stopped()) return false;
      this.draw(frame, frame, 1, 1 / 60);
    }
    return !stopped();
  }
  /** Is the terrain under (x, z) and the coarse cover resident? */
  ready(x: number, z: number) {
    return this.terrain.readyAround(x, z);
  }
  /** Stream terrain only (loading screen), without drawing. */
  prestream(x: number, z: number) {
    this.camera.position.set(x, this.groundHeight(x, z) + 3, z);
    this.camera.updateMatrixWorld();
    this.terrain.update(this.camera);
  }
  draw(a: Float32Array, b: Float32Array, alpha: number, dt: number) {
    if (this.disposed) return;
    const start = performance.now();
    dt = clamp(dt, 1 / 300, 0.08);
    if (a.length !== b.length || a[H.CARS] !== b[H.CARS] || b[H.TIME] < a[H.TIME]) a = b;
    const presented = this.presented.sample(a, b, a === b ? 1 : clamp(alpha, 0, 1));
    const time = presented[H.TIME];
    const night = this.night;
    const onboard = this.mode === 'hood' || this.mode === 'cockpit';
    this.cars.update(
      a,
      b,
      presented,
      a === b ? 1 : alpha,
      dt,
      night,
      this.camera,
      this.mode === 'cockpit' && !this.photo,
      detailTier(this.preset),
    );
    const o = carBase(0),
      subject = this.cars.subject(0);
    const speed = presented[o + F.SPEED];
    this.target.set(presented[o + F.X], presented[o + F.Y], presented[o + F.Z]);
    // --- Camera ---------------------------------------------------------
    const vehicle = Math.round(presented[o + RACE_BASE + R.VEHICLE]);
    const elapsed = time - this.lastTime;
    // A camera change or a slow GPU is not a simulation discontinuity.
    // Reject physical jumps while allowing normal distance covered in a stall.
    const discontinuity =
      vehicle !== this.lastVehicle ||
      !(elapsed >= 0) ||
      this.lastSubject.distanceTo(this.target) >
        Math.max(24, Math.abs(speed) * Math.max(0, elapsed) * 1.8 + 10);
    const cut = !this.initialized || discontinuity || elapsed > 1;
    this.lastVehicle = vehicle;
    this.lastTime = time;
    if (subject) this.forward.set(0, 0, 1).applyQuaternion(subject.quaternion);
    const bodyYaw = Math.atan2(this.forward.x, this.forward.z);
    const localLateral =
      presented[o + F.VX] * Math.cos(bodyYaw) - presented[o + F.VZ] * Math.sin(bodyYaw);
    const localForward =
      presented[o + F.VX] * Math.sin(bodyYaw) + presented[o + F.VZ] * Math.cos(bodyYaw);
    let grounded = false;
    for (let w = 0; w < 4; w++)
      grounded ||= presented[o + WHEEL_BASE + w * WHEEL_STRIDE + W.LOAD] > 40;
    this.driftCue = driftFeedback(localLateral, localForward, grounded);

    if (this.photo) {
      // The pause acknowledgement can arrive one or more snapshots after
      // the last painted car. Carry the eye and pivot over that same delta
      // before applying orbit input to keep the car framed at any draw rate.
      if (
        this.photoAnchor === 'car' &&
        Number.isFinite(this.lastSubject.x) &&
        !this.target.equals(this.lastSubject)
      ) {
        this.camera.position.sub(this.lastSubject).add(this.target);
        this.orbit.target.copy(this.target);
        this.orbit.target.y += 0.6;
      }
      this.orbit.update();
      // This orbit stays attached to the subject. Raising the camera under
      // a bridge must not switch its clearance surface to the upper deck.
      this.camera.position.y = Math.max(
        this.camera.position.y,
        this.groundHeight(this.camera.position.x, this.camera.position.z, this.target.y) + 0.45,
      );
      this.gaze.copy(this.orbit.target);
    } else if (onboard && subject) {
      const layout = this.cars.bodies.cabinOf(0)?.layout;
      if (this.mode === 'cockpit' && !layout) this.changeCamera('hood');
      const mount = this.mode === 'cockpit' ? layout?.cockpit : layout?.mount;
      if (cut || this.reducedMotion || this.shake <= 0) this.seatMotion.reset();
      if (!this.reducedMotion && this.shake > 0) {
        this.seatMotion.step(
          cut ? 0 : Math.max(0, elapsed),
          presented[o + F.G_LAT], presented[o + F.G_LONG], presented[o + F.G_VERT],
          presented[o + F.IMPACT], this.shake,
        );
      }
      if (layout && this.mode === 'cockpit') cabinEye(layout, this.seatMotion.offset, this.desired);
      else if (layout) mountEye(layout, this.seatMotion.offset, this.desired);
      else this.desired.set(0, 1.18, 0.35);
      this.desired.applyQuaternion(subject.quaternion).add(this.target);
      const pitch = mount?.pitch ?? Math.atan2(0.6, 30);
      this.temp
        .set(Math.sin(this.lookX), Math.tan(pitch + this.lookY), Math.cos(this.lookX))
        .applyQuaternion(subject.quaternion);
      this.gaze.copy(this.desired).add(this.temp);
      this.camera.position.copy(this.desired);
      this.camera.fov = layout
        ? this.mode === 'cockpit' ? cabinFov(layout, this.graphics.cockpitFov) : mountFov(layout, speed)
        : 66;
      this.velocity.set(0, 0, 0);
    } else {
      const rig = RIGS[this.mode === 'far' ? 'far' : 'chase'];
      const pitch = Math.asin(clamp(this.forward.y, -0.4, 0.4));
      const motion = this.chaseDynamics.update(
        {
          speed,
          forward: localForward,
          lateral: localLateral,
          yawRate: presented[o + F.WY],
          longitudinalG: presented[o + F.G_LONG],
        },
        Math.max(0, Math.min(elapsed, dt)),
        cut,
      );
      const yaw = bodyYaw + motion.yaw;
      this.basis.setFromEuler(this.euler.set(-pitch, yaw + this.lookX, 0, 'YXZ'));
      this.desired
        .set(
          0,
          rig.height + Math.min(0.6, Math.abs(speed) * 0.005) + motion.height,
          -rig.distance - Math.abs(speed) * rig.perMs - motion.distance,
        )
        .applyQuaternion(this.basis)
        .add(this.target);
      this.cameraAnchor.copy(this.target);
      this.cameraAnchor.y += 0.9;
      // Never below the ground (hills behind the car).
      const ground = this.groundHeight(this.desired.x, this.desired.z, this.target.y) + 0.8;
      if (this.desired.y < ground) this.desired.y = ground;
      this.cameraClearance.constrain(this.cameraAnchor, this.desired, this.desired);
      this.temp
        .set(Math.sin(motion.lookYaw), 0, Math.cos(motion.lookYaw))
        .applyQuaternion(this.basis);
      this.gaze.copy(this.target).addScaledVector(this.temp, rig.lookAhead + motion.lookAhead);
      this.gaze.y += rig.lift;
      const fov = rig.fov + motion.fov;
      this.camera.fov += (fov - this.camera.fov) * (cut ? 1 : 1 - Math.exp(-dt * 4));
      if (cut) {
        this.camera.position.copy(this.desired);
        this.velocity.set(0, 0, 0);
      } else {
        this.temp.subVectors(this.target, this.lastSubject);
        advanceChaseSpring(this.camera.position, this.velocity, this.desired, 9, dt, this.temp);
        const floor =
          this.groundHeight(this.camera.position.x, this.camera.position.z, this.target.y) + 0.8;
        if (this.camera.position.y < floor) {
          this.camera.position.y = floor;
          this.velocity.y = Math.max(0, this.velocity.y);
        }
      }
    }
    if (!this.photo && !onboard) {
      if (
        this.cameraClearance.constrain(
          this.cameraAnchor,
          this.camera.position,
          this.camera.position,
        )
      )
        this.velocity.set(0, 0, 0);
    }
    this.lastSubject.copy(this.target);
    this.initialized = true;
    // The steering rim, dashboard and windscreen surround can sit closer
    // than the outside camera's 30 cm clipping plane.
    this.camera.near = this.mode === 'cockpit' && !this.photo ? 0.045 : 0.3;
    this.camera.up.set(0, 1, 0);
    if (onboard && subject && !this.photo) this.camera.up.applyQuaternion(subject.quaternion);
    this.camera.lookAt(this.gaze);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // --- World streaming and dressing -------------------------------------
    this.terrain.update(this.camera, time);
    this.crops.update(this.camera, this.preset, this.reducedMotion ? 0 : time, subject?.position ?? null);
    this.buildings.update(this.camera, this.preset, this.renderer.domElement.height);
    if (this.terrain.treesChanged) {
      this.terrain.treesChanged = false;
      this.vegetation.sync(this.terrain.treeTiles);
    }
    this.vegetation.update(this.camera, this.preset);
    this.markers.update(time, this.discovered, this.activeEvent, this.gate, this.heightAt, this.camera.position);
    this.markers.root.visible = !this.photo;
    if (discontinuity) this.guidance.reset();
    this.guidance.update(
      this.activeEvent ? (this.events.get(this.activeEvent) ?? null) : null,
      this.gate,
      this.target,
      speed,
      this.heightAt,
      surfaceDampness(presented[H.RAIN], presented[H.WATER]),
    );
    if (this.photo) this.guidance.root.visible = false;
    if (discontinuity) {
      this.effectPlayback.reset();
      this.practicalLights.reset();
      this.streetLights.invalidate();
    }
    this.effectPlayback.update(presented, true, true);
    this.effects.setSignalLights(presented, true);
    this.trails.update(presented, this.heightAt);
    this.roads.setNight(night, this.camera.position, this.preset);
    this.buildings.setNight(night, time, this.camera.position);
    this.dressing.update(time, night, this.camera, this.preset);
    this.details?.update(
      time,
      night,
      this.camera,
      this.preset,
      surfaceDampness(presented[H.RAIN], presented[H.WATER]),
    );
    this.streetDetails?.update(
      this.camera,
      this.preset,
      surfaceDampness(presented[H.RAIN], presented[H.WATER]),
    );
    this.contacts.update(presented, this.camera, this.preset, this.heightAt);
    this.streetLights.update(this.camera, night, this.preset, dt);
    this.practicalLights.update(this.camera, night, this.preset, dt);
    if (this.details?.poseAero(presented, subject ?? null, dt, this.camera))
      this.cars.bodies.hideRearWing(0);
    // --- Lighting -----------------------------------------------------------
    const mode = this.lighting,
      daylight = circuitLightState(presented[H.CLOUD], presented[H.RAIN], mode);
    if (mode === 'night') {
      // Local town fixtures now illuminate the road. Keep a modest diffuse
      // floor for rural sections outside those bounded pools so the unlit
      // rear and roadside architecture retain shape without clipping lamps.
      daylight.sun = 0.28 * (1 - daylight.cover * 0.35);
      daylight.fill = 1.0 + daylight.cover * 0.15;
      daylight.environment = 0.2 + daylight.cover * 0.04;
      daylight.exposure = 1.12 - clamp(presented[H.RAIN], 0, 60) * 0.0005;
    }
    const photoPalette = mode === 'night' ? null : this.photoSky.fogPalette(daylight.cover, mode);
    if (photoPalette)
      [daylight.fogRed, daylight.fogGreen, daylight.fogBlue] = aerialFogColor(
        daylight.cover,
        presented[H.RAIN],
        mode,
        photoPalette,
      );
    // Fog, dust and thunderstorm (weather-atmosphere.ts); clear air is a no-op.
    const air = weatherAtmosphere(presented, this.weatherAir);
    adjustDaylight(daylight, air, mode === 'night', mode === 'sunset');
    if (mode === 'sunset') {
      // After the sun disappears behind a wet cloud deck, diffuse skylight
      // is still incident across the valley. Lift the shadow side of cars and
      // banks independently of the visible sky and the headlamp highlights.
      const deck = T.MathUtils.smoothstep(daylight.cover, 0.36, 0.94);
      daylight.fill += 0.48 * deck;
      daylight.exposure *= 1 + 0.19 * deck;
    }
    applyCircuitLightPalette(this.sun, this.hemisphere, daylight.cover, mode);
    tintLights(this.sun, this.hemisphere, air);
    this.sun.intensity = daylight.sun;
    this.hemisphere.intensity = daylight.fill;
    this.scene.environmentIntensity = daylight.environment;
    // Festival may follow any circuit lighting state in the shared renderer.
    // Set its own sky energy every frame instead of inheriting that state.
    setIblEnergy(daylight.environment, mode);
    const saturation = this.photoSky.irradianceSaturation(
      daylight.cover,
      mode,
      iblUniforms.apexSkyIrradianceSaturation.value,
    );
    if (saturation !== null) iblUniforms.apexSkyIrradianceSaturation.value = saturation;
    const fog = this.scene.fog as T.FogExp2;
    // Stock fog remains the fallback for unlit signs/particles. World-owned
    // materials use the sky's extinction with the region's valley falloff.
    fog.density = daylight.fogDensity * 0.3;
    fog.color.setRGB(daylight.fogRed, daylight.fogGreen, daylight.fogBlue);
    this.atmosphere.update(
      daylight.haze,
      daylight.cover,
      presented[H.RAIN],
      mode,
      photoPalette ?? skyFogPalette(daylight.cover, mode),
    );
    bindWeatherAtmosphere(air, {
      haze: daylight.haze,
      studio: false,
      fog,
      sky: this.sky.material,
      aerial: this.atmosphere.uniforms,
      baseScaleHeight: 1 / this.atmosphere.uniforms.apexAerialFalloff.value.y,
    });
    const uniforms = this.sky.material.uniforms;
    uniforms.cloudCover.value = daylight.cover;
    uniforms.skyRadiance.value = daylight.skyRadiance;
    uniforms.nightAmount.value = mode === 'night' ? 1 : 0;
    uniforms.sunsetAmount.value = mode === 'sunset' ? 1 : 0;
    uniforms.sunPosition.value.copy(lightingDirection(mode));
    bindSkyCelestial(this.sky.material, mode);
    this.photoSky.bind(this.sky.material, daylight.cover, mode, false);
    uniforms.cloudDrift.value = (time * SKY_CLOUDS.driftPerSecond) % 1;
    shadowAnchor(
      this.target,
      this.sun.shadow.mapSize.x,
      this.sun.shadow.camera.right,
      this.sun.target.position,
      mode,
    );
    this.sun.position
      .copy(this.sun.target.position)
      .add(this.temp.copy(lightingDirection(mode)).normalize().multiplyScalar(400));
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    const wet = clamp(presented[H.WATER] / 0.8, 0, 1);
    this.roads.setWet(wet);
    this.terrain.material.userData.ow.owWet.value = wet;
    this.imagePipeline.prepare(
      presented,
      this.graphics,
      mode,
      this.mode,
      vehicle,
      this.photo,
      cut,
      daylight.exposure,
      this.reducedMotion,
    );
    // --- Render ---------------------------------------------------------------
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    this.shadows.update({
      subject: this.target,
      lighting: mode,
      terrainRevision: this.terrain.shadowRevision,
      dt,
      terrain: this.terrain.root,
      planting: [this.vegetation.root],
      hidden: this.reflection.probeExclusions,
    });
    this.environment.update(this.renderer, this.scene, daylight.cover, mode);
    if (
      this.reflectionVersion !== this.cars.paintVersion ||
      this.reflectedVehicleVersion !== this.vehiclePaintVersion
    ) {
      this.reflection.updateProbe(
        this.renderer,
        this.scene,
        subject ?? this.cars.root,
        this.reflectionMaterials,
        false,
      );
      this.reflection.invalidate();
      this.reflectionMaterials.length = 0;
      for (const material of this.cars.reflectivePaint)
        if (material instanceof T.MeshStandardMaterial) this.reflectionMaterials.push(material);
      this.reflectionMaterials.push(...this.vehiclePaint);
      for (const surface of ['asphalt', 'asphaltMajor', 'town'] as const) {
        const material = this.roads.materials[surface];
        if (material instanceof T.MeshStandardMaterial) this.reflectionMaterials.push(material);
      }
      this.reflectionVersion = this.cars.paintVersion;
      this.reflectedVehicleVersion = this.vehiclePaintVersion;
    }
    this.updateLocalReflection(subject, time, cut ? 0 : Math.max(0, elapsed), wet, daylight.environment, discontinuity);
    this.audioView.update(this.camera, time, 0, onboard, 0);
    postLensFrame(
      this.grade,
      this.bloom,
      presented,
      mode,
      this.graphics.lensEffects && !this.photo,
      this.camera,
      onboard ? 'cockpit' : 'chase',
      speed,
    );
    this.ultra.prepareFrame({
      presented,
      cars: [
        { reflectivePaint: this.cars.reflectivePaint },
        { reflectivePaint: this.vehiclePaint },
      ],
      subject: this.target,
      cameraMode: onboard ? 'cockpit' : 'chase',
      lighting: mode,
      studio: false,
      menu: false,
      photo: this.photo,
      replay: false,
      otherDof: false,
      cut,
    });
    this.streetLights.renderWithShadows(this.renderer, time, this.terrain.shadowRevision, () => {
      // Close-up photography retains the detailed vehicle shadow. Ordinary
      // driving uses the live wheel/axle silhouette in the same light map.
      if (this.photo) this.composer.render();
      else
        this.cars.drawWithVehicleShadows(this.renderer, this.scene, () => this.composer.render());
    });
    this.ultra.afterFrame();
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.renderMs = this.stats.renderMs * 0.9 + (performance.now() - start) * 0.1;
  }
  private updateLocalReflection(
    subject: T.Object3D | null,
    time: number,
    elapsed: number,
    wet: number,
    environmentIntensity: number,
    discontinuity: boolean,
  ) {
    // Fast travel and recovery can replace the view at the same simulation instant.
    if (discontinuity) this.reflection.invalidate();
    const mirrors = this.mode === 'cockpit' && !this.photo ? this.cars.bodies.mirrorsFor(0) : null;
    const surfaces = mirrors?.cockpitSurfaces ?? NO_MIRRORS;
    if (surfaces !== this.mirrorSurfaces) {
      this.reflection.attachMirrors(surfaces);
      this.mirrorSurfaces = surfaces;
    }
    this.reflection.beginFrame(time, !!mirrors, !this.photo);
    this.reflection.setSceneryRevision(this.terrain.shadowRevision);
    this.reflection.setSkyIntensity(
      this.reflectionMaterials,
      environmentIntensity,
      iblUniforms.apexSpecularIBL.value,
    );
    if (subject)
      this.reflection.updateProbe(
        this.renderer,
        this.scene,
        subject,
        this.reflectionMaterials,
        this.graphics.reflections === 'local',
        wet > 0.15 ? 0.8 : 2,
        this.sky.material.uniforms.probeSkyIntensity,
      );
    if (mirrors)
      this.reflection.renderMirrors(this.renderer, this.scene, mirrors.root, elapsed, this.camera.position);
  }
  /** Explicit review capture, including a small readback of each live optical feed. */
  mirrorReadback() {
    return this.reflection.diagnostics(this.renderer);
  }
  /** Snapshot length check for the session controller. */
  static frameLength(cars: number) {
    return HEADER + cars * CAR_STRIDE;
  }
  diagnostics() {
    return {
      ...this.imagePipeline.diagnostics(),
      shadows: this.shadows.diagnostics(),
      localShadows: this.streetLights.diagnostics(),
      sky: this.photoSky.diagnostics(),
      reflectionProbe: this.reflection.probeDiagnostics,
      mirrorUpdates: this.reflection.mirrorUpdates,
      ultra: this.ultra.diagnostics(),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const details = this.details,
      streetDetails = this.streetDetails,
      photoVegetation = this.photoVegetation;
    this.details = null;
    this.streetDetails = null;
    this.photoVegetation = null;
    this.vehiclePaint.length = 0;
    this.vehicleRoots.length = 0;
    const failures: unknown[] = [];
    const release = (cleanup: () => void) => {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    };
    release(() => this.atmosphere.dispose());
    release(() => scannedGround.detach(this.renderer));
    release(() => this.terrain.dispose());
    release(() => this.roads.dispose());
    release(() => this.streetLights.dispose());
    release(() => this.practicalLights.dispose());
    release(() => this.buildings.dispose());
    release(() => this.dressing.dispose());
    release(() => this.crops.dispose());
    release(() => details?.dispose());
    release(() => streetDetails?.dispose());
    release(() => this.contacts.dispose());
    release(() => this.vegetation.dispose());
    release(() => photoVegetation?.dispose());
    release(() => this.water.dispose());
    release(() => this.markers.dispose());
    release(() => this.reflection.dispose());
    release(() => this.cars.dispose());
    release(() => this.trails.dispose());
    release(() => this.guidance.dispose());
    release(() => this.orbit.dispose());
    release(() => this.environment.dispose());
    release(() => this.wet.dispose());
    release(() => this.shadows.dispose());
    release(() => this.effectPlayback.reset());
    release(() =>
      this.effects.group.traverse((node) => {
        if (node instanceof T.Mesh || node instanceof T.Points) {
          release(() => node.geometry.dispose());
          for (const material of Array.isArray(node.material) ? node.material : [node.material])
            release(() => material.dispose());
        }
      }),
    );
    release(() => this.bloom.dispose());
    release(() => this.grade.dispose());
    release(() => this.fxaa.dispose());
    release(() => this.imagePipeline.dispose());
    release(() => this.ultra.dispose());
    release(() => this.photoSky.dispose());
    release(() => this.composer.dispose());
    release(() => this.scene.clear());
    if (failures.length) throw failures[0];
  }
}
