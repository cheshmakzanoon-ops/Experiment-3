import { describe, expect, it } from 'vitest';
import { sessionIdentity } from '../src/core/session-identity.ts';
import { RaceClient } from '../src/net/client.ts';
import { encodeControl, encodeSnapshot } from '../src/net/codec.ts';
import { EventLoop } from '../src/net/event-loop.ts';
import { distribution } from '../src/net/guards.ts';
import { MetricSamples, NETWORK_METRIC_CAPACITY } from '../src/net/metric-samples.ts';
import { LocalCarPredictor } from '../src/net/prediction.ts';
import { CAR_FLAG, emptyCarState } from '../src/net/snapshot.ts';
import type { Transport } from '../src/net/transport.ts';
import { controls, DEFAULT_OPTIONS, type SessionOptions } from '../src/simulation/config.ts';

const capacity = NETWORK_METRIC_CAPACITY;

describe('bounded networking sample windows', () => {
  it('reports empty snapshots and lifetime summaries without observations', () => {
    const metrics = new MetricSamples(['latency', 'error']);
    expect(metrics.stats.latency).toEqual([]);
    expect(metrics.stats.error).toEqual([]);
    expect(metrics.stats.sampleCapacity).toBe(capacity);
    expect(metrics.stats.sampleTotals).toEqual({
      latency: { observations: 0, samples: 0, sum: 0, mean: 0, max: 0 },
      error: { observations: 0, samples: 0, sum: 0, mean: 0, max: 0 },
    });
  });

  it.each([1, capacity - 1, capacity, capacity + 1, capacity * 2, capacity * 3 + 17])(
    'keeps the newest chronological samples after %i observations',
    (count) => {
      const metrics = new MetricSamples(['value']);
      for (let i = 0; i < count; i++) metrics.record('value', i);
      expect(metrics.stats.value).toEqual(
        Array.from(
          { length: Math.min(count, capacity) },
          (_, i) => Math.max(0, count - capacity) + i,
        ),
      );
      expect(metrics.stats.sampleTotals.value).toEqual({
        observations: count,
        samples: count,
        sum: (count * (count - 1)) / 2,
        mean: (count - 1) / 2,
        max: count - 1,
      });
    },
  );

  it('retains a fixed backing budget over a million observations without losing lifetime extrema', () => {
    const metrics = new MetricSamples(['value', 'other']);
    // Inspect the storage boundary, not process RSS (which includes the runner's heap).
    const windows = (
      metrics as unknown as {
        windows: Record<string, { values: Float64Array }>;
      }
    ).windows;
    const buffers = Object.values(windows).map((window) => window.values.buffer);
    metrics.record('value', 1_000_000);
    for (let i = 1; i < 1_000_000; i++) metrics.record('value', 1);
    expect(metrics.stats.value).toEqual(Array(capacity).fill(1));
    expect(metrics.stats.sampleTotals.value).toEqual({
      observations: 1_000_000,
      samples: 1_000_000,
      sum: 1_999_999,
      mean: 1.999999,
      max: 1_000_000,
    });
    expect(Object.values(windows).map((window) => window.values.buffer)).toEqual(buffers);
    expect(buffers.reduce((bytes, buffer) => bytes + buffer.byteLength, 0)).toBe(2 * capacity * 8);
    expect(metrics.stats.other).toEqual([]);
  });

  it('returns independent snapshots and summaries, including held snapshots across wraparound', () => {
    const metrics = new MetricSamples(['value']);
    metrics.record('value', -0);
    metrics.record('value', -2);
    const held = metrics.stats.value;
    expect(Object.is(held[0], -0)).toBe(true);
    expect(metrics.stats.sampleTotals.value.max).toBe(-0);
    const totals = metrics.stats.sampleTotals;
    totals.value.observations = 99;
    totals.value.sum = 999;
    metrics.stats.value.fill(123);
    metrics.stats.value.push(456);
    for (let i = 0; i <= capacity; i++) metrics.record('value', i);
    expect(held).toEqual([-0, -2]);
    expect(metrics.stats.value).toEqual(Array.from({ length: capacity }, (_, i) => i + 1));
    expect(metrics.stats.sampleTotals.value.observations).toBe(capacity + 3);
    expect(metrics.stats.sampleTotals.value.sum).toBe((capacity * (capacity + 1)) / 2 - 2);
  });

  it('preserves exceptional values in recent samples without poisoning finite lifetime summaries', () => {
    const metrics = new MetricSamples(['value']);
    [NaN, Infinity, -Infinity, -4, 2].forEach((value) => metrics.record('value', value));
    expect(metrics.stats.value).toEqual([NaN, Infinity, -Infinity, -4, 2]);
    expect(metrics.stats.sampleTotals.value).toEqual({
      observations: 5,
      samples: 2,
      sum: -2,
      mean: -1,
      max: 2,
    });
  });

  it('retains exact short-run distributions and independent per-metric windows', () => {
    const metrics = new MetricSamples(['a', 'b']);
    const a: number[] = [],
      b: number[] = [];
    for (let i = 0; i < 2048; i++) {
      const value = (((i * 7919) % 2048) - 1000) / 16;
      metrics.record('a', value);
      a.push(value);
      if (i % 7 === 0) {
        metrics.record('b', -value);
        b.push(-value);
      }
    }
    expect(metrics.stats.a).toEqual(a);
    expect(metrics.stats.b).toEqual(b);
    expect(distribution(metrics.stats.a)).toEqual(distribution(a));
    expect(distribution(metrics.stats.b)).toEqual(distribution(b));
    expect(metrics.stats.sampleTotals.a.mean).toBe(
      a.reduce((sum, value) => sum + value, 0) / a.length,
    );
    expect(metrics.stats.sampleTotals.b.max).toBe(Math.max(...b));
  });

  it('owns its metric-key list and exposes serializable detached data', () => {
    const keys = ['a', 'b'];
    const metrics = new MetricSamples(keys);
    keys.length = 0;
    metrics.record('a', 3);
    expect(JSON.parse(JSON.stringify(metrics.stats))).toEqual({
      a: [3],
      b: [],
      sampleCapacity: capacity,
      sampleTotals: {
        a: { observations: 1, samples: 1, sum: 3, mean: 3, max: 3 },
        b: { observations: 0, samples: 0, sum: 0, mean: 0, max: 0 },
      },
    });
  });
});

