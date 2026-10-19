import * as T from 'three';
import { CircuitScene } from '../../src/rendering/circuit.ts';
import { GridPaintPresentation } from '../../src/rendering/grid-paint.ts';
import { StaticTransformGroup } from '../../src/rendering/static-transform-group.ts';
import { installCircuitFinish } from '../../src/rendering/circuit-finish.ts';
import { surfaceMaterial } from '../../src/rendering/surface-detail.ts';
import { installWetRoad } from '../../src/rendering/materials.ts';
import {
  gpLaunchGridFor,
  installRoadDetail,
  surfaceGridFor,
} from '../../src/rendering/studio/road-detail.ts';
import { WeatherPresentation } from '../../src/rendering/weather-presentation.ts';
import { Track, trackPoint, CELL_COLS, CELL_ROWS } from '../../src/simulation/track.ts';
import { circuitDefinition } from '../../src/simulation/circuits.ts';
import { batchScene } from '../../src/rendering/geometry.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Bounded production road and paint. This isolates GP grid alignment and
 * WebGL/material ownership; it is not a full venue or gameplay capture. */
export function captureGpStartGrid() {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(800, 600);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene();
  scene.background = new T.Color(0x9eadb8);
  scene.add(new T.HemisphereLight(0xdde7f2, 0x837363, 1.3));
  const sun = new T.DirectionalLight(0xffedcf, 3.1);
  sun.position.set(-160, 300, -90);
  scene.add(sun);
  const camera = new T.PerspectiveCamera(43, 800 / 600, 0.05, 250),
    track = new Track('clear', false, undefined, circuitDefinition('poggio-alto')),
    props = new StaticTransformGroup(),
    surfaces = new StaticTransformGroup(),
    bytes = new Uint8Array(CELL_COLS * CELL_ROWS * 4),
    state = new T.DataTexture(bytes, CELL_COLS, CELL_ROWS, T.RGBAFormat),
    motorcycle = { value: 1 },
    gpSurface = { value: 1 },
    grandPrixGrid = { value: 0 },
    road = surfaceMaterial('asphalt', undefined, true),
    paint = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
  state.magFilter = state.minFilter = T.LinearFilter;
  installWetRoad(road, state, true);
  installRoadDetail(
    road,
    track.length,
    motorcycle,
    surfaceGridFor(track),
    gpSurface,
    gpLaunchGridFor(track, grandPrixGrid),
  );
  installCircuitFinish(paint, 'paint');
  const gridPaint = new GridPaintPresentation(track, paint);
  const circuit = Object.assign(Object.create(CircuitScene.prototype), {
    track,
    props,
    surfaces,
    grandPrixGrid,
    gridPaint,
  }) as CircuitScene;
  scene.add(props, surfaces);
  const point = trackPoint();
  circuit.ribbon(road, {
    start: track.length - 105,
    end: track.length + 15,
    columns: 14,
    road: true,
    step: 1.8,
    offset: (s, t) => (t * 2 - 1) * track.at(s, point).width,
  });
  gridPaint.build(props);
  circuit.setGrandPrixGrid(true);
  circuit.setGrandPrixGrid(false);
  batchScene(props, new Set([gridPaint.root]));
  props.sealTransforms();
  surfaces.sealTransforms();
  const weather = new WeatherPresentation();
  weather.install(props);
  function position(s: number, lateral: number, height: number) {
    const at = track.at(s, trackPoint());
    return new T.Vector3(
      at.x + at.nx * lateral,
      at.y + at.bank * lateral + height,
      at.z + at.nz * lateral,
    );
  }
  camera.position.copy(position(track.length - 64, 9.5, 19));
  camera.lookAt(position(track.length - 45, 0, 0));
  function wetness(wet: boolean) {
    for (let i = 0; i < bytes.length; i += 4) {
      bytes[i] = wet ? 125 : 0;
      bytes[i + 1] = 105;
      bytes[i + 3] = 255;
    }
    state.needsUpdate = true;
    weather.surface.value.set(wet ? 1 : 0, 0, 0, 0);
  }
  const captures: {
    name: string;
    image: string;
    hash: number;
    calls: number;
    triangles: number;
    resources: { geometries: number; textures: number; programs: number };
  }[] = [];
  function draw(name: string) {
    renderer.render(scene, camera);
    const gl = renderer.getContext(),
      pixels = new Uint8Array(800 * 600 * 4);
    gl.readPixels(0, 0, 800, 600, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
    captures.push({
      name,
      image: renderer.domElement.toDataURL('image/png'),
      hash: hash >>> 0,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      resources: { ...renderer.info.memory, programs: renderer.info.programs?.length ?? 0 },
    });
  }
  try {
    wetness(false);
    // Warm both fixed geometry layers before the resource-retention comparison.
    renderer.render(scene, camera);
    circuit.setGrandPrixGrid(true);
    renderer.render(scene, camera);
    circuit.setGrandPrixGrid(false);
    draw('original-grid');
    circuit.setGrandPrixGrid(true);
    draw('gp-grid');
    draw('gp-grid-held');
    // Diagnostic control: same new paint, but the old two-column launch paths.
    grandPrixGrid.value = 0;
    draw('gp-paint-old-launch-control');
    grandPrixGrid.value = 1;
    wetness(true);
    draw('gp-grid-wet');
    draw('gp-grid-wet-held');
    wetness(false);
    for (let i = 0; i < 90; i++) circuit.setGrandPrixGrid(i % 2 === 0);
    circuit.setGrandPrixGrid(true);
    draw('gp-grid-restored');
    circuit.setGrandPrixGrid(false);
    draw('original-grid-restored');
    return { captures, grid: gridPaint.diagnostics(), glError: renderer.getContext().getError() };
  } finally {
    disposePhase27Scene(scene);
    state.dispose();
    renderer.dispose();
  }
}
