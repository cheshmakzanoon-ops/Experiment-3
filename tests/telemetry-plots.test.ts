import { expect, it, vi } from 'vitest';
import { CHANNELS, TELEMETRY_STRIDE } from '../src/storage/telemetry-schema.ts';
import {
  TELEMETRY_VIEWS,
  channelIndex,
  completeLaps,
  drawTelemetry,
  type PlotData,
  type TelemetryView,
} from '../src/storage/telemetry-plots.ts';

function fixture(start = 0, finish = 300): PlotData {
  const values = new Float32Array((finish - start) * TELEMETRY_STRIDE);
  for (let j = start; j < finish; j++) {
    const offset = (j - start) * TELEMETRY_STRIDE;
    values[offset] = j / 60;
    values[offset + 1] = j % 100;
    values[offset + 2] = Math.floor(j / 100);
    values[offset + channelIndex('lap_valid')] = 1;
    values[offset + channelIndex('speed_mps')] = 50 + Math.sin(j / 7);
  }
  return { count: finish - start, at: (row, column) => values[row * TELEMETRY_STRIDE + column] };
}
it('maps every selectable trace to an actual, unique exported channel', () => {
  for (const view of Object.values(TELEMETRY_VIEWS)) {
    expect(view.plots).toHaveLength(4);
    for (const plot of view.plots) {
      expect(plot.minimum).toBeLessThan(plot.maximum);
      expect(plot.unit.length).toBeGreaterThan(0);
      for (const trace of plot.traces)
        expect(CHANNELS[channelIndex(trace.channel)]).toBe(trace.channel);
    }
  }
  expect(() => channelIndex('fake_temperature')).toThrow('Unknown');
});
it('compares completed laps and excludes current and truncated old laps', () => {
  expect(completeLaps(fixture(), 100).map((p) => p.lap)).toEqual([0, 1]);
  expect(completeLaps(fixture(40, 300), 100).map((p) => p.lap)).toEqual([1]);
  expect(completeLaps(fixture(240, 300), 100)).toEqual([]);
});
it('marks invalid laps without mislabeling them as clean', () => {
  const data = fixture(),
    original = data.at;
  data.at = (row, column) =>
    row === 40 && column === channelIndex('lap_valid') ? 0 : original(row, column);
  expect(completeLaps(data, 100)[0].valid).toBe(false);
  expect(completeLaps(data, 100)[1].valid).toBe(true);
});
it('never reports a recording gap as a complete recorded lap', () => {
  const data = fixture(),
    original = data.at;
  data.at = (row, column) =>
    column === 0 && row >= 150 ? original(row, column) + 1 : original(row, column);
  expect(completeLaps(data, 100).map((p) => p.lap)).toEqual([0]);
});
it.each(Object.keys(TELEMETRY_VIEWS) as TelemetryView[])(
  'draws finite, correctly labeled %s plots',
  (view) => {
    const points: number[][] = [],
      text: string[] = [],
      attributes: Record<string, string> = {};
    const context = {
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      stroke: vi.fn(),
      setLineDash: vi.fn(),
      fillText: (value: string) => text.push(value),
      moveTo: (x: number, y: number) => points.push([x, y]),
      lineTo: (x: number, y: number) => points.push([x, y]),
    };
    const canvas = {
      width: 1100,
      height: 590,
      dataset: {},
      getContext: () => context,
      setAttribute: (key: string, value: string) => (attributes[key] = value),
    } as unknown as HTMLCanvasElement;
    drawTelemetry(canvas, fixture(), view, false, 100);
    expect(canvas.dataset.view).toBe(view);
    expect(attributes['aria-label']).toContain(TELEMETRY_VIEWS[view].title);
    expect(points.length).toBeGreaterThan(100);
    expect(points.flat().every(Number.isFinite)).toBe(true);
    for (const plot of TELEMETRY_VIEWS[view].plots)
      expect(text).toContain(`${plot.title} [${plot.unit}]`);
    drawTelemetry(canvas, fixture(), view, true, 100);
    expect(attributes['aria-label']).toContain('aligned by distance');
  },
);

it('derives aero balance from recorded forces and handles the zero-load case', async () => {
  const { traceValue } = await import('../src/storage/telemetry-plots.ts');
  const data: PlotData = {
    count: 1,
    at: (_row, column) => (column === channelIndex('aero_front_N') ? 4000 : 6000),
  };
  const trace = {
    channel: 'aero_front_N',
    label: 'Front share',
    factor: 100,
    denominator: ['aero_front_N', 'aero_rear_N'],
  };
  expect(traceValue(data, 0, trace)).toBe(40);
  data.at = () => 0;
  expect(traceValue(data, 0, trace)).toBe(0);
});