const input = () => ({ ...controls(), throttle: 0.5 });
const state = (tick: number, flags: number = CAR_FLAG.FULL) => ({
  ...emptyCarState(0),
  flags,
  z: tick / 10,
  vz: 12,
});

describe('actual predictor metric retention', () => {
  it('bounds 100,000 render observations while preserving lifetime counts and unchanged poses', () => {
    const predictor = new LocalCarPredictor();
    predictor.reconcile(state(0), 0, input, 12, 0);
    const first = predictor.render(0);
    for (let i = 1; i < 100_000; i++) expect(predictor.render(i * 16)).toEqual(first);
    expect(predictor.stats.visualStep).toEqual(Array(capacity).fill(0));
    expect(predictor.stats.sampleTotals.visualStep).toEqual({
      observations: 99_999,
      samples: 99_999,
      sum: 0,
      mean: 0,
      max: 0,
    });
    expect(predictor.stats.reconciles).toBe(1);
    expect(predictor.stats.snaps).toBe(0);
  });

  it('bounds every reconciliation category while lifetime classification and error summaries continue', () => {
    const predictor = new LocalCarPredictor();
    predictor.reconcile(state(0), 0, input, 6, 0);
    const phases = [0, CAR_FLAG.CONTACT, CAR_FLAG.AI];
    for (const flags of phases)
      for (let i = 0; i < capacity + 128; i++) {
        const tick = predictor.stats.reconciles * 6;
        predictor.reconcile(state(tick, CAR_FLAG.FULL | flags), tick, input, tick + 6, tick);
        predictor.render(tick);
      }
    for (const key of [
      'positionError',
      'headingError',
      'positionErrorClean',
      'positionErrorContact',
      'positionErrorAi',
      'correction',
      'visualStep',
    ] as const) {
      expect(predictor.stats[key].length).toBe(capacity);
      expect(predictor.stats.sampleTotals[key].observations).toBeGreaterThan(capacity);
      expect(predictor.stats.sampleTotals[key].max).toBeLessThan(1e-8);
    }
    expect(predictor.stats.reconciles).toBe(1 + phases.length * (capacity + 128));
    expect(predictor.stats.aiDriven).toBe(capacity + 128);
    expect(predictor.stats.snaps).toBe(0);
    expect(predictor.stats.positionError.every((error) => error < 1e-8)).toBe(true);
  });

  it('isolates external metric mutation from subsequent prediction and reconciliation', () => {
    const actual = new LocalCarPredictor(),
      expected = new LocalCarPredictor();
    for (let tick = 0; tick <= 180; tick += 6) {
      const authoritative = { ...state(tick), x: (tick % 18) / 100 };
      actual.reconcile(authoritative, tick, input, tick + 12, tick * 8);
      expected.reconcile(authoritative, tick, input, tick + 12, tick * 8);
      for (const key of ['visualStep', 'positionError', 'headingError', 'correction'] as const) {
        actual.stats[key].fill(1000);
        actual.stats[key].push(1000);
        actual.stats.sampleTotals[key].mean = 1000;
      }
      expect(actual.render(tick * 8 + 2)).toEqual(expected.render(tick * 8 + 2));
      expect(actual.predictedAt(tick + 12)).toEqual(expected.predictedAt(tick + 12));
    }
    expect(actual.stats).toEqual(expected.stats);
  });
});

