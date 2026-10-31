import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  NATIVE_PREPARATION_CAPTURE as config,
  installNativePreparationObserver,
  createNativePreparationSink,
  createNativePreparationWriter,
  readRetainedGameObservation,
  retainCompatibilityObservation,
} from '../scripts/native-preparation-evidence.mjs';
import { graphicsFaults } from '../desktop/graphics-health.ts';

afterEach(() => vi.unstubAllGlobals());

function packet(sequence = 1, documentId = 'doc-a') {
  return {
    version: 1,
    documentId,
    origin: 1000,
    url: 'motobound://game/index.html',
    sequence,
    dropped: 0,
    truncated: 0,
    sourceCapped: false,
    checkpoint: {
      run: 1,
      sequence,
      span: 1,
      phase: 'start',
      label: 'cockpit:scene-submit',
      at: 12,
    },
  };
}
const encode = (value: unknown) => config.prefix + JSON.stringify(value);

describe('native preparation Node sink', () => {
  it('retains full valid JSON separately from generic console truncation and returns copies', () => {
    const sink = createNativePreparationSink();
    const value = packet();
    const detailJSON = JSON.stringify({ name: 'original material', data: 'x'.repeat(4000) });
    const incoming = { ...value, checkpoint: { ...value.checkpoint, detailJSON } };
    expect(sink.consume(encode(incoming), 2000)).toBe(true);
    const first = sink.snapshot();
    expect(first.events[0].checkpoint.detailJSON).toBe(detailJSON);
    expect(first.events[0].receivedAt).toBe(2000);
    first.events[0].checkpoint.label = 'mutated';
    first.documents[0].lastSequence = 999;
    expect(sink.snapshot().events[0].checkpoint.label).toBe('cockpit:scene-submit');
    expect(sink.snapshot().documents[0].lastSequence).toBe(1);
  });
  it('rejects malformed, oversized and ill-typed packets without prototype writes', () => {
    const sink = createNativePreparationSink();
    for (const text of [
      config.prefix + '{',
      encode(null),
      encode([]),
      encode({ ...packet(), sequence: -1 }),
      encode({ ...packet(), checkpoint: { ...packet().checkpoint, span: '1' } }),
      encode({ ...packet(), checkpoint: { ...packet().checkpoint, phase: 'pretend-complete' } }),
      encode({ ...packet(), checkpoint: { ...packet().checkpoint, at: -1 } }),
      config.prefix + 'x'.repeat(config.maxPacketBytes + 1),
    ])
      expect(sink.consume(text)).toBe(true);
    expect(sink.snapshot()).toMatchObject({ accepted: 0, rejected: 8, oversizedPackets: 1 });
    expect(sink.consume('normal console')).toBe(false);
    // JSON __proto__ is inert data, never merged into a report object.
    const malicious = JSON.parse(
      JSON.stringify(packet()).replace('"version":1', '"version":1,"__proto__":{"polluted":true}'),
    );
    sink.consume(encode(malicious));
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(sink.snapshot().events[0]).not.toHaveProperty('__proto__.polluted');
  });
  it.each(['{not-json', JSON.stringify({ value: '界'.repeat(12000) })])(
    'substitutes a valid truncation marker for invalid or UTF-8 oversized detail',
    (detailJSON) => {
      const sink = createNativePreparationSink();
      sink.consume(encode({ ...packet(), checkpoint: { ...packet().checkpoint, detailJSON } }));
      const result = sink.snapshot();
      expect(result.truncatedDetails).toBe(1);
      expect(JSON.parse(result.events[0].checkpoint.detailJSON!)).toEqual({
        truncated: true,
        reason: 'invalid-or-oversized-detail',
      });
    },
  );
  it('evicts oldest events at count and serialized-byte bounds with explicit loss counters', () => {
    const count = createNativePreparationSink({ maxEvents: 2 });
    for (let sequence = 1; sequence <= 4; sequence++) count.consume(encode(packet(sequence)));
    expect(count.snapshot().events.map((event) => event.sequence)).toEqual([3, 4]);
    expect(count.snapshot().evictedEvents).toBe(2);
    expect(count.snapshot().evictedBytes).toBeGreaterThan(0);
    const bytes = createNativePreparationSink({ maxBytes: 1024 });
    for (let sequence = 1; sequence <= 10; sequence++) bytes.consume(encode(packet(sequence)));
    const snapshot = bytes.snapshot();
    expect(snapshot.retainedBytes).toBeLessThanOrEqual(1024);
    expect(snapshot.events.at(-1)?.sequence).toBe(10);
    expect(snapshot.accepted).toBe(snapshot.events.length + snapshot.evictedEvents);
  });
  it('keeps document identity, gaps and source caps across navigation and rejects replay', () => {
    const sink = createNativePreparationSink({ maxDocuments: 2 });
    sink.consume(encode(packet(1)));
    sink.consume(encode({ ...packet(3), dropped: 2, truncated: 1, sourceCapped: true }));
    sink.consume(encode({ ...packet(1, 'doc-b'), origin: 2000 }));
    sink.consume(encode(packet(3))); // replay
    sink.consume(encode({ ...packet(4), origin: 9999 })); // identity mutation
    sink.consume(encode(packet(1, 'doc-c')));
    const snapshot = sink.snapshot();
    expect(
      snapshot.events.map((event) => [event.documentId, event.origin, event.sequence]),
    ).toEqual([
      ['doc-a', 1000, 1],
      ['doc-a', 1000, 3],
      ['doc-b', 2000, 1],
    ]);
    expect(snapshot.documents[0]).toMatchObject({
      missingPackets: 1,
      sourceDropped: 2,
      sourceTruncated: 1,
      sourceCapped: true,
    });
    expect(snapshot).toMatchObject({ reorderedPackets: 2, documentLimitPackets: 1, rejected: 3 });
  });
  it('cannot erase an independently observed GPU fault', () => {
    const faults = graphicsFaults(['GPU process exited unexpectedly: exit_code=512'], [], 0);
    const sink = createNativePreparationSink();
    sink.consume(encode({ ...packet(), graphicsFaults: [], success: true }));
    expect(sink.snapshot().events[0]).not.toHaveProperty('graphicsFaults');
    expect(faults).toEqual(['GPU process exited unexpectedly: exit_code=512']);
  });
});

