import {
  persistSecondaryStandCapture,
  type SecondaryStandCaptureSink,
} from './secondary-stand-capture.ts';
import { sampleSecondaryStandLap } from './secondary-stand-traversal.ts';
import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';
import { detailDistance } from '../../src/rendering/view-detail.ts';
import { attachDrawLedger } from '../../src/rendering/draw-ledger.ts';
import { SECONDARY_STAND_ASSET } from '../../src/rendering/secondary-grandstand-assets.ts';
import { standFrame } from '../../src/rendering/grandstand.ts';
import { AUREL_VENUE } from '../../src/rendering/venue-plan.ts';

/** Full production factory and unchanged physical traversal, not a standalone
 * model viewer. Additional static cuts inspect both sides and all six sites. */
export async function surveySecondaryStands(
  lighting: 'day' | 'sunset' | 'night',
  sink: SecondaryStandCaptureSink,
) {
  const started = performance.now();
  const progress = (stage: string) =>
    console.info(
      '[a12-survey] ' + JSON.stringify({ lighting, stage, elapsedMs: performance.now() - started }),
    );
  const yieldBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  progress('simulation-start');
  const width = 1280,
    height = 720;
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 11,
    weather: lighting === 'night' ? 'rain' : 'clear',
    seed: 1887,
  });
  sim.autoPlayer = true;
  for (let i = 0; i < 8 * 120; i++) sim.step(1 / 120);
  const frame = sim.makeFrame().slice(),
    original = frame.slice(),
    water = sim.track.water.slice();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.style.cssText = 'margin:0';
  document.body.append(canvas);
  progress('factory-start');
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    (message) => progress(`factory: ${message.label}`),
    () => false,
    { quality: 'medium', graphics: { ...graphicsPreset('medium'), resolutionScale: 1 } },
  );
  if (!view) throw new Error('Missing production A12 renderer');
  progress('factory-ready');
  const roots = view.circuit.secondaryStands.roots;
  if (roots.length !== 6) throw new Error('Production scene did not install all six A12 stands');
  const installed: T.InstancedMesh[] = [];
  for (const root of roots)
    root.traverse((o) => {
      if (o instanceof T.InstancedMesh) installed.push(o);
    });
  if (
    installed.length !== 54 ||
    installed.some((m) => m.geometry.userData.authoredAsset !== SECONDARY_STAND_ASSET.revision)
  )
    throw new Error('A12 inspection found missing or unverified production geometry');
  const identities = installed.map((mesh) => ({
    mesh,
    geometry: mesh.geometry,
    position: mesh.geometry.getAttribute('position'),
    index: mesh.geometry.index,
    instances: mesh.instanceMatrix,
  }));
  const observedTiers = new Set<number>();
  const selected = installed.find((m) => m.name === 'A12 / 450m / roof')!;
  const before = selected.onBeforeRender;
  selected.onBeforeRender = function (...args) {
    before.apply(this, args);
    observedTiers.add(this.userData.secondaryStandTier);
  };
  const gl = view.renderer.getContext(),
    pixels = new Uint8Array(width * height * 4);
  const ledger = attachDrawLedger(view.renderer);
  const images: {
    name: string;
    site: number;
    calls: number;
    triangles: number;
    range: number;
    passes: ReturnType<typeof ledger.snapshot>;
  }[] = [];
  const memory = () => ({ ...view.renderer.info.memory });
  const update = () => {
    for (const name of [
      'concreteBarriers',
      'steelGuardrails',
      'catchFence',
      'impactBarriers',
      'recoveryGates',
      'marshalPosts',
      'startGantry',
      'signalHardware',
      'trackBoards',
      'broadcastCameras',
      'vegetation',
      'quarry',
    ] as const)
      view.circuit[name]?.update(view.camera, 'medium');
    view.circuit.heroGarage?.update(view.camera, 'medium', lighting);
    view.tyreEquipment?.update(view.camera, 'medium');
    view.wheelGunStorage?.update(view.camera);
    view.circuit.tyreBlankets?.update(view.camera, 'medium', lighting);
    view.circuit.pitBuildingFrontage?.update(view.camera, 'medium', lighting);
    view.circuit.pitWallStation?.update(view.camera, 'medium', lighting, frame, 'HELD', true);
    for (let id = 0; id < frame[H.CARS]; id++) {
      const b = carBase(id),
        followed = id === view.reviewCar();
      const d = new T.Vector3(frame[b + F.X], frame[b + F.Y], frame[b + F.Z]).distanceTo(
        view.camera.position,
      );
      view.cars[id].setLod(
        followed ? 0 : detailDistance(d, view.camera.fov, view.camera.aspect),
        'medium',
        followed,
      );
      view.cars[id].update(frame, frame, b, 1, 0, frame[H.TIME], false);
    }
    view.circuit.startFinish.update(frame, view.camera, lighting === 'night');
    view.circuit.staff.update(frame, view.camera.position, true);
    for (const crowd of view.circuit.crowdClusters)
      crowd.update(
        frame[H.TIME],
        view.camera.position,
        frame[H.RAIN],
        frame,
        view.camera.fov,
        view.camera.aspect,
      );
    view.sun.target.position.copy(view.camera.position);
    view.sun.position.copy(view.camera.position).add(lightingDirection(lighting));
    view.venueLighting.update(
      lighting !== 'day',
      view.camera.position,
      lighting === 'sunset' ? 0.18 : 1,
    );
  };
  const cuts = [
    ...AUREL_VENUE.grandstands.slice(2).map((s) => ({
      name: `${s.s}-front`,
      station: s.s,
      x: -22,
      y: 11,
      z: 30,
      targetY: 3.6,
      fov: 48,
    })),
    { name: '450-aisle', station: 450, x: -2, y: 3.2, z: 13, targetY: 3.0, fov: 58 },
    { name: '780-aisle', station: 780, x: -2, y: 3.2, z: 13, targetY: 3.0, fov: 58 },
    { name: '450-mid', station: 450, x: -240, y: 32, z: 0, targetY: 3.6, fov: 58 },
    { name: '450-far', station: 450, x: -550, y: 40, z: 0, targetY: 3.6, fov: 58 },
    { name: '450-telephoto', station: 450, x: -550, y: 40, z: 0, targetY: 3.6, fov: 10 },
  ];
  const cut = (c: (typeof cuts)[number]) => {
    const site = AUREL_VENUE.grandstands.find((s) => s.s === c.station)!;
    const f = standFrame(sim.track, site),
      sin = Math.sin(f.yaw),
      cos = Math.cos(f.yaw);
    const x = site.side * c.x,
      target = site.side * 4.5;
    view.camera.position.set(f.x + cos * x + sin * c.z, f.y + c.y, f.z - sin * x + cos * c.z);
    view.camera.fov = c.fov;
    view.camera.lookAt(f.x + cos * target, f.y + c.targetY, f.z - sin * target);
    view.camera.updateProjectionMatrix();
    view.camera.updateMatrixWorld(true);
    update();
  };
  const render = () => {
    view.renderer.info.reset();
    ledger.begin();
    view.renderer.render(view.scene, view.camera);
    ledger.end();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  };
  // Own the existing measured frame; do not issue a duplicate scene draw.
  const capture = async (c: (typeof cuts)[number]) => {
    let min = 255,
      max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    await persistSecondaryStandCapture(canvas, c.name, sink);
    images.push({
      name: c.name,
      site: c.station,
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      range: max - min,
      passes: ledger.snapshot(),
    });
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    // Use the same asynchronous, GPU-complete grid preparation as real entry;
    // do not cold-compile an entire twelve-car race in one synchronous draw.
    if (
      !(await view.prepare(
        frame,
        (message) => progress(`prepare: ${message}`),
        () => false,
        yieldBrowser,
      ))
    )
      throw new Error('A12 production preparation did not complete');
    progress('normal-cockpit-start');
    view.draw(frame, frame, 1, 1 / 60);
    const cockpit = {
      name: 'normal-cockpit',
      stats: view.stats(),
    };
    await persistSecondaryStandCapture(canvas, cockpit.name, sink);
    progress('normal-cockpit-ready');
    await yieldBrowser();
    const sequence = [...cuts, ...[...cuts].reverse()];
    for (let pass = 0; pass < 2; pass++)
      for (const c of sequence) {
        progress(`warm-${pass}: ${c.name}`);
        cut(c);
        render();
        // Yield only the observer. The frozen snapshot, water, render count,
        // camera coverage, quality and application simulation clock are retained.
        await yieldBrowser();
      }
    const memoryBefore = memory(),
      memories: ReturnType<typeof memory>[] = [];
    observedTiers.clear();
    for (const c of sequence) {
      progress(`memory: ${c.name}`);
      cut(c);
      render();
      memories.push(memory());
      if (memories.length <= cuts.length) await capture(c);
      await yieldBrowser();
    }
    progress('building-negative-control');
    // A controlled render hides only the selected authored building, not the
    // whole scene. Sky, road and unrelated props cannot satisfy this difference.
    cut(cuts[0]);
    render();
    const present = pixels.slice();
    const first = roots.find((r) => r.userData.secondaryStand.s === 450)!;
    let changedStandPixels = 0;
    try {
      first.visible = false;
      render();
      for (let i = 0; i < pixels.length; i += 4)
        if (Math.max(...[0, 1, 2].map((c) => Math.abs(present[i + c] - pixels[i + c]))) > 8)
          changedStandPixels++;
    } finally {
      first.visible = true;
      render();
    }
    for (const quality of ['low', 'high', 'medium'] as const) {
      progress(`quality: ${quality}`);
      if (
        !(await view.prepareQuality(
          quality,
          { ...graphicsPreset(quality), resolutionScale: 1 },
          () => false,
          yieldBrowser,
        ))
      )
        throw new Error('A12 production quality preparation did not complete');
      view.mode = 'cockpit';
      view.draw(frame, frame, 1, 1 / 60);
      await yieldBrowser();
    }
    const frameUnchanged = frame.every((v, i) => Object.is(v, original[i]));
    const waterUnchanged = water.every((v, i) => v === sim.track.water[i]);
    const driving: { site: number; station: number; time: number; mode: string }[] = [];
    let liveFramesUnchanged = true,
      liveWaterUnchanged = true;
    const visited = new Set<number>();
    progress('physical-traversal-start');
    const traversal = await sampleSecondaryStandLap(sim, async (sample) => {
      progress(`physical: ${sample.site}m / ${sample.station.toFixed(2)}m`);
      const live = sample.frame.slice(),
        wet = sim.track.water.slice();
      view.mode = 'cockpit';
      view.draw(sample.previous, sample.frame, 1, sample.delta);
      await persistSecondaryStandCapture(canvas, `physical-drive-${driving.length}`, sink);
      driving.push({
        site: sample.site,
        station: sample.station,
        time: sample.time,
        mode: 'cockpit',
      });
      if (!visited.has(sample.site)) {
        visited.add(sample.site);
        view.mode = 'chase';
        view.draw(sample.frame, sample.frame, 1, 0);
        await persistSecondaryStandCapture(canvas, `physical-drive-${driving.length}`, sink);
        driving.push({
          site: sample.site,
          station: sample.station,
          time: sample.time,
          mode: 'chase',
        });
      }
      liveFramesUnchanged &&= live.every((v, i) => Object.is(v, sample.frame[i]));
      liveWaterUnchanged &&= wet.every((v, i) => v === sim.track.water[i]);
    });
    progress('survey-complete');
    return {
      lighting,
      asset: SECONDARY_STAND_ASSET,
      diagnostics: view.circuit.secondaryStands.diagnostics(),
      images,
      cockpit,
      driving,
      driveCompleted: traversal.completed,
      frameUnchanged,
      waterUnchanged,
      liveFramesUnchanged,
      liveWaterUnchanged,
      changedStandPixels,
      memoryBefore,
      memories,
      observedTiers: [...observedTiers].sort(),
      identitiesUnchanged: identities.every(
        (i) =>
          i.mesh.geometry === i.geometry &&
          i.geometry.index === i.index &&
          i.geometry.getAttribute('position') === i.position &&
          i.mesh.instanceMatrix === i.instances,
      ),
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      acceptance: { finalArt: false, humanLap: false, hardwarePerformance: false },
    };
  } finally {
    progress('dispose');
    selected.onBeforeRender = before;
    view.dispose();
    canvas.remove();
  }
}
