import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeReadinessHistory,
  normalizeNativeBabylonReadiness,
  preserveNativeFailureWhileObserving,
  readNativeBabylonReadiness,
} from '../scripts/native-readiness-observation.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function install(data: Record<string, string> = {}, graphics: unknown = null) {
  const frozen = Object.freeze({ ...data });
  const status = Object.freeze({ dataset: frozen, textContent: 'PAUSED · physics tick 54' });
  const doc = Object.freeze({
    hidden: false,
    hasFocus: () => true,
    querySelector: (selector: string) =>
      selector === '#status'
        ? status
        : selector === '#pause'
          ? Object.freeze({ textContent: 'Resume' })
          : selector === '#loadAsset'
            ? Object.freeze({ disabled: true })
            : null,
  });
  const diagnostics = vi.fn(() => graphics);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', Object.freeze({ babylonGraphicsDiagnostics: diagnostics }));
  return { data: frozen, diagnostics, doc };
}

describe('read-only native readiness samples', () => {
  it('serializes as a self-contained browser reader and does not mutate frozen DOM/scheduler state', () => {
    const schedule = Object.freeze({ requested: true, preparationCount: 1, pending: true });
    const graphics = Object.freeze({
      settled: true,
      phase: 'idle',
      readiness: Object.freeze({ schedule }),
    });
    const h = install(
      { presentationSettled: 'false', renderedFrames: '10', completedFrames: '10' },
      graphics,
    );
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const serialized = new Function(`return (${readNativeBabylonReadiness.toString()})()`);
    const before = performance.now();
    const result = serialized() as ReturnType<typeof readNativeBabylonReadiness>;
    expect(result.predicate).toEqual({ submitted: 10, completed: 10, ready: false });
    expect(result.graphics).toMatchObject(graphics);
    expect(result.graphics).not.toBe(graphics);
    expect(result.renderer.nowMs).toBeGreaterThanOrEqual(before);
    expect(result.renderer.timeOriginMs).toBe(performance.timeOrigin);
    expect(h.data.presentationSettled).toBe('false');
    expect(schedule).toEqual({ requested: true, preparationCount: 1, pending: true });
    expect(h.diagnostics).toHaveBeenCalledOnce();
    expect(timer).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });
  it('keeps absent fields unknown rather than converting missing counts/flags to zero or false', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);
    const result = readNativeBabylonReadiness();
    expect(result.dom).toMatchObject({
      statusText: null,
      pauseButton: null,
      loadDisabled: null,
      hidden: null,
      focused: null,
    });
    expect(Object.values(result.dom.data).every((value) => value === null)).toBe(true);
    expect(result.predicate).toEqual({ submitted: null, completed: null, ready: false });
    expect(result.graphics).toBeNull();
  });
  it.each([
    [{ presentationSettled: 'true', renderedFrames: '10', completedFrames: '10' }, true],
    [{ presentationSettled: 'false', renderedFrames: '10', completedFrames: '10' }, false],
    [{ presentationSettled: 'true', renderedFrames: '0', completedFrames: '0' }, false],
    [{ presentationSettled: 'true', renderedFrames: '10', completedFrames: '9' }, false],
    [{ presentationSettled: 'true', renderedFrames: '1.5', completedFrames: '1.5' }, false],
    [{ presentationSettled: 'true' }, false],
  ] as const)(
    'reports, but does not substitute for, the exact existing predicate: %j',
    (data, ready) => {
      install(data, { settled: true, submitted: 10, completed: 10 });
      expect(readNativeBabylonReadiness().predicate.ready).toBe(ready);
    },
  );
  it('marks truncated evidence but computes the informational predicate from the complete raw value', () => {
    install({
      presentationSettled: 'true',
      renderedFrames: '1' + ' '.repeat(200) + 'x',
      completedFrames: '1',
    });
    const result = readNativeBabylonReadiness();
    expect(result.dom.data.renderedFrames).toHaveLength(128);
    expect(result.dom.truncatedFields).toEqual(['renderedFrames']);
    expect(result.predicate).toEqual({ submitted: null, completed: 1, ready: false });
  });
  it('retains actual owner/readiness fields and excludes callbacks, accessors and resource instances', () => {
    const getter = vi.fn(() => {
      throw new Error('must not execute');
    });
    class Resource {
      secret = 'resource';
    }
    const graphics = {
      settled: false,
      readiness: { owners: { lamps: { exists: true, completed: false, canDraw: true } } },
      callback: () => {},
      resource: new Resource(),
    };
    Object.defineProperty(graphics, 'unsafe', { enumerable: true, get: getter });
    install({ sceneReady: 'false', lampState: 'installing', lampParts: '5' }, graphics);
    const result = readNativeBabylonReadiness();
    expect(result.dom.data.lampState).toBe('installing');
    expect(result.graphics).toMatchObject({ settled: false, readiness: graphics.readiness });
    expect(result.graphics).not.toHaveProperty('callback');
    expect(result.graphics).not.toHaveProperty('resource');
    expect(result.graphics).not.toHaveProperty('unsafe');
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([undefined, null, new Error('diagnostics failed')])(
    'retains bounded diagnostic errors, including falsy %s',
    (failure) => {
      install();
      vi.stubGlobal('window', {
        babylonGraphicsDiagnostics: () => {
          throw failure;
        },
      });
      const result = readNativeBabylonReadiness();
      expect(result.graphics).toBeNull();
      expect(result.errors).toEqual([`graphics: ${String(failure)}`]);
      expect(result.predicate.ready).toBe(false);
    },
  );
  it.each([null, 'surface.canDraw: undefined'])(
    'preserves bounded readinessError %s without exposing unknown fields',
    (readinessError) => {
      install({}, { settled: true, readiness: null, readinessError, arbitrary: 'drop' });
      const result = readNativeBabylonReadiness();
      expect(result.graphics).toMatchObject({ settled: true, readiness: null, readinessError });
      expect(result.graphics).not.toHaveProperty('arbitrary');
      expect(normalizeNativeBabylonReadiness(result)?.graphics).toMatchObject({ readinessError });
    },
  );
  it('drops unknown fields, never executes whitelisted accessors, and records sanitizer failure', () => {
    const getter = vi.fn(() => true);
    const graphics = { arbitrary: { hidden: 'not accepted' } };
    Object.defineProperty(graphics, 'settled', { get: getter });
    install({}, graphics);
    let result = readNativeBabylonReadiness();
    expect(result.graphics).not.toHaveProperty('arbitrary');
    expect(result.graphics).toMatchObject({ settled: null });
    expect(result.errors).toContain('graphics.settled: accessor unavailable');
    expect(getter).not.toHaveBeenCalled();
    install({}, { readiness: new Date() });
    result = readNativeBabylonReadiness();
    expect(result.graphics).toBeNull();
    expect(result.errors).toEqual([
      'graphics: Error: graphics.readiness: non-plain diagnostic object',
    ]);
  });
  it('bounds overlarge graphics data rather than carrying a resource-sized packet', () => {
    install({}, { phase: 'x'.repeat(10000), preparation: { failure: 'y'.repeat(10000) } });
    const result = readNativeBabylonReadiness();
    expect(result.graphics).toBeNull();
    expect(result.errors).toContain('graphics: snapshot exceeds 4096-byte limit');
    expect(JSON.stringify(result).length).toBeLessThan(16384);
  });
});

