import { Color } from 'three';
import { Interface } from '../../src/ui/interface.ts';
import { SURFACE, Track, trackPoint } from '../../src/simulation/track.ts';
import { VEHICLES } from '../../src/simulation/vehicles.ts';
import { bikeSlipstreamDragScale } from '../../src/simulation/bike-slipstream.ts';
import { menuPreview } from '../../src/rendering/menu-preview.ts';
import { PresentedFrame } from '../../src/rendering/frame-state.ts';
import { circuitDefinition } from '../../src/simulation/circuits.ts';
import { gpPracticeCorners } from '../../src/ui/gp-corner-practice.ts';
import { mod } from '../../src/core/math.ts';
import {
  B,
  BIKE_BASE,
  F,
  H,
  R,
  RACE_BASE,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../../src/simulation/protocol.ts';
import type { CameraMode, RacingRenderer } from '../../src/rendering/renderer.ts';

let ui: Interface;
let track: Track;
let lastPreview = '';

/** Production DOM and styles with explicit synthetic telemetry. This fixture
 * verifies layout/state restoration, not rendered scenery or gameplay. */
export function mountMotorcycleHud() {
  const root = document.createElement('main');
  root.id = 'app';
  document.body.replaceChildren(root);
  track = new Track();
  const noop = () => {};
  ui = new Interface(root, track, {
    action: noop,
    start: noop,
    apply: noop,
    seek: noop,
    replaySpeed: noop,
    exportSetup: noop,
    importSetup: noop,
    previewMachine: (id) => {
      lastPreview = id;
    },
  });
  ui.ready();
  const notice = document.createElement('p');
  notice.textContent = 'INTERFACE LAYOUT CHECK · SYNTHETIC TELEMETRY · NO 3D SCENE';
  notice.style.cssText =
    'position:fixed;bottom:3px;left:4px;font:10px monospace;color:#a9b7bf;pointer-events:none';
  document.body.append(notice);
}

export interface HudSnapshot {
  time: number;
  speed: number;
  gear: number;
  rpm: number;
  lean: number;
  station: number;
  lateral: number;
  tow: number;
  frontSurface: number;
  rearSurface: number;
  frontWater: number;
  rearWater: number;
  frontDisc: number;
  intervention: number;
  flag: number;
  throttle: number;
  brake: number;
  rearBrake: number;
}

function motorcycleHudFrame(machine = 'gpr1', fallen = false, snapshot: Partial<HudSnapshot> = {}) {
  const frame = menuPreview(track, snapshot.station ?? track.length - 32, machine),
    o = carBase(0);
  frame[H.PHASE] = 2;
  frame[H.TIME] = snapshot.time ?? (fallen ? 30 : 20);
  frame[H.TICK] = Math.round(frame[H.TIME] * 120);
  frame[o + F.SPEED] = snapshot.speed ?? 45;
  frame[o + F.GEAR] = snapshot.gear ?? 4;
  frame[o + F.RPM] = snapshot.rpm ?? 11340;
  frame[o + F.THROTTLE] = snapshot.throttle ?? 0.6;
  frame[o + F.BRAKE] = snapshot.brake ?? 0.25;
  frame[o + F.FUEL] = 12.4;
  frame[o + F.LAP_TIME] = 48.271;
  frame[o + F.LAP_VALID] = 1;
  frame[o + F.RANK] = 1;
  frame[o + F.LATERAL] = snapshot.lateral ?? 0;
  frame[o + BIKE_BASE + B.LEAN] = snapshot.lean ?? 0.72;
  frame[o + BIKE_BASE + B.REAR_BRAKE] = snapshot.rearBrake ?? 0.35;
  frame[o + BIKE_BASE + B.TUCK] = 0.8;
  frame[o + BIKE_BASE + B.INTERVENTION] = snapshot.intervention ?? (fallen ? 0.6 : 0.18);
  frame[o + F.LOCAL_FLAG] = snapshot.flag ?? 0;
  frame[o + RACE_BASE + R.NEXT_COMPOUND] = -1;
  frame[o + BIKE_BASE + B.STATE] = fallen ? 3 : 0;
  // A coherent velocity enables the production corner/draft readout in the
  // responsive-layout checks instead of silently hiding it behind a zero
  // velocity paired with a nonzero speedometer.
  const road = track.at(frame[o + F.S], trackPoint()),
    speed = frame[o + F.SPEED];
  frame[o + F.VX] = speed * road.tx;
  frame[o + F.VZ] = speed * road.tz;
  const bike = VEHICLES[machine]?.bike;
  if (bike)
    frame[o + F.DRAG] =
      bike.drag * speed ** 2 * bikeSlipstreamDragScale(0.8, bike.tuckDrag, snapshot.tow ?? 0);
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    frame[p + W.CARCASS_TEMP] = wheel < 2 ? 83 : 96;
    frame[p + W.WEAR] = wheel < 2 ? 0.08 : 0.13;
    frame[p + W.SURFACE] =
      (wheel < 2 ? snapshot.frontSurface : snapshot.rearSurface) ?? SURFACE.ASPHALT;
    frame[p + W.WATER] = (wheel < 2 ? snapshot.frontWater : snapshot.rearWater) ?? 0;
    frame[p + W.DISC_TEMP] = wheel < 2 ? (snapshot.frontDisc ?? 500) : 200;
  }
  // Deliberately poison redundant copies: a bike displays its actual front/rear.
  frame[o + WHEEL_BASE + WHEEL_STRIDE + W.CARCASS_TEMP] = 1;
  frame[o + WHEEL_BASE + WHEEL_STRIDE * 3 + W.CARCASS_TEMP] = 2;
  return frame;
}

