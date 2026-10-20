import * as T from 'three';
import { clamp } from '../../src/core/math.ts';
import { CIRCUITS } from '../../src/simulation/circuits.ts';
import { gpCornerShapes } from '../../src/simulation/gp-corner-shape.ts';
import { SURFACE, Track, trackPoint } from '../../src/simulation/track.ts';
import { CircuitScene, circuitKerbHeight } from '../../src/rendering/circuit.ts';
import { installCircuitFinish } from '../../src/rendering/circuit-finish.ts';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';
import {
  installKerbFinish,
  installRunoffFinish,
} from '../../src/rendering/studio/kerb-runoff-finish.ts';
import { installGravelFinish } from '../../src/rendering/studio/grass-gravel-finish.ts';
import { gpEdgeDesign } from '../../src/rendering/venue-kit/gp-edge-design.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Bounded actual GP road geometry and production material chain. No backdrop
 * replaces the new feature; this fixture checks edge rendering, not full-scene
 * performance, photorealistic parity or the complete riding journey. */
export function captureGpEdges(id: 'poggio-alto' | 'cape-wrenna' | 'haarveld' | 'montejaral') {
  const track = new Track('clear', false, undefined, CIRCUITS[id]),
    design = gpEdgeDesign(track)!,
    corner = track.circuit.corners[0],
    shape = gpCornerShapes(track)[0],
    outside = shape.direction === 'left' ? -1 : 1,
    p = trackPoint(),
    surfaces = new T.Group(),
    circuit = Object.assign(Object.create(CircuitScene.prototype) as CircuitScene, {
      track,
      surfaces,
    }),
    road = surfaceMaterial('asphalt'),
    runoff = surfaceMaterial('asphalt', 'paint'),
    gravel = surfaceMaterial('gravel'),
    grass = surfaceMaterial('grass'),
    kerb = new T.MeshStandardMaterial({ roughness: 0.85 }),
    white = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
  installRunoffFinish(runoff, track.length, design);
  installCircuitFinish(kerb, 'kerb');
  installKerbFinish(kerb, track.length, design);
  installCircuitFinish(white, 'paint');
  installGravelFinish(gravel);
  const start = corner.s - shape.entry - 45,
    end = corner.s + shape.exit + 45;
  circuit.ribbon(grass, {
    start,
    end,
    columns: 10,
    offset: (s, t) => (t * 2 - 1) * (track.at(s, p).width + 42),
    height: () => -0.055,
  });
  // Use the authored contact classification and real barrier width for the
  // outer verge, as queueGround does in a complete CircuitScene.
  for (const side of [-1, 1] as const)
    for (const [kind, material, lift] of [
      [SURFACE.GRAVEL, gravel, -0.027],
      [SURFACE.ASPHALT, road, -0.014],
    ] as const)
      circuit.ribbon(material, {
        start,
        end,
        step: 4,
        columns: 2,
        offset: (s, t) => {
          track.at(s, p);
          const inner = p.width + 4,
            outer = Math.max(inner, track.boundaryAt(p, side) + 1);
          return side * (inner + (outer - inner) * t);
        },
        height: () => lift,
        include: (s, lateral) =>
          Math.abs(lateral) > track.at(s, p).width + 4.05 &&
          track.runoffSurface(p, lateral) === kind,
      });
  circuit.ribbon(runoff, {
    start,
    end,
    columns: 4,
    runoff: true,
    offset: (s, t) => (t * 2 - 1) * (track.at(s, p).width + 4),
    height: () => -0.008,
  });
  circuit.ribbon(road, {
    start,
    end,
    columns: 14,
    step: 1.8,
    offset: (s, t) => (t * 2 - 1) * track.at(s, p).width,
  });
  for (const side of [-1, 1]) {
    circuit.ribbon(kerb, {
      start,
      end,
      columns: 6,
      stripes: true,
      step: 0.16,
      offset: (s, t) => side * (track.at(s, p).width + t * 1.1),
      height: (s, lateral, t) => circuitKerbHeight(track, s, lateral, t * 1.1),
    });
    circuit.ribbon(white, {
      start,
      end,
      offset: (s, t) => side * (track.at(s, p).width - 0.17 + t * 0.14),
      height: () => 0.006,
    });
  }
  const scene = new T.Scene(),
    renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }),
    camera = new T.PerspectiveCamera(48, 1.6, 0.08, 600),
    sun = new T.DirectionalLight(0xffefdb, 2.5);
  renderer.setSize(960, 600);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  scene.background = new T.Color(0xb8c9d5);
  scene.add(surfaces, sun, new T.HemisphereLight(0xd1e5ff, 0x675d47, 1.6));
  const point = (s: number, lateral: number, height: number) => {
    const at = track.at(s, trackPoint());
    return new T.Vector3(
      at.x + at.nx * lateral,
      at.y + at.bank * clamp(lateral, -12, 12) + height,
      at.z + at.nz * lateral,
    );
  };
  sun.position.copy(point(corner.s, 70, 120));
  sun.target.position.copy(point(corner.s, 0, 0));
  scene.add(sun.target);
  camera.position.copy(point(corner.s - 10, -outside * (track.at(corner.s - 10, p).width + 6), 7));
  camera.lookAt(point(corner.s + 8, -outside * (p.width - 0.5), 0));
  camera.updateMatrixWorld(true);
  const weather = new WeatherPresentation();
  weather.install(scene);
  const draw = (wet: boolean, image: boolean) => {
    weather.surface.value.set(wet ? 1 : 0, 0, 0, 0);
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      pixels = new Uint8Array(960 * 600 * 4);
    gl.readPixels(0, 0, 960, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619);
    return {
      wet,
      hash: hash >>> 0,
      image: image ? renderer.domElement.toDataURL('image/png') : null,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 },
      error: gl.getError(),
    };
  };
  try {
    renderer.render(scene, camera);
    return {
      id,
      design: design.id,
      captures: [draw(false, true), draw(false, false), draw(true, false), draw(false, false)],
    };
  } finally {
    disposePhase27Scene(scene);
    renderer.dispose();
  }
}
