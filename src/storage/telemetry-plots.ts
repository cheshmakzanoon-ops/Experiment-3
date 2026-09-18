import { CHANNELS } from './telemetry-schema.ts';

interface Trace {
  channel: string;
  label: string;
  factor?: number;
  denominator?: string[];
}
interface Plot {
  title: string;
  unit: string;
  minimum: number;
  maximum: number;
  traces: Trace[];
}
export const TELEMETRY_VIEWS = {
  driver: {
    title: 'Driver inputs',
    plots: [
      {
        title: 'Speed',
        unit: 'km/h',
        minimum: 0,
        maximum: 320,
        traces: [{ channel: 'speed_mps', label: 'Speed', factor: 3.6 }],
      },
      {
        title: 'Pedals',
        unit: '%',
        minimum: 0,
        maximum: 100,
        traces: [
          { channel: 'throttle', label: 'Throttle', factor: 100 },
          { channel: 'brake', label: 'Brake', factor: 100 },
          { channel: 'clutch_pedal', label: 'Clutch', factor: 100 },
        ],
      },
      {
        title: 'Steering',
        unit: 'degrees · left +',
        minimum: -25,
        maximum: 25,
        traces: [{ channel: 'steer_rad', label: 'Wheel steer', factor: 180 / Math.PI }],
      },
      {
        title: 'Power unit',
        unit: 'RPM / gear × 1000',
        minimum: 0,
        maximum: 14000,
        traces: [
          { channel: 'rpm_rpm', label: 'RPM' },
          { channel: 'gear', label: 'Gear × 1000', factor: 1000 },
        ],
      },
    ],
  },
  balance: {
    title: 'Chassis and aerodynamics',
    plots: [
      {
        title: 'Acceleration',
        unit: 'g',
        minimum: -6,
        maximum: 6,
        traces: [
          { channel: 'g_long_g', label: 'Longitudinal' },
          { channel: 'g_lat_g', label: 'Lateral' },
          { channel: 'g_vert_g', label: 'Vertical' },
        ],
      },
      {
        title: 'Aerodynamic load',
        unit: 'N',
        minimum: 0,
        maximum: 18000,
        traces: [
          { channel: 'aero_front_N', label: 'Front' },
          { channel: 'aero_rear_N', label: 'Rear' },
          { channel: 'drag_N', label: 'Drag' },
        ],
      },
      {
        title: 'Ride height',
        unit: 'mm',
        minimum: 0,
        maximum: 150,
        traces: [
          { channel: 'front_ride_m', label: 'Front', factor: 1000 },
          { channel: 'rear_ride_m', label: 'Rear', factor: 1000 },
        ],
      },
      {
        title: 'Aerodynamic balance / wake',
        unit: '%',
        minimum: 0,
        maximum: 100,
        traces: [
          { channel: 'wake', label: 'Wake', factor: 100 },
          {
            channel: 'aero_front_N',
            label: 'Front share',
            factor: 100,
            denominator: ['aero_front_N', 'aero_rear_N'],
          },
        ],
      },
    ],
  },
  tires: { title: 'Tire temperature and load', plots: [] as Plot[] },
  slip: { title: 'Tire slip and forces', plots: [] as Plot[] },
  brakes: { title: 'Brakes and wear', plots: [] as Plot[] },
  suspension: { title: 'Suspension travel', plots: [] as Plot[] },
  clutch: {
    title: 'Clutch and engine coupling',
    plots: [
      {
        title: 'Clutch pedal / engagement',
        unit: '%',
        minimum: 0,
        maximum: 100,
        traces: [
          { channel: 'clutch_pedal', label: 'Pedal', factor: 100 },
          { channel: 'clutch_engagement', label: 'Engagement', factor: 100 },
        ],
      },
      {
        title: 'Shaft torque',
        unit: 'Nm',
        minimum: -800,
        maximum: 800,
        traces: [
          { channel: 'clutch_torque_Nm', label: 'Clutch' },
          { channel: 'engine_torque_Nm', label: 'Combustion' },
        ],
      },
      {
        title: 'Clutch slip heating',
        unit: 'kW',
        minimum: 0,
        maximum: 200,
        traces: [{ channel: 'clutch_slip_power_W', label: 'Dissipated', factor: 0.001 }],
      },
      {
        title: 'Engine speed',
        unit: 'RPM',
        minimum: 0,
        maximum: 14000,
        traces: [{ channel: 'rpm_rpm', label: 'Crankshaft' }],
      },
    ],
  },
  hybrid: {
    title: 'Hybrid and fuel',
    plots: [
      {
        title: 'Power',
        unit: 'kW',
        minimum: 0,
        maximum: 120,
        traces: [
          { channel: 'motor_power_W', label: 'Motor', factor: 0.001 },
          { channel: 'regen_power_W', label: 'Recovered', factor: 0.001 },
        ],
      },
      {
        title: 'Stored energy',
        unit: 'MJ',
        minimum: 0,
        maximum: 4,
        traces: [{ channel: 'battery_J', label: 'Battery', factor: 1e-6 }],
      },
      {
        title: 'Mass',
        unit: 'kg',
        minimum: 0,
        maximum: 40,
        traces: [
          { channel: 'fuel_kg', label: 'Fuel' },
          { channel: 'lost_mass_kg', label: 'Detached', factor: 1 },
        ],
      },
      {
        title: 'Control settings',
        unit: '%',
        minimum: 0,
        maximum: 100,
        traces: [
          { channel: 'brake_bias', label: 'Front bias', factor: 100 },
          { channel: 'diff_power', label: 'Power differential', factor: 100 },
          { channel: 'diff_coast', label: 'Coast differential', factor: 100 },
        ],
      },
    ],
  },
};
export type TelemetryView = keyof typeof TELEMETRY_VIEWS;
const wheels = ['FL', 'FR', 'RL', 'RR'];
const wheelTraces = (field: string, factor = 1) =>
  wheels.map((wheel) => ({ channel: `${wheel}_${field}`, label: wheel, factor }));