describe('host readiness packet whitelist', () => {
  function sample() {
    install(
      { presentationSettled: 'false', renderedFrames: '10', completedFrames: '10' },
      {
        settled: true,
        readiness: {
          paused: true,
          owners: { lamps: { exists: true, completed: false, canDraw: true, errors: [] } },
          schedule: { requested: true, preparationCount: 1, pending: true },
        },
      },
    );
    return readNativeBabylonReadiness();
  }
  it('copies only known root/nested scalar fields and never invokes unknown getters', () => {
    const raw = sample();
    const getter = vi.fn(() => {
      throw new Error('must not read unknown');
    });
    const hostile = {
      ...raw,
      secret: { giant: 'x'.repeat(100000) },
      callback: () => {},
      dom: { ...raw.dom, unexpected: { token: 'drop' }, data: { ...raw.dom.data, secret: 'drop' } },
      graphics: { ...(raw.graphics as object), extra: { retainedResource: 'drop' } },
    };
    Object.defineProperty(hostile, 'unknownAccessor', { enumerable: true, get: getter });
    const result = normalizeNativeBabylonReadiness(hostile);
    expect(result).toEqual(raw);
    expect(result).not.toBe(raw);
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects known accessors without invoking them and rejects functions/resource objects', () => {
    const raw = sample();
    const getter = vi.fn(() => 'true');
    const data = { ...raw.dom.data };
    Object.defineProperty(data, 'presentationSettled', { get: getter });
    expect(normalizeNativeBabylonReadiness({ ...raw, dom: { ...raw.dom, data } })).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(
      normalizeNativeBabylonReadiness({ ...raw, graphics: { readiness: new Date() } }),
    ).toBeNull();
    expect(
      normalizeNativeBabylonReadiness({
        ...raw,
        predicate: { ...raw.predicate, ready: () => true },
      }),
    ).toBeNull();
    const root = { ...raw };
    Object.defineProperty(root, 'graphics', { get: getter });
    expect(normalizeNativeBabylonReadiness(root)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
  it('rejects malformed envelopes and oversize allowed fields instead of transporting arbitrary payloads', () => {
    const raw = sample();
    for (const value of [null, undefined, [], false, () => {}, new Date(), {}, { unknown: 'only' }])
      expect(normalizeNativeBabylonReadiness(value)).toBeNull();
    expect(normalizeNativeBabylonReadiness({ ...raw, errors: Array(17).fill('error') })).toBeNull();
    expect(
      normalizeNativeBabylonReadiness({
        ...raw,
        dom: { ...raw.dom, statusText: 'x'.repeat(2049) },
      }),
    ).toBeNull();
    expect(
      normalizeNativeBabylonReadiness({
        ...raw,
        dom: { ...raw.dom, data: { ...raw.dom.data, lampState: 'x'.repeat(129) } },
      }),
    ).toBeNull();
    expect(
      normalizeNativeBabylonReadiness({
        ...raw,
        graphics: { phase: 'x'.repeat(2048), preparation: { failure: 'x'.repeat(2048) } },
      }),
    ).toBeNull();
    expect(
      normalizeNativeBabylonReadiness({
        ...raw,
        dom: { ...raw.dom, truncatedFields: ['unknown-key'] },
      }),
    ).toBeNull();
  });
  it('normalizes missing leaf data to unknown without reading clocks, DOM, GL or scheduling anything', () => {
    const raw = sample();
    delete (raw.dom.data as Record<string, string | null>).lampState;
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const perf = vi.spyOn(performance, 'now');
    const before = JSON.stringify(raw);
    const result = normalizeNativeBabylonReadiness(raw);
    expect(result?.dom.data.lampState).toBeNull();
    expect(JSON.stringify(raw)).toBe(before);
    expect(timer).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
  });
});

describe('banner readiness observation boundary', () => {
  const banner = {
    bannerState: 'ready',
    bannerParts: '1',
    bannerMaterials: '1',
    bannerTextures: '1',
    bannerTriangles: '2',
    bannerWidth: '2048',
    bannerHeight: '256',
    bannerHardwareSrgb: '1',
  };
  it.each(['0', '1'])(
    'preserves actual banner raw fields and owner state, including hardware sRGB %s',
    (hardware) => {
      const owner = Object.freeze({ exists: true, completed: true, canDraw: true, errors: [] });
      install(
        {
          ...banner,
          bannerHardwareSrgb: hardware,
          presentationSettled: 'false',
          renderedFrames: '10',
          completedFrames: '10',
        },
        { settled: true, readiness: { owners: { banner: owner } } },
      );
      const observed = readNativeBabylonReadiness();
      const normalized = normalizeNativeBabylonReadiness(observed);
      expect(observed.dom.data).toMatchObject({ ...banner, bannerHardwareSrgb: hardware });
      expect(normalized?.dom.data).toMatchObject({ ...banner, bannerHardwareSrgb: hardware });
      expect(observed.graphics).toMatchObject({ readiness: { owners: { banner: owner } } });
      expect(normalized?.graphics).toMatchObject({ readiness: { owners: { banner: owner } } });
      // Banner/GPU availability cannot substitute for the unchanged DOM predicate.
      expect(observed.predicate.ready).toBe(false);
      expect(normalized?.predicate.ready).toBe(false);
    },
  );
  it('keeps absent banner fields and owner unknown instead of inventing zero counts or readiness', () => {
    install({}, { readiness: { owners: {} } });
    const observed = readNativeBabylonReadiness();
    const normalized = normalizeNativeBabylonReadiness(observed);
    for (const key of Object.keys(banner)) {
      expect(observed.dom.data[key]).toBeNull();
      expect(normalized?.dom.data[key]).toBeNull();
    }
    expect(observed.graphics).toMatchObject({ readiness: { owners: { banner: null } } });
    expect(normalized?.graphics).toMatchObject({ readiness: { owners: { banner: null } } });
  });
  it('does not broaden strict host acceptance beyond banner scalar fields and owner diagnostics', () => {
    install(banner, {
      readiness: {
        owners: { banner: { exists: true, completed: false, canDraw: true, errors: [] } },
      },
    });
    const observed = readNativeBabylonReadiness();
    const getter = vi.fn(() => '1');
    const data = { ...observed.dom.data };
    Object.defineProperty(data, 'bannerParts', { get: getter });
    expect(
      normalizeNativeBabylonReadiness({ ...observed, dom: { ...observed.dom, data } }),
    ).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(
      normalizeNativeBabylonReadiness({
        ...observed,
        dom: { ...observed.dom, data: { ...observed.dom.data, bannerHardwareSrgb: true } },
      }),
    ).toBeNull();
    const normalized = normalizeNativeBabylonReadiness({
      ...observed,
      dom: { ...observed.dom, data: { ...observed.dom.data, bannerSecret: 'drop' } },
      graphics: {
        readiness: {
          owners: {
            banner: { exists: true, completed: false, canDraw: true, errors: [], resource: {} },
          },
        },
      },
    });
    expect(normalized?.dom.data).not.toHaveProperty('bannerSecret');
    expect(normalized?.graphics).toMatchObject({
      readiness: { owners: { banner: { exists: true, completed: false, canDraw: true } } },
    });
    expect(
      (normalized?.graphics as { readiness: { owners: { banner: object } } }).readiness.owners
        .banner,
    ).not.toHaveProperty('resource');
  });
});

describe('stripe readiness observation boundary', () => {
  const stripe = {
    stripeState: 'ready',
    stripeParts: '1',
    stripeMaterials: '1',
    stripeTextures: '1',
    stripeTriangles: '2',
    stripeWidth: '256',
    stripeHeight: '64',
    stripeHardwareSrgb: '1',
  };
  it.each(['0', '1'])(
    'preserves actual stripe raw fields and owner state, including hardware sRGB %s',
    (hardware) => {
      const owner = Object.freeze({ exists: true, completed: true, canDraw: true, errors: [] });
      install(
        {
          ...stripe,
          stripeHardwareSrgb: hardware,
          presentationSettled: 'false',
          renderedFrames: '10',
          completedFrames: '10',
        },
        { settled: true, readiness: { owners: { stripe: owner } } },
      );
      const observed = readNativeBabylonReadiness();
      const normalized = normalizeNativeBabylonReadiness(observed);
      expect(observed.dom.data).toMatchObject({ ...stripe, stripeHardwareSrgb: hardware });
      expect(normalized?.dom.data).toMatchObject({ ...stripe, stripeHardwareSrgb: hardware });
      expect(observed.graphics).toMatchObject({ readiness: { owners: { stripe: owner } } });
      expect(normalized?.graphics).toMatchObject({ readiness: { owners: { stripe: owner } } });
      // Stripe/GPU availability cannot substitute for the unchanged DOM predicate.
      expect(observed.predicate.ready).toBe(false);
      expect(normalized?.predicate.ready).toBe(false);
    },
  );
  it('keeps absent stripe fields and owner unknown instead of inventing zero counts or readiness', () => {
    install({}, { readiness: { owners: {} } });
    const observed = readNativeBabylonReadiness();
    const normalized = normalizeNativeBabylonReadiness(observed);
    for (const key of Object.keys(stripe)) {
      expect(observed.dom.data[key]).toBeNull();
      expect(normalized?.dom.data[key]).toBeNull();
    }
    expect(observed.graphics).toMatchObject({ readiness: { owners: { stripe: null } } });
    expect(normalized?.graphics).toMatchObject({ readiness: { owners: { stripe: null } } });
  });
  it('does not broaden strict host acceptance beyond stripe scalar fields and owner diagnostics', () => {
    install(stripe, {
      readiness: {
        owners: { stripe: { exists: true, completed: false, canDraw: true, errors: [] } },
      },
    });
    const observed = readNativeBabylonReadiness();
    const getter = vi.fn(() => '1');
    const data = { ...observed.dom.data };
    Object.defineProperty(data, 'stripeParts', { get: getter });
    expect(
      normalizeNativeBabylonReadiness({ ...observed, dom: { ...observed.dom, data } }),
    ).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(
      normalizeNativeBabylonReadiness({
        ...observed,
        dom: { ...observed.dom, data: { ...observed.dom.data, stripeHardwareSrgb: true } },
      }),
    ).toBeNull();
    const normalized = normalizeNativeBabylonReadiness({
      ...observed,
      dom: { ...observed.dom, data: { ...observed.dom.data, stripeSecret: 'drop' } },
      graphics: {
        readiness: {
          owners: {
            stripe: { exists: true, completed: false, canDraw: true, errors: [], resource: {} },
          },
        },
      },
    });
    expect(normalized?.dom.data).not.toHaveProperty('stripeSecret');
    expect(normalized?.graphics).toMatchObject({
      readiness: { owners: { stripe: { exists: true, completed: false, canDraw: true } } },
    });
    expect(
      (normalized?.graphics as { readiness: { owners: { stripe: object } } }).readiness.owners
        .stripe,
    ).not.toHaveProperty('resource');
  });
});

describe('bounded native readiness history', () => {
  it('retains clock brackets verbatim without reading clocks, setting timers or resetting budgets', () => {
    const history = createNativeReadinessHistory({ maxEntries: 2 });
    const before = Object.freeze({ wallMs: 17000, monotonicMs: 32000 });
    const after = Object.freeze({ wallMs: 17003, monotonicMs: 32003 });
    const sample = Object.freeze({ predicate: Object.freeze({ ready: false }), deadline: 120000 });
    const clock = vi.spyOn(Date, 'now');
    const timer = vi.spyOn(globalThis, 'setTimeout');
    history.record('entry', sample, before, after);
    expect(history.snapshot().observations).toEqual([
      { phase: 'entry', hostBefore: before, hostAfter: after, sample, error: null },
    ]);
    expect(clock).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(sample.deadline).toBe(120000);
    const snapshot = history.snapshot();
    (snapshot.observations[0] as Record<string, unknown>).phase = 'changed';
    expect(history.snapshot().observations[0]).toMatchObject({ phase: 'entry' });
  });
  it('bounds entry count and total bytes, including histories containing oversized input', () => {
    const history = createNativeReadinessHistory({ maxEntries: 2 });
    for (let i = 0; i < 5; i++) history.record('poll', { i }, i, i + 1);
    expect(history.snapshot()).toMatchObject({ received: 5, evicted: 3, rejected: 0 });
    expect(history.snapshot().observations).toHaveLength(2);
    expect(
      history.record(
        'oversize',
        Object.fromEntries(Array.from({ length: 64 }, (_, i) => [String(i), 'x'.repeat(3000)])),
        0,
        1,
      ),
    ).toBe(false);
    const result = history.snapshot();
    expect(result.rejected).toBe(1);
    expect(result.retainedBytes).toBeLessThanOrEqual(result.limits.maxTotalBytes);
    expect(result.observations[1]).toMatchObject({
      sample: null,
      error: 'Error: Readiness sample exceeds byte limit',
    });
    const bytes = createNativeReadinessHistory();
    for (let i = 0; i < 64; i++)
      bytes.record('poll', { large: Array(7).fill('x'.repeat(2048)) }, 0, 1);
    expect(bytes.snapshot().evicted).toBeGreaterThan(0);
    expect(bytes.snapshot().retainedBytes).toBeLessThanOrEqual(262144);
  });
  it('retains entry and timeout checkpoints through more than 64 polls without another queue', () => {
    const history = createNativeReadinessHistory();
    history.record('gate-entry', { ready: false }, 0, 1);
    for (let i = 0; i < 400; i++) history.record('poll', { i }, i, i + 1);
    history.record('gate-timeout', { ready: false }, 400, 401);
    const result = history.snapshot();
    expect(result.observations).toHaveLength(64);
    expect(result.observations[0]).toMatchObject({ phase: 'gate-entry' });
    expect(result.observations.at(-1)).toMatchObject({ phase: 'gate-timeout' });
    expect(result.received).toBe(402);
    expect(result.evicted).toBe(338);
  });
  it('handles malformed, cyclic, accessor and non-plain input without invoking foreign code', () => {
    const history = createNativeReadinessHistory();
    const getter = vi.fn(() => {
      throw new Error('getter');
    });
    const value: Record<string, unknown> = { callback: () => {}, invalid: Infinity };
    value.self = value;
    Object.defineProperty(value, 'getter', { enumerable: true, get: getter });
    expect(history.record('poll', value, undefined, undefined)).toBe(true);
    expect(history.snapshot().observations[0]).toMatchObject({
      hostBefore: null,
      hostAfter: null,
      sample: { callback: null, invalid: null, self: null },
    });
    expect(getter).not.toHaveBeenCalled();
    for (const invalid of [undefined, null, false, [], new Date()])
      expect(history.record('poll', invalid, 0, 1)).toBe(false);
    expect(history.snapshot().rejected).toBe(5);
  });
  it.each([undefined, null, false, 0, '', new Error('primary timeout')])(
    'preserves primary failure %s despite secondary diagnostic failure',
    (primary) => {
      const secondary = vi.fn(() => {
        throw new Error('capture failed');
      });
      let rejected = false,
        caught: unknown = Symbol('not caught');
      try {
        preserveNativeFailureWhileObserving(primary, secondary);
      } catch (error) {
        rejected = true;
        caught = error;
      }
      expect(rejected).toBe(true);
      expect(caught).toBe(primary);
      expect(secondary).toHaveBeenCalledOnce();
    },
  );
  it('cannot turn a primary failure into success or add a wait when cached evidence recording succeeds', () => {
    const primary = new Error('timeout');
    const timer = vi.spyOn(globalThis, 'setTimeout');
    expect(() => preserveNativeFailureWhileObserving(primary, () => {})).toThrow(primary);
    expect(timer).not.toHaveBeenCalled();
    expect(preserveNativeFailureWhileObserving.toString()).not.toContain('await');
  });
});

describe('explicit scalar submission observations', () => {
  const row = {
    sequence: 1,
    rendererNowMs: 20,
    timeOriginMs: 1000,
    componentEpoch: 1,
    sceneEpoch: 1,
    paused: false,
    tick: 3,
    throttle: 1,
    speed: 4,
    readyBefore: true,
    readyAfter: true,
    preparationStage: 'none',
    requested: true,
    preparationCount: 0,
    wheelPhase: null,
    lossesAtSubmission: 0,
    provenance: 'current',
  };
  function packet() {
    return {
      version: 1,
      enabled: true,
      currentComponentEpoch: 1,
      currentSceneEpoch: 1,
      losses: 0,
      records: [{ ...row }],
    };
  }
  it('explicit opt-in forwards only the options object and preserves default shape/calls', () => {
    install({}, null);
    const diagnostics = vi.fn(() => ({ submissionObservation: packet(), secret: 'discard' }));
    vi.stubGlobal('window', { babylonGraphicsDiagnostics: diagnostics });
    const ordinary = readNativeBabylonReadiness();
    expect(diagnostics).toHaveBeenLastCalledWith();
    expect(ordinary.graphics).not.toHaveProperty('submissionObservation');
    const observed = readNativeBabylonReadiness({ submissionObservation: true });
    expect(diagnostics).toHaveBeenLastCalledWith({ submissionObservation: true });
    expect(observed.graphics).toHaveProperty('submissionObservation.records.0.sequence', 1);
    expect(observed.graphics).not.toHaveProperty('secret');
    expect(normalizeNativeBabylonReadiness(observed)).not.toBeNull();
  });
  it('strict host bounds records and rejects getters/invalid categories without invoking them', () => {
    install({}, { submissionObservation: packet() });
    const sample = readNativeBabylonReadiness({ submissionObservation: true });
    const value = sample.graphics as Record<string, unknown>;
    value.submissionObservation = { ...packet(), records: Array(9).fill(row) };
    expect(normalizeNativeBabylonReadiness(sample)).toBeNull();
    value.submissionObservation = { ...packet(), records: [{ ...row, provenance: 'invented' }] };
    expect(normalizeNativeBabylonReadiness(sample)).toBeNull();
    const getter = vi.fn(() => packet());
    Object.defineProperty(value, 'submissionObservation', { get: getter, configurable: true });
    expect(normalizeNativeBabylonReadiness(sample)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
  });
  it('missing scalar values stay unknown and unknown root/nested keys are dropped', () => {
    install(
      {},
      {
        submissionObservation: {
          ...packet(),
          secret: { resource: 1 },
          records: [{ sequence: 1, secret: () => 1 }],
        },
      },
    );
    const sample = readNativeBabylonReadiness({ submissionObservation: true });
    const observed = normalizeNativeBabylonReadiness(sample);
    expect(observed).not.toBeNull();
    expect(observed?.graphics).toHaveProperty('submissionObservation.records.0.throttle', null);
    expect(observed?.graphics).not.toHaveProperty('submissionObservation.secret');
    expect(observed?.graphics).not.toHaveProperty('submissionObservation.records.0.secret');
  });
});

describe('grid readiness observation boundary', () => {
  const grid = {
    gridState: 'ready',
    gridParts: '2',
    gridMaterials: '1',
    gridTextures: '0',
    gridSlots: '12',
    gridBoxes: '36',
    gridTriangles: '432',
    gridDryOnly: 'true',
    gridGpSwitchingParity: 'false',
    gridWeatherParity: 'false',
    gridShadowParity: 'false',
  };
  it.each(['false', 'true'])(
    'preserves actual grid raw fields and owner state, including dry-only %s',
    (hardware) => {
      const owner = Object.freeze({ exists: true, completed: true, canDraw: true, errors: [] });
      install(
        {
          ...grid,
          gridDryOnly: hardware,
          presentationSettled: 'false',
          renderedFrames: '10',
          completedFrames: '10',
        },
        { settled: true, readiness: { owners: { grid: owner } } },
      );
      const observed = readNativeBabylonReadiness();
      const normalized = normalizeNativeBabylonReadiness(observed);
      expect(observed.dom.data).toMatchObject({ ...grid, gridDryOnly: hardware });
      expect(normalized?.dom.data).toMatchObject({ ...grid, gridDryOnly: hardware });
      expect(observed.graphics).toMatchObject({ readiness: { owners: { grid: owner } } });
      expect(normalized?.graphics).toMatchObject({ readiness: { owners: { grid: owner } } });
      // Grid/GPU availability cannot substitute for the unchanged DOM predicate.
      expect(observed.predicate.ready).toBe(false);
      expect(normalized?.predicate.ready).toBe(false);
    },
  );
  it('keeps absent grid fields and owner unknown instead of inventing zero counts or readiness', () => {
    install({}, { readiness: { owners: {} } });
    const observed = readNativeBabylonReadiness();
    const normalized = normalizeNativeBabylonReadiness(observed);
    for (const key of Object.keys(grid)) {
      expect(observed.dom.data[key]).toBeNull();
      expect(normalized?.dom.data[key]).toBeNull();
    }
    expect(observed.graphics).toMatchObject({ readiness: { owners: { grid: null } } });
    expect(normalized?.graphics).toMatchObject({ readiness: { owners: { grid: null } } });
  });
  it('does not broaden strict host acceptance beyond grid scalar fields and owner diagnostics', () => {
    install(grid, {
      readiness: {
        owners: { grid: { exists: true, completed: false, canDraw: true, errors: [] } },
      },
    });
    const observed = readNativeBabylonReadiness();
    const getter = vi.fn(() => '1');
    const data = { ...observed.dom.data };
    Object.defineProperty(data, 'gridParts', { get: getter });
    expect(
      normalizeNativeBabylonReadiness({ ...observed, dom: { ...observed.dom, data } }),
    ).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(
      normalizeNativeBabylonReadiness({
        ...observed,
        dom: { ...observed.dom, data: { ...observed.dom.data, gridDryOnly: true } },
      }),
    ).toBeNull();
    const normalized = normalizeNativeBabylonReadiness({
      ...observed,
      dom: { ...observed.dom, data: { ...observed.dom.data, gridSecret: 'drop' } },
      graphics: {
        readiness: {
          owners: {
            grid: { exists: true, completed: false, canDraw: true, errors: [], resource: {} },
          },
        },
      },
    });
    expect(normalized?.dom.data).not.toHaveProperty('gridSecret');
    expect(normalized?.graphics).toMatchObject({
      readiness: { owners: { grid: { exists: true, completed: false, canDraw: true } } },
    });
    expect(
      (normalized?.graphics as { readiness: { owners: { grid: object } } }).readiness.owners.grid,
    ).not.toHaveProperty('resource');
  });
});

describe('bounded first A09 braking triplet observation', () => {
  const triplet = {
    brakingTripletState: 'ready',
    brakingTripletParts: '6',
    brakingTripletTriangles: '4950',
    brakingTripletScope: 'dry-formula-first-clean-triplet-fixed-lod0',
  };
  const stripe = {
    stripeState: 'ready',
    stripeParts: '1',
    stripeMaterials: '1',
    stripeTextures: '1',
    stripeTriangles: '2',
    stripeWidth: '128',
    stripeHeight: '32',
    stripeHardwareSrgb: '1',
  };
  it('roundtrips exactly64 known scalar keys without dropping trailing stripe evidence or changing the predicate', () => {
    const owner = { exists: true, completed: true, canDraw: true, errors: [] };
    install(
      {
        ...triplet,
        ...stripe,
        presentationSettled: 'false',
        renderedFrames: '4',
        completedFrames: '4',
      },
      { settled: true, readiness: { owners: { brakingTriplet: owner } } },
    );
    const observed = readNativeBabylonReadiness(),
      normalized = normalizeNativeBabylonReadiness(observed);
    expect(Object.keys(observed.dom.data)).toHaveLength(64);
    expect(Object.keys(normalized!.dom.data)).toEqual(Object.keys(observed.dom.data));
    expect(Object.keys(observed.dom.data).slice(-8)).toEqual(Object.keys(stripe));
    expect(observed.dom.data).toMatchObject({ ...triplet, ...stripe });
    expect(normalized!.dom.data).toMatchObject({ ...triplet, ...stripe });
    expect(normalized!.graphics).toMatchObject({
      readiness: { owners: { brakingTriplet: owner } },
    });
    expect(observed.predicate.ready).toBe(false);
    expect(normalized!.predicate.ready).toBe(false);
    expect(observed.graphics).not.toHaveProperty('startupVisualState');
    expect(observed.graphics).not.toHaveProperty('submissionObservation');
    const history = createNativeReadinessHistory();
    expect(history.record('poll', observed, 1, 2)).toBe(true);
    const recorded = history.snapshot().observations[0] as {
      sample: { dom: { data: Record<string, string | null> } };
    };
    expect(Object.keys(recorded.sample.dom.data)).toHaveLength(64);
    expect(recorded.sample.dom.data).toMatchObject({ ...triplet, ...stripe });
  });
  it('does not invent completed readiness, zero counts or scope for absent fields', () => {
    install({}, { readiness: { owners: {} } });
    const observed = readNativeBabylonReadiness(),
      normalized = normalizeNativeBabylonReadiness(observed);
    for (const key of Object.keys(triplet)) {
      expect(observed.dom.data[key]).toBeNull();
      expect(normalized!.dom.data[key]).toBeNull();
    }
    expect(observed.graphics).toHaveProperty('readiness.owners.brakingTriplet', null);
    expect(normalized!.graphics).toHaveProperty('readiness.owners.brakingTriplet', null);
  });
  it('preserves malformed raw strings as evidence rather than converting them into qualified counts', () => {
    install({ ...triplet, brakingTripletParts: 'NaN', brakingTripletScope: 'unqualified' }, null);
    const observed = normalizeNativeBabylonReadiness(readNativeBabylonReadiness());
    expect(observed!.dom.data.brakingTripletParts).toBe('NaN');
    expect(observed!.dom.data.brakingTripletScope).toBe('unqualified');
    expect(observed!.predicate.ready).toBe(false);
  });
  it('rejects typed scalars/getters and drops unknown data/resources without traversing them', () => {
    install(triplet, {
      readiness: {
        owners: { brakingTriplet: { exists: true, completed: false, canDraw: true, errors: [] } },
      },
    });
    const sample = readNativeBabylonReadiness(),
      getter = vi.fn(() => '6');
    const data = { ...sample.dom.data };
    Object.defineProperty(data, 'brakingTripletParts', { get: getter });
    expect(normalizeNativeBabylonReadiness({ ...sample, dom: { ...sample.dom, data } })).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    for (const [key, value] of [
      ['brakingTripletParts', 6],
      ['brakingTripletTriangles', 4950],
      ['brakingTripletScope', true],
    ])
      expect(
        normalizeNativeBabylonReadiness({
          ...sample,
          dom: { ...sample.dom, data: { ...sample.dom.data, [key as string]: value } },
        }),
      ).toBeNull();
    const normalized = normalizeNativeBabylonReadiness({
      ...sample,
      dom: { ...sample.dom, data: { ...sample.dom.data, brakingTripletSecret: 'drop' } },
      graphics: {
        readiness: {
          owners: {
            brakingTriplet: {
              exists: true,
              completed: false,
              canDraw: true,
              errors: [],
              resource: { secret: true },
            },
          },
        },
      },
    });
    expect(normalized!.dom.data).not.toHaveProperty('brakingTripletSecret');
    expect(normalized!.graphics).toHaveProperty('readiness.owners.brakingTriplet', {
      exists: true,
      completed: false,
      canDraw: true,
      errors: [],
    });
  });
});
