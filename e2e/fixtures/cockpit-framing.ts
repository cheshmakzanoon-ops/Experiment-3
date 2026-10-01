import * as T from 'three';
import { RacingRenderer } from '../../src/rendering/renderer.ts';
import { Simulation } from '../../src/simulation/world.ts';
import { controls, DEFAULT_OPTIONS } from '../../src/simulation/config.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../../src/simulation/protocol.ts';
import { captureRenderedCanvas } from '../../src/rendering/frame-capture.ts';
import { COCKPIT_FRAMING } from '../../src/rendering/cockpit-framing.ts';

export interface CockpitSurveyRow {
  name: string;
  width: number;
  height: number;
  time: number;
  speed: number;
  steer: number;
  g: number[];
  rain: number;
  lighting: string;
  surface: number[];
  visual: Pick<
    ReturnType<RacingRenderer['visualDiagnostics']>,
    'screenVisible' | 'wheelProjection' | 'suppliedPlayer'
  >;
  camera: { localEye: number[]; fov: number; position: number[]; rotation: number[] };
  nearIntersections: { x: number; y: number; distance: number; object: string }[];
  roadSightlines: boolean[];
  calls: number;
  triangles: number;
  resources: { textures: number; geometries: number };
  image: string;
}

/** Production loader, original binary/skeleton, full circuit and unmodified
 * simulation snapshots. These are real GPU frames, not a target-hardware FPS test. */