function hudRenderer(camera: CameraMode = 'chase') {
  return {
    mode: camera,
    debug: false,
    cars: [{ paint: { color: new Color(0xe45d40) } }],
  } as unknown as RacingRenderer;
}

export function showMotorcycleHud(
  machine = 'gpr1',
  camera: CameraMode = 'chase',
  fallen = false,
  snapshot: Partial<HudSnapshot> = {},
  control: 'human' | 'ai' | 'replay' = 'human',
) {
  const frame = motorcycleHudFrame(machine, fallen, snapshot);
  ui.showMode(control === 'replay' ? 'replay' : 'driving');
  ui.observePractice(frame, control === 'ai');
  // One call represents one presented snapshot. Repeating it to satisfy a
  // panel throttle would hide stale instruments at a low rendering cadence.
  ui.update(frame, hudRenderer(camera), control === 'ai', 1);
}

export function beginGpPractice() {
  track = new Track('clear', false, undefined, circuitDefinition('poggio-alto'));
  ui.setTrack(track);
  ui.options.mode = 'practice';
  ui.options.assist = 'sport';
  return gpPracticeCorners(track)[0].length;
}

export function restartGpPractice() {
  // Exercise the real session-entry hook without constructing a new Track.
  ui.loadingSession(ui.options);
  ui.loadingSession(null);
}

export function showGpPracticeRun(
  start = 1,
  speed = 40,
  complete = true,
  control: 'human' | 'ai' | 'replay' = 'human',
) {
  const corner = gpPracticeCorners(track)[0],
    end = complete ? corner.length + 5 : corner.apex;
  const sample = (distance: number) =>
    showMotorcycleHud(
      'gpr1',
      'chase',
      false,
      {
        station: mod(corner.from + distance, track.length),
        time: start + (distance + 5) / speed,
        speed,
        brake: 0,
        rearBrake: 0,
        intervention: 0,
      },
      control,
    );
  for (let d = -5; d < end; d += 8) sample(d);
  sample(end);
}

/** The same worker samples with different graphics cadences. The production
 * presentation interpolates its clock while station stays a discrete channel,
 * so feeding these visual frames back into timing would change the result. */
export function showGpPracticeCadence(hz: number, start: number) {
  const corner = gpPracticeCorners(track)[0],
    speed = 40,
    duration = (corner.length + 12) / speed,
    frames = Array.from({ length: Math.ceil(duration * 60) + 2 }, (_, tick) =>
      motorcycleHudFrame('gpr1', false, {
        time: start + tick / 60,
        station: mod(corner.from - 5 + (speed * tick) / 60, track.length),
        speed,
        brake: 0,
        rearBrake: 0,
        intervention: 0,
      }),
    ),
    presented = new PresentedFrame(),
    renderer = hudRenderer();
  ui.showMode('driving');
  let next = 0,
    presentations = 0;
  for (let time = 0; time < duration; time += 1 / hz) {
    const tick = Math.floor(time * 60);
    // Every original frame is observed even when graphics skip several of
    // them, exactly as main.accept() does before presentation interpolation.
    while (next <= tick + 1) ui.observePractice(frames[next++], false);
    ui.update(
      presented.sample(frames[tick], frames[tick + 1], time * 60 - tick),
      renderer,
      false,
      1,
    );
    presentations++;
  }
  return {
    time: ui.get('gpPracticeTime').textContent,
    label: ui.get('gpPracticeLabel').textContent,
    detail: ui.get('gpPracticeDetail').textContent,
    visible: !ui.get('gpPractice').hidden,
    observations: next,
    presentations,
  };
}

export function showGpPracticeHandoff(kind: 'ai' | 'replay' | 'pause') {
  restartGpPractice();
  const corner = gpPracticeCorners(track)[0];
  let changed = false;
  for (let distance = -5; distance <= corner.length + 8; distance += 8) {
    if (!changed && distance > corner.apex) {
      changed = true;
      // Both changes occur between observations; a model which only learns
      // the final context from the next snapshot would miss the handoff.
      if (kind === 'ai') {
        ui.setPracticeDriver(true);
        ui.setPracticeDriver(false);
      } else {
        ui.showMode(kind === 'replay' ? 'replay' : 'paused');
        ui.showMode('driving');
      }
    }
    showMotorcycleHud('gpr1', 'chase', false, {
      time: 1 + (distance + 5) / 40,
      station: mod(corner.from + distance, track.length),
      speed: 40,
      brake: 0,
      rearBrake: 0,
      intervention: 0,
    });
  }
}

export function showGpCornerCase(exit = false) {
  showMotorcycleHud('gpr1', 'chase', false, {
    station: track.circuit.corners[0].s + (exit ? 12 : -80),
    lean: 0.3,
    // A coast-to-power exit actually releases the two independent brakes.
    // A held front lever must keep showing braking after the apex as well.
    brake: exit ? 0 : 0.25,
    rearBrake: exit ? 0 : 0.35,
  });
}

export function showGpBendCase(offset: number, snapshot: Partial<HudSnapshot> = {}) {
  showMotorcycleHud('gpr1', 'chase', false, {
    station: track.circuit.corners[0].s + offset,
    lean: 0.65,
    throttle: 0.35,
    brake: 0,
    rearBrake: 0,
    ...snapshot,
  });
}

export function showMotorcycleMenu() {
  ui.showMode('menu');
}
export function previewSelection() {
  return lastPreview;
}