function clientFixture() {
  const loop = new EventLoop();
  let frames = 0;
  const options: SessionOptions = {
    ...DEFAULT_OPTIONS,
    mode: 'race',
    opponents: 0,
    vehicles: ['apx01'],
    grid: [0],
    seed: 731,
  };
  const transport: Transport = {
    label: 'metrics',
    open: true,
    onMessage: null,
    onClose: null,
    send() {},
    close() {},
  };
  const client = new RaceClient({
    loop,
    transport,
    advertised: options,
    name: 'Metrics',
    vehicle: 'apx01',
    input,
    onRender: () => frames++,
  });
  client.player = 'guest:metrics';
  transport.onMessage?.(
    encodeControl({
      kind: 'grid',
      options,
      identity: sessionIdentity(options),
      car: 0,
      startTick: 0,
      serverTick: 0,
      startInMs: 0,
      entries: [{ car: 0, player: client.player, name: 'Metrics', vehicle: 'apx01' }],
    }),
    'reliable',
  );
  const snapshot = (tick: number) =>
    transport.onMessage?.(
      encodeSnapshot({
        tick,
        phase: 1,
        raceTime: tick / 120,
        ackSeq: client.commands.nextSeq - 1,
        slack: 127,
        missing: 0,
        echo: loop.now >= 100 ? Math.floor(loop.now) - 50 : 0,
        hold: 0,
        cars: [state(tick)],
      }),
      'unreliable',
    );
  snapshot(0);
  return { client, loop, snapshot, frames: () => frames };
}

describe('actual client metric retention', () => {
  it('bounds all five metrics under scheduled sampling, rendering and healthy snapshots', () => {
    const { client, loop, snapshot, frames } = clientFixture();
    const stop = loop.every(50, () => snapshot(Math.round(loop.now / (1000 / 120))), 50);
    // More than 100,000 scheduled render frames. Snapshot ACKs keep the
    // unrelated input-command history healthy throughout the measurement.
    loop.runUntil(1_700_000);
    for (const key of [
      'rttMs',
      'leadTicks',
      'interpolationDelayTicks',
      'snapshotBytes',
      'inputBytes',
    ] as const) {
      expect(client.stats[key].length).toBe(capacity);
      expect(client.stats.sampleTotals[key].observations).toBeGreaterThan(capacity);
    }
    expect(client.stats.renderKinds.predicted).toBeGreaterThan(100_000);
    expect(client.stats.snapshots).toBe(34_001);
    expect(client.stats.sampleTotals.snapshotBytes.observations).toBe(client.stats.snapshots);
    expect(client.stats.sampleTotals.leadTicks.observations).toBe(client.stats.snapshots);
    expect(client.stats.sampleTotals.inputBytes.observations).toBe(client.stats.inputPackets);
    expect(client.stats.sampleTotals.interpolationDelayTicks.observations).toBe(frames());
    expect(client.stats.sampleTotals.rttMs.mean).toBe(50);
    expect(client.stats.sampleTotals.rttMs.max).toBe(50);
    stop();
    client.dispose();
    const held = structuredClone(client.stats);
    loop.runUntil(loop.now + 10_000);
    expect(client.stats).toEqual(held);
  });

  it('documents and bounds predictor observations made by repeated public view calls', () => {
    const { client, loop, snapshot } = clientFixture();
    loop.runUntil(50);
    snapshot(6);
    loop.runUntil(100);
    const before = client.predictor.stats.sampleTotals.visualStep.observations;
    const renderedFrames = client.stats.sampleTotals.interpolationDelayTicks.observations;
    const pose = client.view().local?.pose;
    for (let i = 0; i < 100_000; i++) expect(client.view().local?.pose).toEqual(pose);
    expect(client.predictor.stats.sampleTotals.visualStep.observations).toBe(before + 100_001);
    expect(client.predictor.stats.visualStep.length).toBe(capacity);
    expect(client.stats.sampleTotals.interpolationDelayTicks.observations).toBe(renderedFrames);
    client.dispose();
  });
});
