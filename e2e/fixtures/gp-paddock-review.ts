import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp } from '../../src/core/math.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { CircuitScene } from '../../src/rendering/circuit.ts';
import { batchScene } from '../../src/rendering/geometry.ts';
import { StaticTransformGroup } from '../../src/rendering/static-transform-group.ts';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { VenueKitContext } from '../../src/rendering/venue-kit/context.ts';
import { buildPaddock } from '../../src/rendering/venue-kit/structures.ts';
import { gpPaddockPlan } from '../../src/rendering/venue-kit/gp-paddock-architecture.ts';

/** Actual production garages, upper architecture and pit wall in one view.
 * The road datum is production ribbon geometry. Surrounding scenery/actors
 * are deliberately absent; this is a construction/render check, not an FPS
 * result for the complete game. One renderer is reused across all four sites. */
export function captureGpPaddocks(
  venues: readonly ('poggio-alto' | 'cape-wrenna' | 'haarveld' | 'montejaral')[] = [
    'poggio-alto',
    'cape-wrenna',
    'haarveld',
    'montejaral',
  ],
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
  const captures: {
    venue: string;
    view: string;
    wet: boolean;
    image: string;
    hash: number;
    error: number;
    calls: number;
    triangles: number;
    resources: { geometries: number; textures: number };
  }[] = [];
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
      const road = surfaceMaterial('asphalt'),
        white = new T.MeshStandardMaterial({ color: 0xdcded5, roughness: 0.7 }),
        from = plan[0].s - 70,
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
      const draw = (view: 'approach' | 'pit', wet: boolean) => {
        if (view === 'approach') {
          camera.position.copy(place(centre - 76, -track.pit.side * 20, 5));
          camera.lookAt(place(centre + 7, track.pit.side * (track.pit.offset + 10), 6.5));
        } else {
          camera.position.copy(place(centre - 19, track.pit.side * (track.pit.offset + 0.2), 1.65));
          camera.lookAt(place(centre + 14, track.pit.side * (track.pit.offset + 6.5), 5.25));
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
        draw('approach', false);
        captures.push(draw('approach', false), draw('pit', false));
        if (id === 'haarveld')
          captures.push(draw('pit', false), draw('pit', true), draw('pit', false));
      } finally {
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
