import { CAR_STRIDE, F, H, HEADER, carBase } from '../simulation/protocol.ts';
import { clamp } from '../core/math.ts';

export type StationMode = 'LIVE' | 'REPLAY' | 'HELD' | 'STANDBY';
export interface StationPanel {
  title: string;
  rows: [string, string][];
}
export interface StationReadout {
  time: number;
  car: number;
  mode: StationMode;
  panels: StationPanel[];
}
const observed = [
  F.SPEED,
  F.RPM,
  F.GEAR,
  F.THROTTLE,
  F.BRAKE,
  F.FUEL,
  F.BATTERY,
  F.LAPS,
  F.LAP_TIME,
  F.BEST_LAP,
  F.LAST_LAP,
  F.RANK,
  F.IN_PIT,
  F.PIT_PHASE,
  F.PIT_STOPS,
  F.FRONT_HEALTH,
  F.REAR_HEALTH,
  F.FLOOR_HEALTH,
  F.PENALTY,
  F.LOCAL_FLAG,
  F.SECTOR_1,
  F.SECTOR_2,
  F.SECTOR_3,
  F.RETIRED,
] as const;
const headers = [H.TIME, H.RACE_TIME, H.PHASE, H.FLAG, H.RAIN, H.AMBIENT, H.WIND_X, H.WIND_Z];
const flags = ['GREEN', 'YELLOW', 'CHEQUERED', 'DOUBLE YELLOW', 'BLUE'];
const phases = ['GRID', 'LIGHTS', 'RACING', 'FINISHED'];
const fixed = (n: number, places = 1) => n.toFixed(places);
const percent = (n: number) => `${fixed(clamp(n, 0, 1) * 100, 0)} %`;
function lap(n: number) {
  if (n <= 0) return '--';
  return `${Math.floor(n / 60)}:${(n % 60).toFixed(3).padStart(6, '0')}`;
}
function valid(frame: Float32Array, car: number) {
  const count = frame[H.CARS];
  return (
    Number.isInteger(count) &&
    count >= 1 &&
    count <= 12 &&
    Number.isInteger(car) &&
    car >= 0 &&
    car < count &&
    frame.length === HEADER + count * CAR_STRIDE &&
    headers.every((f) => Number.isFinite(frame[f])) &&
    observed.every((f) => Number.isFinite(frame[carBase(car) + f])) &&
    Array.from({ length: count }, (_, id) => frame[carBase(id) + F.RANK]).every(Number.isFinite)
  );
}
/** Key only for data actually displayed. No wall clock, invented chart, or frame mutation. */
export function stationDataKey(frame: Float32Array, car: number, mode: StationMode) {
  if (mode === 'STANDBY') return 'STANDBY';
  if (!valid(frame, car)) return 'NO DATA';
  const b = carBase(car);
  return [
    mode,
    car,
    ...headers.map((f) => frame[f]),
    ...observed.map((f) => frame[b + f]),
    ...Array.from({ length: frame[H.CARS] }, (_, id) => frame[carBase(id) + F.RANK]),
  ].join('|');
}
export function readStationData(
  frame: Float32Array,
  car = 0,
  mode: StationMode = 'LIVE',
): StationReadout | null {
  if (mode === 'STANDBY' || !valid(frame, car)) return null;
  const b = carBase(car),
    n = (field: number) => frame[b + field];
  const panel = (title: string, rows: [string, string][]): StationPanel => ({ title, rows });
  const order = Array.from({ length: frame[H.CARS] }, (_, id) => ({
    id,
    rank: frame[carBase(id) + F.RANK],
  })).sort((a, b) => a.rank - b.rank || a.id - b.id);
  return {
    time: frame[H.TIME],
    car,
    mode,
    panels: [
      panel('SESSION', [
        ['PHASE', phases[frame[H.PHASE]] ?? 'UNKNOWN'],
        ['RACE SEC', fixed(frame[H.RACE_TIME])],
        ['COMPLETED LAPS', fixed(n(F.LAPS), 0)],
        ['POSITION', n(F.RANK) > 0 ? String(n(F.RANK)) : '--'],
      ]),
      panel('LAP TIMING', [
        ['CURRENT', lap(n(F.LAP_TIME))],
        ['LAST', lap(n(F.LAST_LAP))],
        ['BEST', lap(n(F.BEST_LAP))],
        ['PENALTY SEC', fixed(n(F.PENALTY))],
      ]),
      panel('POWERTRAIN', [
        ['KM/H', fixed(n(F.SPEED) * 3.6, 0)],
        ['RPM', fixed(n(F.RPM), 0)],
        ['GEAR', n(F.GEAR) < 0 ? 'R' : n(F.GEAR) === 0 ? 'N' : String(n(F.GEAR))],
        ['THROTTLE', percent(n(F.THROTTLE))],
      ]),
      panel('ENERGY / CONTROL', [
        ['FUEL KG', fixed(n(F.FUEL))],
        ['BATTERY', percent(n(F.BATTERY) / 4e6)],
        ['BRAKE', percent(n(F.BRAKE))],
        ['STATUS', n(F.RETIRED) ? 'RETIRED' : 'ACTIVE'],
      ]),
      panel('RACE CONTROL', [
        ['GLOBAL', flags[frame[H.FLAG]] ?? 'UNKNOWN'],
        ['LOCAL', flags[n(F.LOCAL_FLAG)] ?? 'UNKNOWN'],
        ['IN PIT', n(F.IN_PIT) ? 'YES' : 'NO'],
        ['STOPS', fixed(n(F.PIT_STOPS), 0)],
      ]),
      panel('CAR CONDITION', [
        ['FRONT WING', percent(n(F.FRONT_HEALTH))],
        ['REAR WING', percent(n(F.REAR_HEALTH))],
        ['FLOOR', percent(n(F.FLOOR_HEALTH))],
        ['SERVICE PHASE', fixed(n(F.PIT_PHASE), 0)],
      ]),
      panel('WEATHER', [
        ['AIR C', fixed(frame[H.AMBIENT])],
        ['RAIN MM/H', fixed(frame[H.RAIN])],
        ['WIND X M/S', fixed(frame[H.WIND_X])],
        ['WIND Z M/S', fixed(frame[H.WIND_Z])],
      ]),
      panel(
        'CLASSIFICATION',
        order
          .slice(0, 4)
          .map(({ id, rank }) => [
            `CAR ${String(id + 1).padStart(2, '0')}`,
            rank > 0 ? `P ${rank}` : '--',
          ]),
      ),
    ],
  };
}

