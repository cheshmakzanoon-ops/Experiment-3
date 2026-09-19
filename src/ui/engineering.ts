import { clamp } from '../core/math.ts';
import { F, H, W, WHEEL_BASE, WHEEL_STRIDE, WHEEL_NAMES, carBase } from '../simulation/protocol.ts';
import { engineeringFresh, type EngineeringSample } from '../workers/diagnostics.ts';

interface RenderMetrics {
  fps: number;
  frameMs: number;
  p1FPS: number;
  renderCPUms: number;
  drawCalls: number;
  triangles: number;
  gpuMilliseconds: number | null;
  gpuTimerSupported: boolean;
}
const MATERIAL = ['ASPHALT', 'PAINT', 'KERB', 'GRASS', 'GRAVEL', 'PIT'];
const degrees = 180 / Math.PI;
/** All requested engineering categories. Snapshot and optional probe timestamps
 * stay explicit; never substitute the live AI/contact record into a replay. */
export function engineeringReport(
  frame: Float32Array,
  render: RenderMetrics,
  sample: EngineeringSample | null,
  replay = false,
) {
  const o = carBase(0),
    x = frame[o + F.QX],
    y = frame[o + F.QY],
    z = frame[o + F.QZ],
    w = frame[o + F.QW];
  const upX = 2 * (x * y - w * z),
    upY = 1 - 2 * (x * x + z * z),
    upZ = 2 * (y * z + w * x);
  const noseY = 2 * (y * z - w * x),
    leftY = 2 * (x * y + w * z);
  const pitch = Math.asin(clamp(noseY, -1, 1)) * degrees,
    roll = Math.atan2(leftY, upY) * degrees,
    yawRate = (frame[o + F.WX] * upX + frame[o + F.WY] * upY + frame[o + F.WZ] * upZ) * degrees;
  const front = frame[o + F.AERO_FRONT],
    rear = frame[o + F.AERO_REAR];
  const lines = [
    `ENGINEERING / ${replay ? 'RECORDED SNAPSHOT' : 'LIVE SNAPSHOT'} / F3 TO HIDE`,
    `TICK ${Math.round(frame[H.TICK])} / ${frame[H.TIME].toFixed(3)} s`,
    `RENDER ${render.fps.toFixed(1)} FPS / ${render.frameMs.toFixed(2)} ms / 1% LOW ${render.p1FPS.toFixed(1)}`,
    `CPU SUBMIT ${render.renderCPUms.toFixed(2)} ms / PHYSICS ${frame[H.STEP_MS].toFixed(2)} ms per tick`,
    `GPU ${render.gpuMilliseconds === null ? (render.gpuTimerSupported ? 'PENDING / INVALID' : 'UNSUPPORTED') : render.gpuMilliseconds.toFixed(2) + ' ms'}`,
    `DRAWS ${render.drawCalls} / TRIANGLES ${render.triangles} / DROPPED ${frame[H.DROPPED].toFixed(3)} s`,
    `SPEED ${(frame[o + F.SPEED] * 3.6).toFixed(1)} km/h / YAW RATE ${yawRate.toFixed(2)} deg/s`,
    `PITCH ${pitch.toFixed(2)} deg / ROLL ${roll.toFixed(2)} deg (left side up +)`,
    `G LONG ${frame[o + F.G_LONG].toFixed(2)} / LAT ${frame[o + F.G_LAT].toFixed(2)} / VERT ${frame[o + F.G_VERT].toFixed(2)}`,
    `AERO FRONT ${front.toFixed(0)} N / REAR ${rear.toFixed(0)} N / DRAG ${frame[o + F.DRAG].toFixed(0)} N`,
    `AERO BALANCE ${front + rear > 1 ? ((100 * front) / (front + rear)).toFixed(1) + '% FRONT' : 'UNLOADED'} / WAKE ${(frame[o + F.WAKE] * 100).toFixed(1)}%`,
    'WHEEL  Fz N / Fx N / Fy N / SLIP ratio / ANGLE deg',
  ];
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    lines.push(
      `${WHEEL_NAMES[i]} ${frame[p + W.LOAD].toFixed(0)} / ${frame[p + W.FX].toFixed(0)} / ${frame[p + W.FY].toFixed(0)} / ${frame[p + W.SLIP].toFixed(3)} / ${(frame[p + W.ANGLE] * degrees).toFixed(2)}`,
      `   STEER ${(frame[p + W.STEER] * degrees).toFixed(2)} deg / CAMBER ${(frame[p + W.CAMBER] * degrees).toFixed(2)} deg`,
      `   TEMP ${frame[p + W.SURFACE_TEMP].toFixed(1)} / ${frame[p + W.CARCASS_TEMP].toFixed(1)} C / WEAR ${(100 * frame[p + W.WEAR]).toFixed(1)}%`,
      `   ${MATERIAL[frame[p + W.SURFACE]] ?? 'UNKNOWN'} / WATER ${frame[p + W.WATER].toFixed(3)} mm / LOAD ${frame[p + W.LOAD] > 1 ? 'CONTACT' : 'AIRBORNE'}`,
    );
  }
  if (engineeringFresh(sample, frame[H.TIME], replay) && sample) {
    lines.push(
      `CONTACT/AI PROBE: TICK ${sample.tick} / ${sample.time.toFixed(3)} s / 10 Hz MAX`,
      ...sample.wheels.map(
        (wheel, i) =>
          `${WHEEL_NAMES[i]} CELL ${wheel.cell} / RUBBER ${(wheel.rubber * 100).toFixed(2)}% / MARBLES ${(wheel.marbles * 100).toFixed(2)}%`,
      ),
      `AI ${sample.aiActive ? 'ACTIVE' : 'INACTIVE'} / TARGET SPEED ${sample.aiActive ? (sample.targetSpeedMps * 3.6).toFixed(1) + ' km/h' : '—'}`,
      `AI TARGET PATH ${sample.aiActive ? sample.targetOffsetM.toFixed(2) + ' m lateral offset' : '—'}`,
      `AI DECISION ${sample.decision}`,
      'CYAN = SUSPENSION QUERY / AMBER = CONTACT / GREEN = Fz NORMAL',
    );
  } else
    lines.push(
      replay
        ? 'CONTACT/AI PROBE NOT RECORDED / LIVE OVERLAYS HIDDEN'
        : 'CONTACT/AI PROBE WAITING OR STALE / LIVE OVERLAYS HIDDEN',
    );
  return lines.join('\n');
}
