import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp } from '../../src/core/math.ts';
import { BikeShells } from '../../src/rendering/bike.ts';
import { sampleChassisPose } from '../../src/rendering/snapshot-interpolation.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { carBase } from '../../src/simulation/protocol.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { CircuitScene } from '../../src/rendering/circuit.ts';
import { batchScene } from '../../src/rendering/geometry.ts';
import { StaticTransformGroup } from '../../src/rendering/static-transform-group.ts';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { VenueKitContext } from '../../src/rendering/venue-kit/context.ts';
import { buildPaddock } from '../../src/rendering/venue-kit/structures.ts';
import { buildGpGarageEquipment } from '../../src/rendering/venue-kit/gp-garage-equipment.ts';
import { gpPaddockPlan } from '../../src/rendering/venue-kit/gp-paddock-architecture.ts';
import { gpRaceControlSite } from '../../src/rendering/venue-kit/gp-race-control.ts';

export interface GpPaddockCapture {
  venue: string;
  view: string;
  wet: boolean;
  image: string;
  hash: number;
  error: number;
  calls: number;
  triangles: number;
  resources: { geometries: number; textures: number };
}

/** Actual production garages, upper architecture and pit wall in one view.
 * The road uses production ribbon geometry. Optional race views pose the
 * production motorcycles from eight entrants in a fixed-step race. The
 * fixture supplies the light, environment map and camera for repeatability. */
