import * as T from 'three';
import { Effects, PARTICLE_KIND } from '../../src/rendering/effects.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';

/** Test-only rendering oracle: all emitters consume an actual wet simulation
 * snapshot. The helper is not an application endpoint or a production bundle. */
export function verifyWeatherGPU() {
  const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather: 'rain',
    compound: 'wet', opponents: 0 });
  sim.autoPlayer = true;
  for (let tick = 0; tick < 360; tick++) sim.step(1 / 120);
  const frame = sim.makeFrame(), o = carBase(0);
  const renderer = new T.WebGLRenderer({ antialias: false }); renderer.setSize(128, 128);
  const target = new T.WebGLRenderTarget(128, 128), scene = new T.Scene();
  scene.background = new T.Color(0x080a10);
  const camera = new T.PerspectiveCamera(75, 1, 0.1, 500);
  camera.position.set(frame[o + F.X], frame[o + F.Y] + 6, frame[o + F.Z] + 16);
  camera.lookAt(frame[o + F.X], frame[o + F.Y] + 2, frame[o + F.Z]);
  const effects = new Effects(); scene.add(effects.group);
  const blank = new Uint8Array(128 * 128 * 4), active = new Uint8Array(blank.length);
  try {
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 128, 128, blank);
    for (let i = 0; i < 30; i++) effects.update(frame, 1 / 60);
    renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 128, 128, active);
    let changedPixels = 0;
    for (let i = 0; i < active.length; i += 4)
      if (active[i] !== blank[i] || active[i + 1] !== blank[i + 1] || active[i + 2] !== blank[i + 2]) changedPixels++;
    const diagnostics = effects.diagnostics();
    effects.clear(); effects.update(frame, 1 / 60, false);
    renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, 128, 128, active);
    let clearDifferences = 0;
    for (let i = 0; i < active.length; i++) if (active[i] !== blank[i]) clearDifferences++;
    return { changedPixels, clearDifferences, diagnostics, rainKind: PARTICLE_KIND.RAIN,
      simulationWind: [frame[H.WIND_X], frame[H.WIND_Z]], speedMps: frame[o + F.SPEED] };
  } finally {
    scene.traverse((object) => {
      if ((object instanceof T.Points || object instanceof T.Mesh)) { object.geometry.dispose(); (object.material as T.Material).dispose(); }
    });
    target.dispose(); renderer.dispose(); renderer.forceContextLoss();
  }
}
