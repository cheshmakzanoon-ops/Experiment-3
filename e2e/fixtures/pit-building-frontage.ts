import { captureRenderedCanvas } from '../../src/rendering/frame-capture.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import { PitBuildingFrontage } from '../../src/rendering/pit-building-frontage.ts';
import { HeroGarage } from '../../src/rendering/hero-garage.ts';
import { PitWallStation } from '../../src/rendering/pit-wall-station.ts';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';

const raw = (encoded: string) => Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
/** Actual circuit and renderer, including A22 and A24. Fixed art-survey cameras
 * supplement, never substitute for, the normal-startup and driving tests. */
export async function capturePitBuilding(
  encoded: string,
  garageBytes: string,
  stationBytes: string,
  lighting: 'day' | 'sunset' | 'night',
  wet: boolean,
) {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    opponents: 0,
    mode: 'practice',
    weather: wet ? 'rain' : 'clear',
    seed: 1887,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const frame = simulation.makeFrame(),
    original = frame.slice(),
    water = simulation.track.water.slice();
  const frontage = new PitBuildingFrontage(
    (await new GLTFLoader().parseAsync(raw(encoded).buffer, '')).scene,
  );
  const garage = new HeroGarage(
    (await new GLTFLoader().parseAsync(raw(garageBytes).buffer, '')).scene,
  );
  const station = new PitWallStation(
    (await new GLTFLoader().parseAsync(raw(stationBytes).buffer, '')).scene,
  );
  document.body.style.cssText = 'margin:0;background:#101515';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:1280px;height:720px';
  document.body.append(canvas);
  const view = new RacingRenderer(canvas, simulation.track, true);
  view.circuit.pitBuildingFrontage = frontage;
  view.circuit.heroGarage = garage;
  view.circuit.pitWallStation = station;
  const at = (track: Track, s: number, l: number, y: number) => {
    const p = track.at(s, trackPoint());
    return new T.Vector3(p.x + p.nx * l, p.y + p.bank * 12 + y, p.z + p.nz * l);
  };
  const images: {
    view: string;
    image: string;
    addedCalls: number;
    calls: number;
    triangles: number;
    chunks: ReturnType<typeof frontage.diagnostics>['chunks'];
  }[] = [];
  try {
    view.circuit.construction.runSynchronously();
    view.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
    view.lighting = lighting;
    view.draw(frame, frame, 1, 1 / 60);
    view.venueLighting.update(
      lighting !== 'day',
      at(simulation.track, 106, 30, 1),
      lighting === 'sunset' ? 0.18 : 1,
    );
    const shots = [
      { name: 'full-frontage', eye: [56, -36, 13], target: [118, 35, 5.9], fov: 57 },
      { name: 'hero-garage', eye: [90, 18, 4.5], target: [106, 35, 5.8], fov: 67 },
      { name: 'operations-gallery', eye: [105, 17, 10.3], target: [106, 34, 9.3], fov: 64 },
      { name: 'west-service-core', eye: [56, 48, 8], target: [73, 39, 6], fov: 64 },
      { name: 'east-termination', eye: [186, 13, 7], target: [160, 35, 5], fov: 58 },
      { name: 'rear-elevation', eye: [129, 78, 14], target: [122, 38, 6], fov: 62 },
      { name: 'elevated-replay', eye: [86, -12, 33], target: [120, 34, 5], fov: 61 },
    ];
    for (const shot of shots) {
      view.camera.position.copy(at(simulation.track, ...(shot.eye as [number, number, number])));
      view.camera.lookAt(at(simulation.track, ...(shot.target as [number, number, number])));
      view.camera.fov = shot.fov;
      view.camera.updateProjectionMatrix();
      frontage.update(view.camera, 'high', lighting);
      garage.update(view.camera, 'high', lighting);
      station.update(view.camera, 'high', lighting, frame, 'HELD', true);
      frontage.root.visible = false;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      const base = view.renderer.info.render.calls;
      frontage.root.visible = true;
      view.renderer.info.reset();
      view.renderer.render(view.scene, view.camera);
      const blob = await captureRenderedCanvas(canvas);
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      images.push({
        view: shot.name,
        image,
        addedCalls: view.renderer.info.render.calls - base,
        calls: view.renderer.info.render.calls,
        triangles: view.renderer.info.render.triangles,
        chunks: frontage.diagnostics().chunks,
      });
    }
    const before = { ...view.renderer.info.memory };
    for (let i = 0; i < 4; i++) {
      frontage.update(view.camera, 'high', lighting);
      view.renderer.render(view.scene, view.camera);
    }
    return {
      lighting,
      wet,
      images,
      before,
      after: { ...view.renderer.info.memory },
      frontage: frontage.diagnostics(),
      garage: garage.diagnostics(),
      station: station.diagnostics(),
      sourceUnchanged: frame.every((n, i) => n === original[i]),
      waterUnchanged: simulation.track.water.every((n, i) => n === water[i]),
      glError: view.renderer.getContext().getError(),
      boundary: 'Fixed-camera real-circuit survey, not a driven lap or hardware FPS measurement.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