export async function captureGpPaddocks(
  venues: readonly ('poggio-alto' | 'cape-wrenna' | 'haarveld' | 'montejaral')[] = [
    'poggio-alto',
    'cape-wrenna',
    'haarveld',
    'montejaral',
  ],
  options: {
    controlOnly?: boolean;
    equipmentOnly?: boolean;
    raceView?: 'trackside' | 'trailing';
    onCapture?: (capture: GpPaddockCapture) => Promise<void>;
  } = {},
) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1100, 700);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const environmentScene = new RoomEnvironment(),
    pmrem = new T.PMREMGenerator(renderer),
    environment = pmrem.fromScene(environmentScene, 0.04);
  environmentScene.dispose();
  pmrem.dispose();
  const captures: GpPaddockCapture[] = [];
  const releases: { venue: string; geometries: number; textures: number }[] = [];
  try {
    for (const id of venues) {
      const track = new Track('clear', false, undefined, CIRCUITS[id]),
        kit = new VenueKitContext(track),
        plan = gpPaddockPlan(track),
        centre = (plan[5].s + plan[6].s) / 2,
        p = trackPoint(),
        surfaces = new StaticTransformGroup(),
        ribbon = Object.create(CircuitScene.prototype) as CircuitScene;
      Object.assign(ribbon, { track, surfaces });
      buildPaddock(kit);
      batchScene(kit.root, new Set());
      const equipment =
        options.equipmentOnly || options.raceView ? buildGpGarageEquipment(track) : null;
      if (equipment) kit.root.add(equipment);
      const road = surfaceMaterial('asphalt'),
        white = new T.MeshStandardMaterial({ color: 0xdcded5, roughness: 0.7 }),
        from = options.raceView ? -110 : plan[0].s - 70,
        to = plan[11].s + 90;
      ribbon.ribbon(kit.materials.ground, {
        start: from,
        end: to,
        columns: 4,
        offset: (_s, t) => -75 + t * 150,
        height: () => -0.07,
      });
      ribbon.ribbon(road, {
        start: from,
        end: to,
        columns: 6,
        offset: (s, t) => (t * 2 - 1) * track.at(s, p).width,
      });
      ribbon.ribbon(road, {
        start: from,
        end: to,
        columns: 5,
        offset: (_s, t) => track.pit.side * (track.pit.offset - 4 + t * 11),
      });
      for (const side of [-1, 1] as const)
        ribbon.ribbon(white, {
          start: from,
          end: to,
          offset: (s, t) => side * (track.at(s, p).width - 0.15 + t * 0.13),
          height: () => 0.006,
        });
      const scene = new T.Scene(),
        camera = new T.PerspectiveCamera(54, 1100 / 700, 0.1, 1100),
        sun = new T.DirectionalLight(0xffead2, 2.9),
        focus = track.at(centre, trackPoint()),
        weather = new WeatherPresentation();
      scene.background = new T.Color(0xbacbd8);
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.42;
      scene.add(
        surfaces,
        kit.root,
        sun,
        sun.target,
        new T.HemisphereLight(0xc5e0ff, 0x60584c, 1.15),
      );
      sun.position.set(
        focus.x - focus.nx * track.pit.side * 85 - focus.tx * 70,
        focus.y + 105,
        focus.z - focus.nz * track.pit.side * 85 - focus.tz * 70,
      );
      sun.target.position.set(focus.x, focus.y + 4, focus.z);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, {
        left: -115,
        right: 115,
        top: 115,
        bottom: -115,
        near: 1,
        far: 350,
      });
      sun.shadow.normalBias = 0.035;
      weather.install(scene);
      const place = (station: number, lateral: number, above: number) => {
        const at = track.at(station, trackPoint());
        return new T.Vector3(
          at.x + at.nx * lateral,
          at.y + at.bank * clamp(lateral, -12, 12) + above,
          at.z + at.nz * lateral,
        );
      };
      let riders: BikeShells | undefined;
      const draw = (
        view: 'approach' | 'pit' | 'control' | 'equipment' | 'trackside' | 'trailing',
        wet: boolean,
      ) => {
        if (view === 'trackside' || view === 'trailing') {
          const simulation = new Simulation({
            ...DEFAULT_OPTIONS,
            mode: 'race',
            ruleset: 'gp-motorcycle',
            circuit: id,
            opponents: 7,
            laps: 3,
            seed: 30101,
            weather: 'clear',
            vehicles: ['gpr1', 'gpr2', 'gpr1', 'gpr2', 'gpr1', 'gpr2', 'gpr1', 'gpr2'],
          });
          simulation.autoPlayer = true;
          const instant = view === 'trackside' ? 13.3 : 10.3;
          for (let tick = 1; tick < Math.round(instant * 120); tick++) simulation.step(1 / 120);
          const a = simulation.makeFrame();
          simulation.step(1 / 120);
          const b = simulation.makeFrame();
          const hosts = simulation.cars.map((_, index) => {
            const root = new T.Group();
            sampleChassisPose(a, b, carBase(index), 1, root.position, root.quaternion);
            return { root };
          });
          const rider = simulation.cars[0],
            s = rider.s,
            side = rider.lateral;
          camera.fov = view === 'trackside' ? 40 : 52;
          camera.updateProjectionMatrix();
          camera.position.copy(
            view === 'trackside'
              ? place(s + 3.9, side - track.pit.side * 4.7, 1.12)
              : place(s - 5.4, side - track.pit.side * 1.45, 1.64),
          );
          camera.lookAt(
            view === 'trackside' ? place(s + 0.2, side, 0.83) : place(s + 4.5, side, 0.78),
          );
          camera.updateMatrixWorld(true);
          riders = new BikeShells();
          scene.add(riders.root);
          riders.update(a, b, 1, hosts, camera, 'high', 0);
          weather.install(riders.root);
        } else if (view === 'equipment') {
          const bay = plan[4],
            basis = new T.Matrix4().makeRotationY(bay.yaw);
          basis.setPosition(bay.x, bay.y, bay.z);
          camera.position.set(-8.15, 1.45, 0.75).applyMatrix4(basis);
          camera.lookAt(new T.Vector3(-4.3, 0.54, 2.65).applyMatrix4(basis));
        } else if (view === 'approach') {
          camera.position.copy(place(centre - 76, -track.pit.side * 20, 5));
          camera.lookAt(place(centre + 7, track.pit.side * (track.pit.offset + 10), 6.5));
        } else if (view === 'pit') {
          camera.position.copy(place(centre - 19, track.pit.side * (track.pit.offset + 0.2), 1.65));
          camera.lookAt(place(centre + 14, track.pit.side * (track.pit.offset + 6.5), 5.25));
        } else {
          const site = gpRaceControlSite(track)!;
          camera.position.copy(place(site.s - 42, -track.pit.side * 0.7, 1.4));
          camera.lookAt(new T.Vector3(site.x, site.y + 9, site.z));
        }
        camera.updateMatrixWorld(true);
        weather.surface.value.set(wet ? 1 : 0, 0, 0, 0);
        renderer.render(scene, camera);
        const gl = renderer.getContext(),
          pixels = new Uint8Array(1100 * 700 * 4);
        gl.readPixels(0, 0, 1100, 700, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let hash = 2166136261;
        for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
        return {
          venue: id,
          view,
          wet,
          image: renderer.domElement.toDataURL('image/png'),
          hash: hash >>> 0,
          error: gl.getError(),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          resources: { ...renderer.info.memory },
        };
      };
      try {
        if (options.controlOnly || options.equipmentOnly || options.raceView) {
          // A focused art review needs one fully rendered production frame
          // per venue. Yield it immediately so a slow software backend does
          // not hold all completed evidence until the final venue finishes.
          const capture = draw(
            options.raceView ?? (options.equipmentOnly ? 'equipment' : 'control'),
            false,
          );
          captures.push(capture);
          await options.onCapture?.(capture);
        } else {
          draw('approach', false);
          captures.push(draw('approach', false), draw('pit', false), draw('control', false));
          if (id === 'haarveld')
            captures.push(draw('pit', false), draw('pit', true), draw('pit', false));
        }
      } finally {
        riders?.root.removeFromParent();
        riders?.disposeAll();
        const geometries = new Set<T.BufferGeometry>(),
          materials = new Set<T.Material>(),
          textures = new Set<T.Texture>();
        scene.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(material);
        });
        // Unused kit materials are owned by this fixture too, even when never
        // uploaded; release every generated ground/facade texture once.
        for (const value of Object.values(kit.materials))
          for (const material of Array.isArray(value) ? value : [value])
            if (material instanceof T.Material) materials.add(material);
        for (const material of materials) {
          for (const value of Object.values(material))
            if (value instanceof T.Texture) textures.add(value);
          material.dispose();
        }
        for (const geometry of geometries) geometry.dispose();
        for (const texture of textures) if (texture !== environment.texture) texture.dispose();
        weather.dispose();
        sun.shadow.map?.dispose();
        sun.shadow.mapPass?.dispose();
        renderer.renderLists.dispose();
        releases.push({ venue: id, ...renderer.info.memory });
      }
    }
    const gl = renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      captures,
      releases,
      renderer: debug ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string) : null,
    };
  } finally {
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