/** Five Hz during advancing simulation time; seek, held-frame corrections and
 * visibility return refresh immediately. Repeated paused frames never upload. */
export class StationDisplayClock {
  private previousTime = NaN;
  private paintedTime = NaN;
  private paintedKey = '';
  private identity = '';
  private active = false;
  due(time: number, key: string, identity: string, visible: boolean) {
    if (!visible) {
      this.active = false;
      return false;
    }
    const refresh =
      !this.active ||
      identity !== this.identity ||
      time < this.previousTime ||
      !Number.isFinite(this.paintedTime) ||
      time - this.paintedTime >= 0.2 - 1e-6 ||
      (time === this.previousTime && key !== this.paintedKey);
    this.previousTime = time;
    this.identity = identity;
    this.active = true;
    if (refresh) {
      this.paintedTime = time;
      this.paintedKey = key;
    }
    return refresh;
  }
}

/** Eight independent 512-square panels in one 2048x1024 atlas. The exported UV
 * rectangles select a tile; text is drawn once, not eight separate textures. */
export function paintStationAtlas(
  c: CanvasRenderingContext2D,
  data: StationReadout | null,
  mode: StationMode,
) {
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.textBaseline = 'alphabetic';
  for (let tile = 0; tile < 8; tile++) {
    const x = (tile % 4) * 512,
      y = Math.floor(tile / 4) * 512;
    c.fillStyle = '#061318';
    c.fillRect(x, y, 512, 512);
    c.fillStyle = '#14333a';
    c.fillRect(x + 12, y + 12, 488, 68);
    c.fillStyle = '#64d9c3';
    c.fillRect(x + 12, y + 12, 7, 68);
    c.textAlign = 'left';
    c.font = 'bold 23px monospace';
    c.fillStyle = '#d8e8e3';
    c.fillText('AUREL / ' + (data?.panels[tile].title ?? 'RACE OPS'), x + 30, y + 55, 458);
    if (!data) {
      c.font = 'bold 42px monospace';
      c.fillStyle = '#c5d6d3';
      c.fillText(mode === 'STANDBY' ? 'STANDBY' : 'NO DATA', x + 42, y + 255);
    } else {
      data.panels[tile].rows.forEach(([label, value], i) => {
        c.fillStyle = i % 2 ? '#0c2229' : '#0a1c23';
        c.fillRect(x + 20, y + 106 + i * 79, 472, 70);
        c.textAlign = 'left';
        c.font = '18px monospace';
        c.fillStyle = '#87a7a7';
        c.fillText(label, x + 30, y + 130 + i * 79, 445);
        c.font = 'bold 30px monospace';
        c.fillStyle = '#e0f1e7';
        c.fillText(value, x + 30, y + 162 + i * 79, 445);
      });
    }
    c.textAlign = 'left';
    c.font = '18px monospace';
    c.fillStyle = '#72c9b5';
    c.fillText(
      data
        ? `${data.mode}  CAR ${String(data.car + 1).padStart(2, '0')}  T ${data.time.toFixed(1)}`
        : 'SESSION DATA NOT CONNECTED',
      x + 26,
      y + 475,
      460,
    );
  }
  c.restore();
}
