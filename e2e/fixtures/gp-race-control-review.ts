import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { requireBrowserBackend, type BrowserBackend } from '../../scripts/browser-backend.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { Track } from '../../src/simulation/track.ts';
import { paddockMaterials } from '../../src/rendering/paddock-detail.ts';
import { buildGpRaceControl } from '../../src/rendering/venue-kit/gp-race-control.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';

type Venue = 'poggio-alto' | 'cape-wrenna' | 'haarveld' | 'montejaral';
export interface GpControlCapture {
  venue: Venue;
  image: string;
  error: number;
  calls: number;
  triangles: number;
  resources: { geometries: number; textures: number };
}

/** Component-only art diagnosis. Actual tower geometry, materials, weather
 * hooks and the existing paddock review's lighting are retained. The building
 * is rebased to an inspection origin; no road, terrain, garage row or actors
 * are created. This is not a complete circuit or frame-rate benchmark. */
export async function captureGpRaceControls(
  options: {
    backend?: BrowserBackend;
    venues?: readonly Venue[];
    onCapture?: (capture: GpControlCapture) => Promise<void>;
    onStage?: (stage: string) => Promise<void>;
  } = {},
) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }),
    scene = new T.Scene(),
    camera = new T.PerspectiveCamera(45, 1100 / 700, 0.1, 250),
    sun = new T.DirectionalLight(0xffead2, 2.9),
    common = paddockMaterials(),
    shared = new Set<T.Material>(Object.values(common)),
    weather = new WeatherPresentation(),
    captures: GpControlCapture[] = [],
    releases: { venue: Venue; geometries: number; textures: number }[] = [];
  let environment: T.WebGLRenderTarget | undefined;
  renderer.setSize(1100, 700);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const gl = renderer.getContext(),
    debug = gl.getExtension('WEBGL_debug_renderer_info'),
    rendererName = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : null;
  try {
    if (options.backend) requireBrowserBackend(options.backend, rendererName);
    await options.onStage?.(`renderer: ${rendererName}`);
    const room = new RoomEnvironment(),
      pmrem = new T.PMREMGenerator(renderer);
    try {
      environment = pmrem.fromScene(room, 0.04);
    } finally {
      room.dispose();
      pmrem.dispose();
    }
    await options.onStage?.('production lighting ready');
    scene.background = new T.Color(0xbacbd8);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.42;
    scene.add(sun, sun.target, new T.HemisphereLight(0xc5e0ff, 0x60584c, 1.15));
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.normalBias = 0.035;
    Object.assign(sun.shadow.camera, {
      left: -20,
      right: 20,
      top: 28,
      bottom: -12,
      near: 1,
      far: 250,
    });
    sun.target.position.set(0, 8, 0);
    const venues: readonly Venue[] = options.venues ?? [
      'poggio-alto',
      'cape-wrenna',
      'haarveld',
      'montejaral',
    ];
    for (const venue of venues) {
      const track = new Track('clear', false, undefined, CIRCUITS[venue]),
        building = buildGpRaceControl(track, common)!;
      // Local -X is the pit face. The approaching end mirrors with the
      // production left-pit frame, preserving the correct printed face.
      building.position.set(0, 0, 0);
      building.rotation.set(0, 0, 0);
      scene.add(building);
      // The taller folded roof needs a little more margin in this inspection
      // camera. Production cameras and all model geometry remain unchanged.
      const distanceScale = venue === 'haarveld' ? 1.12 : 1;
      camera.position.set(-22 * distanceScale, 1.7, -track.pit.side * 24 * distanceScale);
      camera.lookAt(0, 9, 0);
      camera.updateMatrixWorld(true);
      sun.position.set(-85, 105, -track.pit.side * 70);
      weather.install(building);
      try {
        await options.onStage?.(`rendering ${venue}`);
        renderer.render(scene, camera);
        const capture: GpControlCapture = {
          venue,
          image: renderer.domElement.toDataURL('image/png'),
          error: gl.getError(),
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          resources: { ...renderer.info.memory },
        };
        captures.push(capture);
        await options.onCapture?.(capture);
      } finally {
        const geometries = new Set<T.BufferGeometry>(),
          materials = new Set<T.Material>(),
          textures = new Set<T.Texture>();
        building.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (!shared.has(material)) materials.add(material);
        });
        scene.remove(building);
        for (const material of materials) {
          for (const value of Object.values(material))
            if (value instanceof T.Texture) textures.add(value);
          material.dispose();
        }
        for (const geometry of geometries) geometry.dispose();
        for (const texture of textures) texture.dispose();
        renderer.renderLists.dispose();
        releases.push({ venue, ...renderer.info.memory });
      }
    }
    return {
      scope: 'Component-only original GP control architecture; no circuit ground, road or actors.',
      renderer: rendererName,
      captures,
      releases,
    };
  } finally {
    for (const material of shared) material.dispose();
    weather.dispose();
    sun.shadow.dispose();
    environment?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