export async function cockpitFramingSurvey(
  group: 'framing' | 'controls' | 'driving' | 'braking' | 'weather',
  onRow?: (row: CockpitSurveyRow) => Promise<void>,
) {
  const simulation = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px';
  document.body.append(canvas);
  const renderer = await RacingRenderer.create(
    canvas,
    simulation.track,
    () => {},
    () => false,
  );
  if (!renderer) throw new Error('Renderer cancelled');
  renderer.setQuality('medium');
  renderer.changeCamera('cockpit');
  renderer.shake = 1;
  const player = renderer.cars[0].suppliedPlayer!;
  const sourceEye = player.eye.toArray();
  const o = carBase(0);
  const rows: CockpitSurveyRow[] = [];
  const inputs: { frame: Float32Array; copy: Float32Array }[] = [];
  const capture = async (
    name: string,
    frame: Float32Array,
    width = 1280,
    height = 720,
    replay = false,
  ) => {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    renderer.resize();
    inputs.push({ frame, copy: frame.slice() });
    renderer.draw(frame, frame, 1, 1 / 60, false, replay, 1 / 60);
    const image = await captureRenderedCanvas(canvas);
    const encoded = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(image);
    });
    const car = renderer.cars[0],
      camera = renderer.camera;
    const visibleHit = (hit: T.Intersection) => {
      for (let n: T.Object3D | null = hit.object; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    // Each near-plane ray is measured along its own corner/edge distance,
    // including ultrawide aspect. Intersections beyond the near plane are valid.
    const nearIntersections = [];
    for (const x of [-1, 0, 1])
      for (const y of [-1, 0, 1]) {
        const point = new T.Vector3(x, y, -1).unproject(camera);
        const distance = point.distanceTo(camera.position);
        const ray = new T.Raycaster(
          camera.position,
          point.sub(camera.position).normalize(),
          0.001,
          distance,
        );
        const hit = ray.intersectObject(car.root, true).find(visibleHit);
        if (hit) nearIntersections.push({ x, y, distance: hit.distance, object: hit.object.name });
      }
    const roadSightlines = [-0.35, -0.18, 0.18, 0.35].map((x) => {
      const ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(x, 0), camera);
      ray.far = 3;
      return !ray.intersectObject(car.root, true).some(visibleHit);
    });
    const visual = renderer.visualDiagnostics(),
      stats = renderer.stats();
    const row = {
      name,
      width,
      height,
      time: frame[H.TIME],
      speed: frame[o + F.SPEED],
      steer: frame[o + F.STEER],
      g: [frame[o + F.G_LAT], frame[o + F.G_LONG], frame[o + F.G_VERT]],
      rain: frame[H.RAIN],
      lighting: renderer.lighting,
      surface: [0, 1, 2, 3].map((i) => frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.SURFACE]),
      visual: {
        screenVisible: visual.screenVisible,
        wheelProjection: visual.wheelProjection,
        suppliedPlayer: visual.suppliedPlayer,
      },
      camera: {
        localEye: stats.cameraLocalPosition,
        fov: camera.fov,
        position: camera.position.toArray(),
        rotation: camera.quaternion.toArray(),
      },
      nearIntersections,
      roadSightlines,
      calls: stats.drawCalls,
      triangles: stats.triangles,
      resources: { textures: stats.textures, geometries: stats.geometries },
      image: encoded,
    };
    rows.push(row);
    await onRow?.(row);
    return row;
  };
  try {
    for (let i = 0; i < 120; i++) simulation.step(1 / 120);
    const neutral = simulation.makeFrame();
    if (group === 'framing') {
      for (const [label, width, height] of [
        ['16-9', 1280, 720],
        ['4-3', 1024, 768],
        ['16-10', 1440, 900],
        ['21-9', 1680, 720],
      ] as const)
        await capture(`neutral-${label}`, neutral, width, height);
    }
    if (group === 'controls') {
      simulation.setInput({ ...controls(), steer: 1, brake: 1 });
      for (let i = 0; i < 120; i++) simulation.step(1 / 120);
      await capture('left-lock', simulation.makeFrame());
      simulation.setInput({ ...controls(), steer: -1, brake: 1 });
      for (let i = 0; i < 120; i++) simulation.step(1 / 120);
      const right = simulation.makeFrame();
      await capture('right-lock', right);
      await capture('paused', right);
      await capture('rewound', neutral, 1280, 720, true);
    }
    if (group === 'driving' || group === 'braking') {
      // The same deterministic 24 s drive. Each frame costs seconds under
      // software GL, so 'driving' renders the drive and its moving frame and
      // 'braking' renders the stop and the kerb strike from the same state.
      simulation.autoPlayer = true;
      for (let i = 0; i < 120 * 24; i++) {
        simulation.step(1 / 120);
        if (group === 'driving' && i % 240 === 239) {
          const frame = simulation.makeFrame();
          renderer.draw(frame, frame, 1, 1 / 60, false, false, 1 / 60);
        }
      }
      if (group === 'driving') await capture('moving', simulation.makeFrame());
    }
    if (group === 'braking') {
      simulation.autoPlayer = false;
      simulation.setInput({ ...controls(), brake: 1 });
      for (let i = 0; i < 45; i++) {
        simulation.step(1 / 120);
        const frame = simulation.makeFrame();
        if (i % 15 === 14) renderer.draw(frame, frame, 1, 1 / 60, false, false, 1 / 60);
      }
      await capture('braking', simulation.makeFrame());
      const kerbSim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', opponents: 0 });
      let kerb: Float32Array | null = null;
      for (let i = 0; i < 120 * 12; i++) {
        const speed = kerbSim.cars[0].speed;
        kerbSim.setInput({
          ...controls(),
          throttle: Math.max(0, Math.min(0.6, (12 - speed) * 0.15)),
          brake: Math.max(0, Math.min(0.6, (speed - 12) * 0.15)),
          steer: i > 360 ? -0.09 : 0,
        });
        kerbSim.step(1 / 120);
        const frame = kerbSim.makeFrame();
        if ([0, 1, 2, 3].some((i) => frame[o + WHEEL_BASE + i * WHEEL_STRIDE + W.SURFACE] === 2)) {
          kerb = frame;
          break;
        }
      }
      if (!kerb) throw new Error('No actual kerb contact in P0 drive');
      await capture('kerb-contact', kerb);
    }
    if (group === 'weather') {
      renderer.lighting = 'sunset';
      await capture('sunset', neutral);
      renderer.lighting = 'night';
      await capture('night', neutral);
      const wet = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        opponents: 0,
        weather: 'rain',
        compound: 'wet',
      });
      wet.autoPlayer = true;
      for (let i = 0; i < 120 * 6; i++) wet.step(1 / 120);
      renderer.circuit.updateSurface(wet.track.water, wet.track.rubber, wet.track.marbles);
      await capture('wet-night', wet.makeFrame());
      renderer.changeCamera('pod');
      await capture('pod-retained', neutral);
    }
    return {
      group,
      rows,
      calibration: COCKPIT_FRAMING,
      sourceEye,
      sourceEyeRetained: player.eye.toArray().every((v, i) => v === sourceEye[i]),
      sourceFramesUnchanged: inputs.every(({ frame, copy }) =>
        frame.every((v, i) => v === copy[i]),
      ),
      glError: renderer.renderer.getContext().getError(),
    };
  } finally {
    renderer.dispose();
  }
}