TELEMETRY_VIEWS.tires.plots = [
  {
    title: 'Carcass temperature',
    unit: '°C',
    minimum: 20,
    maximum: 150,
    traces: wheelTraces('carcass_temp_C'),
  },
  {
    title: 'Surface temperature',
    unit: '°C',
    minimum: 20,
    maximum: 180,
    traces: wheelTraces('surface_temp_C'),
  },
  { title: 'Contact load', unit: 'N', minimum: 0, maximum: 9000, traces: wheelTraces('load_N') },
  { title: 'Pressure', unit: 'kPa', minimum: 0, maximum: 200, traces: wheelTraces('pressure_kPa') },
];
TELEMETRY_VIEWS.slip.plots = [
  {
    title: 'Longitudinal slip',
    unit: 'ratio',
    minimum: -1,
    maximum: 1,
    traces: wheelTraces('slip'),
  },
  {
    title: 'Slip angle',
    unit: 'degrees',
    minimum: -20,
    maximum: 20,
    traces: wheelTraces('angle_rad', 180 / Math.PI),
  },
  {
    title: 'Longitudinal tire force',
    unit: 'N',
    minimum: -12000,
    maximum: 12000,
    traces: wheelTraces('fx_N'),
  },
  {
    title: 'Lateral tire force',
    unit: 'N',
    minimum: -12000,
    maximum: 12000,
    traces: wheelTraces('fy_N'),
  },
];
TELEMETRY_VIEWS.brakes.plots = [
  {
    title: 'Brake disc temperature',
    unit: '°C',
    minimum: 20,
    maximum: 1200,
    traces: wheelTraces('disc_temp_C'),
  },
  { title: 'Wear', unit: '% used', minimum: 0, maximum: 100, traces: wheelTraces('wear', 100) },
  {
    title: 'Flat spots',
    unit: '% severity',
    minimum: 0,
    maximum: 100,
    traces: wheelTraces('flat', 100),
  },
  { title: 'Contamination', unit: '%', minimum: 0, maximum: 100, traces: wheelTraces('dirt', 100) },
];
TELEMETRY_VIEWS.suspension.plots = [
  {
    title: 'Compression',
    unit: 'mm',
    minimum: 0,
    maximum: 170,
    traces: wheelTraces('compression_m', 1000),
  },
  {
    title: 'Suspension length',
    unit: 'mm',
    minimum: 50,
    maximum: 320,
    traces: wheelTraces('length_m', 1000),
  },
  { title: 'Contact load', unit: 'N', minimum: 0, maximum: 9000, traces: wheelTraces('load_N') },
  {
    title: 'Corner damage',
    unit: '%',
    minimum: 0,
    maximum: 100,
    traces: wheelTraces('suspension_damage', 100),
  },
];
export interface PlotData {
  count: number;
  at(row: number, column: number): number;
}
export interface LapRange {
  lap: number;
  start: number;
  end: number;
  valid: boolean;
}
const columns = new Map(CHANNELS.map((name, i) => [name, i]));
export function channelIndex(name: string) {
  const value = columns.get(name);
  if (value === undefined) throw new Error(`Unknown telemetry channel ${name}`);
  return value;
}
export function traceValue(data: PlotData, row: number, trace: Trace) {
  const value = data.at(row, channelIndex(trace.channel)) * (trace.factor ?? 1);
  if (!trace.denominator) return value;
  const total = trace.denominator.reduce((sum, name) => sum + data.at(row, channelIndex(name)), 0);
  return total > 1e-8 ? value / total : 0;
}
/** Only bounded, observed lap segments bracketed by a subsequent lap qualify.
 * A ring buffer that begins halfway round a lap is never a complete comparison. */
