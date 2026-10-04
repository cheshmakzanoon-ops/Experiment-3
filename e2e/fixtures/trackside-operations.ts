import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { graphicsPreset } from '../../src/rendering/options.ts';
import { lightingDirection } from '../../src/rendering/daylight.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { FLAG } from '../../src/simulation/marshal.ts';
import { postSignal } from '../../src/rendering/marshal-staff.ts';
import { trackBoardPlan, trackBoardMatrix } from '../../src/rendering/track-board-plan.ts';
const signalHardwareMatrix = (
  s: { yaw: number; side: number; x: number; y: number; z: number },
  mirror = true,
) =>
  new T.Matrix4()
    .makeRotationY(s.yaw)
    .scale(new T.Vector3(mirror ? s.side : 1, 1, 1))
    .setPosition(s.x, s.y, s.z);
import { timingSensorPlan } from '../../src/rendering/track-signal-plan.ts';
import {
  cameraHardwareMatrix,
  cameraTowerMatrix,
  cameraHardwareHeight,
} from '../../src/rendering/broadcast-camera-placement.ts';
import { tracksideRigs, tracksideFraming } from '../../src/rendering/trackside.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import { H, F, carBase } from '../../src/simulation/protocol.ts';
import { detailDistance } from '../../src/rendering/view-detail.ts';
import { attachDrawLedger, type DrawBreakdown } from '../../src/rendering/draw-ledger.ts';

/** Uses the complete production factory. Fixed survey cameras are supplementary;
 * the normal cockpit render below retains the compositor, mirrors and car grid. */