it('serialized observer emits before a blocked operation without RAF/GL/timer hooks and caps packets', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const messages: string[] = [];
  const sink = createNativePreparationSink();
  const forbidden = () => {
    throw new Error('No runtime hooks');
  };
  const browser = {
    config: { ...config, maxPackets: 2 },
    performance: { timeOrigin: 5000 },
    crypto: { randomUUID: () => 'document-id' },
    location: { href: 'motobound://game/index.html' },
    TextEncoder,
    window: {
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        listeners.set(name, handler),
      get requestAnimationFrame() {
        return forbidden();
      },
    },
    setTimeout: forbidden,
    setInterval: forbidden,
    requestAnimationFrame: forbidden,
    console: {
      debug: (message: string) => {
        messages.push(message);
        sink.consume(message, 6000);
      },
    },
  };
  runInNewContext(`(${installNativePreparationObserver.toString()})(config)`, browser);
  expect([...listeners.keys()]).toEqual(['apex-preparation-checkpoint']);
  const emit = listeners.get('apex-preparation-checkpoint')!;
  emit({ detail: { ...packet().checkpoint, span: NaN } });
  emit({ detail: packet().checkpoint });
  // This evidence already belongs to Node before the simulated driver blocks.
  expect(sink.snapshot().events[0].checkpoint.phase).toBe('start');
  emit({ detail: { ...packet(2).checkpoint, phase: 'error', detailJSON: 'x'.repeat(40000) } });
  emit({ detail: packet(3).checkpoint });
  expect(messages).toHaveLength(2);
  expect(sink.snapshot().documents[0]).toMatchObject({
    sourceDropped: 1,
    sourceTruncated: 1,
    sourceCapped: true,
  });
  expect(sink.snapshot().events.map((event) => event.checkpoint.phase)).toEqual(['start', 'error']);
});

it('persists the latest bounded JSON without needing a live renderer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-preparation-'));
  try {
    const path = join(dir, 'preparation.json');
    const writer = createNativePreparationWriter(path);
    const sink = createNativePreparationSink({ maxEvents: 2 });
    for (let sequence = 1; sequence <= 6; sequence++) {
      sink.consume(encode(packet(sequence)));
      writer.update(sink.snapshot());
    }
    expect(await writer.flush()).toBeNull();
    const saved = JSON.parse(await readFile(path, 'utf8'));
    expect(saved.events.map((event: { sequence: number }) => event.sequence)).toEqual([5, 6]);
    expect(saved.evictedEvents).toBe(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('reports persistence failure without throwing over the application failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-preparation-'));
  try {
    const writer = createNativePreparationWriter(join(dir, 'missing', 'preparation.json'));
    writer.update({ version: 1 });
    expect(await writer.flush()).toContain('ENOENT');
    expect(() => writer.update({ version: 2 })).not.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('fatal compatibility observations', () => {
  const read = (failure: string | null, diagnostics: () => unknown) => {
    const browser = {
      document: { querySelector: () => ({ textContent: failure }) },
      window: { apexDiagnostics: diagnostics },
    };
    return runInNewContext(`(${readRetainedGameObservation.toString()})()`, browser);
  };
  it('saves the final checkpoints before failing on the fatal panel', () => {
    const observation = read('GPU failed', () => ({
      state: 'loading',
      renderer: { preparation: { checkpoints: [78] } },
    }));
    const report = {};
    expect(() => retainCompatibilityObservation(report, observation)).toThrow(
      'Retained game stopped: GPU failed',
    );
    expect(report).toMatchObject({
      lastCompatibilityObservation: { failure: 'GPU failed', preparation: { checkpoints: [78] } },
    });
  });
  it('preserves the fatal error when diagnostics also throws, without calling it success', () => {
    const observation = read('Original GPU error', () => {
      throw new Error('renderer disposed');
    });
    const report = {};
    expect(() => retainCompatibilityObservation(report, observation)).toThrow(
      'Retained game stopped: Original GPU error',
    );
    expect(report).toMatchObject({
      lastCompatibilityObservation: {
        failure: 'Original GPU error',
        diagnosticsError: expect.stringContaining('renderer disposed'),
      },
    });
  });
  it('still fails when diagnostics is unavailable without a fatal panel', () => {
    const report = {};
    const observation = read(null, () => {
      throw new Error('diagnostics unavailable');
    });
    expect(() => retainCompatibilityObservation(report, observation)).toThrow(
      'diagnostics unavailable',
    );
    expect(report).toHaveProperty('lastCompatibilityObservation');
  });
});