export function completeLaps(data: PlotData, length: number): LapRange[] {
  const result: LapRange[] = [];
  let start = 0;
  const valid = channelIndex('lap_valid');
  for (let i = 1; i < data.count; i++) {
    const previous = Math.round(data.at(i - 1, 2)),
      current = Math.round(data.at(i, 2));
    if (current === previous) continue;
    if (
      previous >= 0 &&
      current === previous + 1 &&
      data.at(start, 1) < 15 &&
      data.at(i - 1, 1) > length - 15
    ) {
      let clean = true,
        contiguous = true;
      for (let j = start; j < i; j++) {
        clean &&= data.at(j, valid) > 0.5;
        if (j > start && data.at(j, 0) - data.at(j - 1, 0) > 0.15) contiguous = false;
      }
      if (contiguous) result.push({ lap: previous, start, end: i - 1, valid: clean });
    }
    start = i;
  }
  return result;
}
const colors = ['#f4d4a0', '#64c8b7', '#ef7866', '#a6b7fa'];
const dashes = [[], [7, 3], [2, 3], [9, 3, 2, 3]];
export function drawTelemetry(
  canvas: HTMLCanvasElement,
  data: PlotData,
  selected: TelemetryView,
  comparison: boolean,
  length: number,
) {
  const view: { title: string; plots: Plot[] } =
    TELEMETRY_VIEWS[selected] ?? TELEMETRY_VIEWS.driver;
  const c = canvas.getContext('2d');
  if (!c) return;
  const width = canvas.width,
    height = canvas.height;
  canvas.dataset.view = selected;
  canvas.setAttribute(
    'aria-label',
    `${view.title}. ${comparison ? 'Two complete laps aligned by distance.' : 'Last 25 seconds.'} ${view.plots.map((p) => `${p.title}, ${p.unit}`).join('; ')}`,
  );
  c.fillStyle = '#141b1d';
  c.fillRect(0, 0, width, height);
  c.font = '13px monospace';
  c.fillStyle = '#d6dfdb';
  c.fillText(
    `${view.title.toUpperCase()} · ${comparison ? 'DISTANCE-ALIGNED LAPS' : 'ACTUAL SAMPLE TIME'} · DASHES IDENTIFY TRACES`,
    16,
    23,
  );
  if (data.count < 2) {
    c.fillText('No recorded samples yet.', 25, 70);
    return;
  }
  const laps = comparison ? completeLaps(data, length).slice(-2) : [];
  if (comparison && laps.length < 2) {
    c.fillText('Two full laps must remain in the telemetry recording to compare.', 25, 70);
    return;
  }
  let start = data.count - 1;
  const endTime = data.at(start, 0);
  while (start > 0 && data.at(start - 1, 0) >= endTime - 25) start--;
  const ranges = comparison ? laps : [{ lap: -1, start, end: data.count - 1, valid: true }];
  const xStart = comparison ? 0 : data.at(start, 0),
    xEnd = comparison ? length : endTime;
  if (comparison)
    c.fillText(
      laps
        .map(
          (p) =>
            `Lap ${p.lap + 1}${p.valid ? '' : ' (INVALID)'} ${p === laps[0] ? 'thin' : 'bold'}`,
        )
        .join('   /   '),
      16,
      44,
    );
  const top = comparison ? 65 : 44,
    pane = (height - top - 30) / view.plots.length;
  view.plots.forEach((plot, p) => {
    const yTop = top + p * pane + 20,
      yBottom = top + (p + 1) * pane - 9;
    let minimum = plot.minimum,
      maximum = plot.maximum;
    for (const range of ranges)
      for (const trace of plot.traces) {
        for (let row = range.start; row <= range.end; row++) {
          const value = traceValue(data, row, trace);
          if (Number.isFinite(value)) {
            minimum = Math.min(minimum, value);
            maximum = Math.max(maximum, value);
          }
        }
      }
    const extent = Math.max(1e-8, maximum - minimum);
    const y = (value: number) => yBottom - ((value - minimum) / extent) * (yBottom - yTop);
    c.fillStyle = '#d6dfdb';
    c.fillText(`${plot.title} [${plot.unit}]`, 16, yTop - 5);
    c.fillStyle = '#93a4a3';
    c.fillText(maximum.toFixed(Math.abs(maximum) < 10 ? 2 : 0), 12, yTop + 13);
    c.fillText(minimum.toFixed(Math.abs(minimum) < 10 ? 2 : 0), 12, yBottom);
    c.strokeStyle = '#344447';
    c.lineWidth = 1;
    c.setLineDash([]);
    for (const level of [minimum, maximum, ...(minimum < 0 && maximum > 0 ? [0] : [])]) {
      c.beginPath();
      c.moveTo(64, y(level));
      c.lineTo(width - 20, y(level));
      c.stroke();
    }
    plot.traces.forEach((trace, traceIndex) => {
      c.fillStyle = colors[traceIndex % colors.length];
      c.fillText(trace.label, width - 480 + traceIndex * (460 / plot.traces.length), yTop - 5);
      ranges.forEach((range, rangeIndex) => {
        c.strokeStyle = colors[traceIndex % colors.length];
        c.lineWidth = comparison && rangeIndex === 0 ? 1 : 2;
        c.globalAlpha = comparison && rangeIndex === 0 ? 0.45 : 1;
        c.setLineDash(dashes[traceIndex % dashes.length]);
        c.beginPath();
        let started = false;
        // At most one display-width worth of buckets, retaining min/max in
        // every bucket so short lockups or kerb load peaks are not averaged out.
        const bucket = Math.max(1, Math.floor((range.end - range.start + 1) / (width - 90)));
        for (let row = range.start; row <= range.end; row += bucket) {
          let low = row,
            high = row;
          for (let j = row + 1; j <= Math.min(range.end, row + bucket - 1); j++) {
            if (data.at(j, 0) - data.at(j - 1, 0) > 0.15) started = false;
            if (traceValue(data, j, trace) < traceValue(data, low, trace)) low = j;
            if (traceValue(data, j, trace) > traceValue(data, high, trace)) high = j;
          }
          for (const point of low === high ? [low] : [low, high].sort((a, b) => a - b)) {
            const value = traceValue(data, point, trace);
            const xValue = data.at(point, comparison ? 1 : 0);
            const x = 64 + ((xValue - xStart) / (xEnd - xStart || 1)) * (width - 84);
            if (!Number.isFinite(value + x)) {
              started = false;
              continue;
            }
            if (row > range.start && data.at(row, 0) - data.at(row - 1, 0) > 0.15) started = false;
            if (started) c.lineTo(x, y(value));
            else {
              c.moveTo(x, y(value));
              started = true;
            }
          }
        }
        c.stroke();
        c.globalAlpha = 1;
      });
    });
  });
  c.setLineDash([]);
  c.fillStyle = '#b5c7c5';
  c.fillText(`${xStart.toFixed(1)} ${comparison ? 'm' : 's'}`, 64, height - 8);
  c.fillText(`${xEnd.toFixed(1)} ${comparison ? 'm' : 's'}`, width - 95, height - 8);
}
