import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';
import { detailDistance } from '../../src/rendering/view-detail.ts';
import { attachDrawLedger } from '../../src/rendering/draw-ledger.ts';
import { EVENT_HALL_ASSET } from '../../src/rendering/event-hall-assets.ts';

/** Full production factory, not a replacement toy scene. Static inspection
 * cameras do not alter physical cars; traversal samples use ordinary AI only. */
export async function surveyEventHall(lighting: 'day' | 'sunset' | 'night') {
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
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    { quality: 'medium', graphics: { ...graphicsPreset('medium'), resolutionScale: 1 } },
  );
  if (!view) throw new Error('Missing production A71 renderer');
  const hall = view.venueLighting.root.getObjectByName(
    'Aurel event hall / grounded facade and public plaza',
  )!;
  const shell = view.venueLighting.root.getObjectByName(
    'Original LED venue landmark / structurally grounded event hall',
  ) as T.Mesh;
  if (!hall || !shell || shell.geometry.userData.authoredAsset !== EVENT_HALL_ASSET.revision)
    throw new Error('Production renderer did not install authored A71 geometry');
  const identity = {
    geometry: shell.geometry,
    position: shell.geometry.getAttribute('position'),
    index: shell.geometry.index,
  };
  const observedCounts = new Set<number>();
  const before = shell.onBeforeRender;
  shell.onBeforeRender = function (...args) {
    before.apply(this, args);
    observedCounts.add(this.geometry.drawRange.count);
  };
  const site = view.venueLighting.landmarkSite;
  const gl = view.renderer.getContext(),
    pixels = new Uint8Array(width * height * 4);
  const ledger = attachDrawLedger(view.renderer);
  const images: {
    name: string;
    image: string;
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
    { name: 'entrance', x: 12, y: 3, z: 32, targetY: 2.4, fov: 48 },
    { name: 'whole-hall', x: 56, y: 24, z: 69, targetY: 16, fov: 48 },
    { name: 'mid', x: 0, y: 30, z: 260, targetY: 17, fov: 58 },
    { name: 'far', x: 0, y: 40, z: 600, targetY: 17, fov: 58 },
    { name: 'telephoto', x: 0, y: 40, z: 600, targetY: 17, fov: 10 },
  ];
  const cut = (c: (typeof cuts)[number]) => {
    const sin = Math.sin(site.yaw),
      cos = Math.cos(site.yaw);
    view.camera.position.set(
      site.x + cos * c.x + sin * c.z,
      site.deckY + c.y,
      site.z - sin * c.x + cos * c.z,
    );
    view.camera.fov = c.fov;
    view.camera.lookAt(site.x, site.deckY + c.targetY, site.z);
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
  const capture = (name: string) => {
    render();
    let min = 255,
      max = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    images.push({
      name,
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      range: max - min,
      passes: ledger.snapshot(),
    });
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    view.draw(frame, frame, 1, 1 / 60);
    const cockpit = {
      name: 'normal-cockpit',
      image: canvas.toDataURL('image/png'),
      stats: view.stats(),
    };
    // Both directions and optical scales are warmed before the closed cycle.
    const sequence = [...cuts, ...[...cuts].reverse()];
    for (let pass = 0; pass < 2; pass++)
      for (const c of sequence) {
        cut(c);
        render();
      }
    const memoryBefore = memory(),
      memories: ReturnType<typeof memory>[] = [];
    observedCounts.clear();
    for (const c of sequence) {
      cut(c);
      render();
      memories.push(memory());
    }
    for (const c of cuts) {
      cut(c);
      capture(c.name);
    }
    const frameUnchanged = frame.every((v, i) => Object.is(v, original[i]));
    const waterUnchanged = water.every((v, i) => v === sim.track.water[i]);
    // Spaced moving captures are rendering evidence, NOT a continuous human lap
    // or a representative-hardware benchmark. No state/position injection.
    const driving: { station: number; time: number; image: string }[] = [];
    let previous = frame,
      last = -Infinity,
      completed = false;
    const entry = site.s - 100,
      exit = site.s + 110;
    while (sim.makeFrame()[H.TIME] < 180) {
      for (let i = 0; i < 60; i++) sim.step(1 / 120);
      const current = sim.makeFrame().slice(),
        station = sim.cars[0].s;
      if (station >= entry && station <= exit && station - last >= 40) {
        view.mode = 'cockpit';
        view.draw(previous, current, 1, 0.5);
        driving.push({ station, time: current[H.TIME], image: canvas.toDataURL('image/png') });
        last = station;
      }
      previous = current;
      if (driving.length > 0 && station > exit) {
        completed = true;
        break;
      }
    }
    return {
      lighting,
      asset: EVENT_HALL_ASSET,
      site,
      images,
      cockpit,
      driving,
      driveCompleted: completed,
      frameUnchanged,
      waterUnchanged,
      memoryBefore,
      memories,
      observedCounts: [...observedCounts].sort((a, b) => b - a),
      identitiesUnchanged:
        shell.geometry === identity.geometry &&
        shell.geometry.index === identity.index &&
        shell.geometry.getAttribute('position') === identity.position,
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      acceptance: { finalArt: false, humanLap: false, hardwarePerformance: false },
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
