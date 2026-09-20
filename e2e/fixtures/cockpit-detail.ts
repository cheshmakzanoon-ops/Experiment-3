import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { controls, DEFAULT_OPTIONS, DEFAULT_SETUP } from '../../src/simulation/config.ts';
import { carBase, F, H } from '../../src/simulation/protocol.ts';

/** Presentation probes use actual production-physics frames and the unmodified
 * high-preset render path. They are not a lookalike score or a hardware benchmark. */
export async function captureCockpitArticulation() {
  const simulation = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'practice',
    weather: 'clear',
    opponents: 0,
    setup: { ...DEFAULT_SETUP, brakeBias: 0.62, diffPower: 0.78 },
    seed: 1887,
  });
  for (let i = 0; i < 96; i++) simulation.step(1 / 120);
  const initial = simulation.makeFrame();
  simulation.setInput({ ...controls(), steer: -1, brake: 1, ers: 2 });
  for (let i = 0; i < 180; i++) simulation.step(1 / 120);
  const left = simulation.makeFrame();
  simulation.setInput({ ...controls(), steer: 1, brake: 1, ers: 0 });
  for (let i = 0; i < 180; i++) simulation.step(1 / 120);
  const right = simulation.makeFrame();
  const retained = [initial.slice(), left.slice(), right.slice()];
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:1280px;height:720px';
  document.body.style.cssText = 'margin:0;background:#000';
  document.body.append(canvas);
  const renderer = new RacingRenderer(canvas, simulation.track);
  renderer.setQuality('high', { ...graphicsPreset('high'), resolutionScale: 1 });
  renderer.changeCamera('cockpit');
  renderer.setCars(1);
  const car = renderer.cars[0],
    base = carBase(0);
  const captures = [];
  // Track disposal once per unique texture, including shared suit/glove maps.
  const fabric = new Set<T.Texture>();
  car.root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      for (const value of Object.values(m))
        if (value instanceof T.Texture && value.userData.surfaceDetail) fabric.add(value);
  });
  let disposedSelectors = 0;
  for (const mesh of car.cockpitControls.selectorBank.meshes)
    mesh.addEventListener('dispose', () => disposedSelectors++);
  let disposedFabric = 0;
  for (const texture of fabric) texture.addEventListener('dispose', () => disposedFabric++);
  try {
    for (const [name, frame, replay] of [
      ['neutral', initial, false],
      ['left', left, false],
      ['right', right, false],
      ['paused', right, false],
      ['rewind', initial, true],
    ] as const) {
      if (name === 'rewind') renderer.reset();
      for (let i = 0; i < 2; i++) {
        renderer.draw(frame, frame, 1, 1 / 60, false, replay);
        if (i === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const visual = renderer.visualDiagnostics();
      captures.push({
        name,
        tick: frame[H.TICK],
        time: frame[H.TIME],
        steer: frame[base + F.STEER],
        bias: frame[base + F.BRAKE_BIAS],
        differential: frame[base + F.DIFF_POWER],
        ers: frame[base + F.ERS_MODE],
        wheelAngle: car.steering.rotation.z,
        dialAngles: car.cockpitControls.selectors.map((o) => o.rotation.z),
        dialInstances: car.cockpitControls.selectorBank.meshes.map((mesh) => ({
          count: mesh.count,
          matrices: Array.from({ length: mesh.count }, (_, i) => {
            const matrix = new T.Matrix4();
            mesh.getMatrixAt(i, matrix);
            return matrix.toArray();
          }),
        })),
        joints: visual.driver,
        screenVisible: visual.screenVisible,
        mirrors: visual.mirrors,
        image: canvas.toDataURL('image/png'),
        drawCalls: renderer.renderer.info.render.calls,
        triangles: renderer.renderer.info.render.triangles,
        textures: renderer.renderer.info.memory.textures,
        geometries: renderer.renderer.info.memory.geometries,
        // CPU wall time on a software renderer is recorded honestly, not called GPU time.
        renderCPUms: renderer.stats().renderCPUms,
      });
    }
    // Both ping-pong cubemaps have now been used. Repeated seeks must reuse
    // those GPU resources rather than leak a new filtered environment per seek.
    const seekMemory: { textures: number; geometries: number }[] = [];
    for (let i = 0; i < 4; i++) {
      renderer.reset();
      const frame = i % 2 ? initial : right;
      renderer.draw(frame, frame, 1, 1 / 60, false, true);
      seekMemory.push({ ...renderer.renderer.info.memory });
    }
    const sourceUnchanged = [initial, left, right].every((f, i) =>
      f.every((v, j) => v === retained[i][j]),
    );
    const glError = renderer.renderer.getContext().getError();
    renderer.dispose();
    renderer.dispose();
    return {
      captures,
      sourceUnchanged,
      glError,
      fabricTextures: fabric.size,
      disposedFabric,
      disposedSelectors,
      seekMemory,
    };
  } finally {
    renderer.dispose();
    canvas.remove();
  }
}