export async function surveyTracksideOperations(lighting: 'day' | 'sunset' | 'night') {
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
  document.body.style.cssText = 'margin:0';
  canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
  document.body.append(canvas);
  const graphics = { ...graphicsPreset('medium'), resolutionScale: 1 };
  console.info('[operations] production factory');
  const view = await RacingRenderer.create(
    canvas,
    sim.track,
    () => {},
    () => false,
    { quality: 'medium', graphics },
  );
  if (!view) throw new Error('Unexpectedly cancelled infrastructure factory');
  const gl = view.renderer.getContext();
  const pixels = new Uint8Array(width * height * 4),
    blanked = new Uint8Array(pixels.length);
  const kitNames = [
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
  ] as const;
  const kits = kitNames.map((name) => view.circuit[name]);
  const images: {
    name: string;
    image: string;
    calls: number;
    triangles: number;
    lit: number;
    range: number;
    changed: number | null;
    peakDelta: number | null;
    passes: DrawBreakdown | null;
  }[] = [];
  const update = (f = frame) => {
    view.circuit.update(f);
    for (const kit of kits) kit?.update(view.camera, 'medium');
    // A fixed inspection camera is a real view cut. Refresh the same authored
    // equipment and rival representations as RacingRenderer.draw AFTER the cut;
    // otherwise the preceding cockpit's near LODs remain in these distant views.
    view.circuit.heroGarage?.update(view.camera, 'medium', lighting);
    view.tyreEquipment?.update(view.camera, 'medium');
    view.wheelGunStorage?.update(view.camera);
    view.circuit.tyreBlankets?.update(view.camera, 'medium', lighting);
    if (view.circuit.heroGarage)
      view.circuit.tyreBlankets?.alignGarageWheels(view.circuit.heroGarage.spareWheelStorage);
    view.circuit.pitBuildingFrontage?.update(view.camera, 'medium', lighting);
    view.circuit.pitWallStation?.update(view.camera, 'medium', lighting, f, 'HELD', true);
    for (let id = 0; id < f[H.CARS]; id++) {
      const base = carBase(id);
      const followed = id === view.reviewCar();
      const distance = new T.Vector3(f[base + F.X], f[base + F.Y], f[base + F.Z]).distanceTo(
        view.camera.position,
      );
      view.cars[id].setLod(
        followed ? 0 : detailDistance(distance, view.camera.fov, view.camera.aspect),
        'medium',
        followed,
      );
      // Frozen snapshots and zero presentation dt: no invented vehicle motion.
      // External inspection views must restore the driver hidden by cockpit mode.
      view.cars[id].update(f, f, base, 1, 0, f[H.TIME], false);
    }
    view.circuit.startFinish?.update(f, view.camera, lighting === 'night');
    view.circuit.staff.update(f, view.camera.position, true);
    for (const crowd of view.circuit.crowdClusters)
      crowd.update(
        f[H.TIME],
        view.camera.position,
        f[H.RAIN],
        f,
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
  // A direct WebGL render also submits shadow maps. Observe both passes;
  // never suppress shadows to make the inspection appear less expensive.
  const inspectionLedger = attachDrawLedger(view.renderer);
  const render = () => {
    view.renderer.info.reset();
    inspectionLedger.begin();
    view.renderer.render(view.scene, view.camera);
    inspectionLedger.end();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  };
  const capture = (name: string, root?: T.Group) => {
    console.info('[operations] capture', name);
    render();
    const image = canvas.toDataURL('image/png');
    const calls = view.renderer.info.render.calls,
      triangles = view.renderer.info.render.triangles;
    const passes = inspectionLedger.snapshot();
    let min = 255,
      max = 0,
      lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v > 2) lit++;
    }
    let changed: number | null = null,
      peakDelta: number | null = null;
    if (root) {
      blanked.set(pixels);
      const visible = root.visible;
      try {
        root.visible = false;
        render();
      } finally {
        root.visible = visible;
      }
      changed = 0;
      peakDelta = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const delta = Math.max(
          Math.abs(pixels[i] - blanked[i]),
          Math.abs(pixels[i + 1] - blanked[i + 1]),
          Math.abs(pixels[i + 2] - blanked[i + 2]),
        );
        if (delta > 12) changed++;
        peakDelta = Math.max(peakDelta, delta);
      }
      render();
    }
    images.push({
      name,
      image,
      calls,
      triangles,
      lit: lit / (width * height),
      range: max - min,
      changed,
      peakDelta,
      passes,
    });
  };
  try {
    view.lighting = lighting;
    view.mode = 'cockpit';
    view.draw(frame, frame, 1, 1 / 60);
    const normalStats = view.stats();
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = 255,
      max = 0,
      lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v > 2) lit++;
    }
    images.push({
      name: 'normal-cockpit',
      image: canvas.toDataURL('image/png'),
      calls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      lit: lit / (width * height),
      range: max - min,
      changed: null,
      peakDelta: null,
      passes: null,
    });
    const posts = view.circuit.trackInfrastructure.marshalPosts,
      utilities = view.circuit.trackInfrastructure.utilities;
    const sensors = timingSensorPlan(sim.track),
      boards = trackBoardPlan(sim.track),
      sites = view.circuit.trackInfrastructure.cameras;
    const first = boards.find((s) => s.text === '150')!,
      sector = boards.find((s) => s.text === 'S1')!;
    const local = (site: Parameters<typeof signalHardwareMatrix>[0], p: number[], mirror = true) =>
      new T.Vector3().fromArray(p).applyMatrix4(signalHardwareMatrix(site, mirror));
    const board = (site: typeof first, p: number[]) =>
      new T.Vector3().fromArray(p).applyMatrix4(trackBoardMatrix(site));
    const head = (i: number, p: number[]) =>
      new T.Vector3().fromArray(p).applyMatrix4(cameraHardwareMatrix(sites[i]));
    const tower = (i: number, p: number[]) =>
      new T.Vector3().fromArray(p).applyMatrix4(cameraTowerMatrix(sites[i]));
    const shots = [
      {
        name: 'A08-live-panel-housing',
        eye: local(posts[0], [-3.1, 2.15, -2.1]),
        target: local(posts[0], [-1.3, 1.85, 0]),
        fov: 58,
        root: view.circuit.signalHardware?.root,
      },
      {
        name: 'A08-rear-connectors',
        eye: local(posts[0], [0.2, 2.2, 1.1]),
        target: local(posts[0], [-1.2, 1.7, 0]),
        fov: 60,
        root: view.circuit.signalHardware?.root,
      },
      {
        name: 'A08-service-cabinet',
        eye: local(utilities[0], [1.3, 1.4, -2], false),
        target: local(utilities[0], [0, 0.7, 0], false),
        fov: 58,
        root: view.circuit.signalHardware?.root,
      },
      {
        name: 'A08-split-sensor',
        eye: local(sensors[1], [-1.3, 1.5, -1.2]),
        target: local(sensors[1], [0, 1.05, 0]),
        fov: 56,
        root: view.circuit.signalHardware?.root,
      },
      {
        name: 'A09-braking-approach',
        eye: view.circuit.at(first.s - 40, -2.2, 0.65),
        target: board(first, [0, 2.2, 0]),
        fov: 58,
        root: view.circuit.trackBoards?.root,
      },
      {
        name: 'A09-printed-face',
        eye: board(first, [1.5, 2.4, 2.5]),
        target: board(first, [0, 2.2, 0]),
        fov: 55,
        root: view.circuit.trackBoards?.root,
      },
      {
        name: 'A09-back-and-foot',
        eye: board(first, [1.8, 1.2, -2]),
        target: board(first, [0, 0.9, 0]),
        fov: 58,
        root: view.circuit.trackBoards?.root,
      },
      {
        name: 'A09-sector-board',
        eye: board(sector, [-1.3, 2.4, 3]),
        target: board(sector, [0, 2, 0]),
        fov: 56,
        root: view.circuit.trackBoards?.root,
      },
      {
        name: 'A10-dry-camera',
        eye: head(1, [-1.4, 0.6, -1.5]),
        target: head(1, [0, -0.1, 0.7]),
        fov: 56,
        root: view.circuit.broadcastCameras?.root,
      },
      {
        name: 'A10-rain-cover',
        eye: head(0, [1.2, -0.1, -1.7]),
        target: head(0, [0, -0.45, 0.75]),
        fov: 58,
        root: view.circuit.broadcastCameras?.root,
      },
      {
        name: 'A10-platform-entry',
        eye: tower(6, [2.4, cameraHardwareHeight(sites[6]) - 0.8, 1.8]),
        target: tower(6, [0.9, cameraHardwareHeight(sites[6]) - 1, 0.65]),
        fov: 58,
        root: view.circuit.broadcastCameras?.root,
      },
    ];
    const place = (eye: T.Vector3, target: T.Vector3, fov: number) => {
      view.camera.position.copy(eye);
      view.camera.lookAt(target);
      view.camera.fov = fov;
      view.camera.updateProjectionMatrix();
      // This camera is not parented to scene. CPU projections before render
      // must use this view, not the previous inspection camera transform.
      view.camera.updateMatrixWorld(true);
      update();
    };
    for (const shot of shots) {
      place(shot.eye, shot.target, shot.fov);
      capture(shot.name, shot.root);
    }
    // An existing optical origin, not a replacement replay director or a fake TV feed.
    const rig = tracksideRigs(sim.track)[0],
      q = sim.track.at(rig.centerS + rig.coverageM * 0.4, trackPoint());
    const target = new T.Vector3(q.x - 2.2 * q.nx, q.y + 0.75, q.z - 2.2 * q.nz);
    place(
      rig.position,
      target,
      tracksideFraming(target.distanceTo(rig.position), rig.baseFov, 16 / 9).fov,
    );
    capture('A10-original-optical-view');

    // An explicit incident fixture runs production race control. Render frames
    // are never patched to manufacture a yellow; this is not an unassisted lap.
    const witness = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      opponents: 2,
      weather: 'clear',
      seed: 1887,
    });
    witness.race.time += 10;
    witness.cars[0].place(witness.track, posts[0].s + 1);
    witness.cars[0].speed = 40;
    witness.cars[1].place(witness.track, posts[0].s + 101);
    witness.cars[1].speed = 20;
    witness.cars[1].impact = 0.9;
    witness.cars[2].place(witness.track, 1800);
    witness.cars[2].speed = 40;
    witness.race.step(0.01);
    const yellow = witness.makeFrame().slice();
    if (postSignal(yellow, posts[0].s) !== FLAG.YELLOW)
      throw new Error('Production race control did not produce the incident witness');
    const displays = view.circuit.signalHardware?.displays;
    let signalEvidence: {
      sequence: number[];
      gain: number;
      unchanged: boolean;
      independent: boolean;
    } | null = null;
    if (displays) {
      const pane = displays.meshes[0];
      place(local(posts[0], [-3.6, 1.9, 0]), local(posts[0], [-1.42, 1.85, 0]), 40);
      view.scene.updateMatrixWorld(true);
      const centre = pane.getWorldPosition(new T.Vector3()).project(view.camera);
      const px = Math.round(((centre.x + 1) * width) / 2),
        py = Math.round(((centre.y + 1) * height) / 2);
      if (px < 4 || px >= width - 4 || py < 4 || py >= height - 4)
        throw new Error('Live panel outside observation');
      const red = () => {
        let n = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) n += pixels[((py + dy) * width + px + dx) * 4];
        return n / 49;
      };
      view.circuit.update(frame);
      render();
      const off = red();
      const saved = yellow.slice();
      view.circuit.update(yellow);
      render();
      const gain = red() - off;
      capture('A08-production-yellow');
      const independent =
        displays.meshes[1].material === displays.materials[postSignal(yellow, posts[1].s)];
      const sequence = [];
      for (const f of [frame, yellow, yellow, frame, yellow, frame]) {
        view.circuit.update(f);
        const flag = postSignal(f, posts[0].s);
        sequence.push(flag);
        if (pane.material !== displays.materials[flag])
          throw new Error('Panel disagrees with its recorded local witness');
      }
      signalEvidence = {
        sequence,
        gain,
        unchanged: saved.every((v, i) => v === yellow[i]),
        independent,
      };
    }
    update();
    render();
    const memoryBefore = { ...view.renderer.info.memory },
      held = pixels.slice();
    for (let i = 0; i < 4; i++) {
      update();
      render();
    }
    let heldMaxDelta = 0;
    for (let i = 0; i < pixels.length; i++)
      heldMaxDelta = Math.max(heldMaxDelta, Math.abs(pixels[i] - held[i]));
    const memoryAfter = { ...view.renderer.info.memory };
    const detail = view.circuit.infrastructureDiagnostics();
    view.camera.position.addScalar(3000);
    for (const kit of kits) kit?.update(view.camera, 'medium');
    const far = kits.slice(-3).map((k) => k?.diagnostics() ?? null);
    return {
      lighting,
      configuration: {
        width,
        height,
        quality: 'medium',
        cars: frame[H.CARS],
        seed: 1887,
        time: frame[H.TIME],
        graphics,
      },
      images,
      signalEvidence,
      normalStats,
      detail,
      far,
      memoryBefore,
      memoryAfter,
      heldMaxDelta,
      sourceUnchanged: original.every((v, i) => v === frame[i]),
      waterUnchanged: water.every((v, i) => v === sim.track.water[i]),
      glError: gl.getError(),
      contextLost: gl.isContextLost(),
      scope:
        'Complete production asset factory and twelve-car cockpit, fixed inspections and explicit production race-control incident fixture; not hardware FPS or human full-lap approval.',
    };
  } finally {
    view.dispose();
    canvas.remove();
  }
}
