/** Self-contained actual Playwright callback; no executable string construction.
 * Never polls GL, consumes scheduling demand or writes DOM. Default snapshot ready
 * is informational; poll mode returns the unchanged authoritative pause predicate.
 * Missing raw observation values remain null. */
export function readNativeBabylonReadiness(options) {
  // This whole callback is passed as a FUNCTION, never executable string code.
  // Nest the reader so serialization has no imported/outer closure dependency.
  const read = () => {
    const errors = [];
    const errorText = (error) => {
      try {
        return String(error).slice(0, 256);
      } catch {
        return 'Unprintable diagnostic failure';
      }
    };
    const safely = (label, read) => {
      try {
        return read() ?? null;
      } catch (error) {
        errors.push(`${label}: ${errorText(error)}`);
        return null;
      }
    };
    const text = (value, limit = 2048) =>
      typeof value === 'string' ? value.slice(0, limit) : null;
    const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const boolean = (value) => (typeof value === 'boolean' ? value : null);
    const doc = safely('document', () => globalThis.document);
    const status = safely('status', () => doc?.querySelector('#status'));
    const data = safely('dataset', () => status?.dataset);
    const keys = [
      'presentationSettled',
      'renderedFrames',
      'completedFrames',
      'sceneReady',
      'lastCompletedSequence',
      'abandonedFrames',
      'surfaceKind',
      'surfaceRoadChunks',
      'surfacePaintChunks',
      'surfaceLeftPaintChunks',
      'surfaceRightPaintChunks',
      'surfaceCoarseMeshes',
      'surfaceVertices',
      'surfacePaintFinishMaterials',
      'surfaceAsphaltSubstrateRoadChunks',
      'surfaceAsphaltSubstrateMaterials',
      'surfaceAsphaltSubstrateTextures',
      'surfaceAsphaltSubstrateSrgbTextures',
      'surfaceFormulaGroundingRoadChunks',
      'surfaceFormulaGroundingPaintChunks',
      'surfaceFormulaGroundingMaterials',
      'surfaceFormulaGroundingCars',
      'gantryState',
      'gantryParts',
      'gantryMaterials',
      'gantryTextures',
      'gantryTriangles',
      'gantrySha256',
      'lampState',
      'lampParts',
      'lampMaterials',
      'lampTriangles',
      'lampLights',
      'bannerState',
      'bannerParts',
      'bannerMaterials',
      'bannerTextures',
      'bannerTriangles',
      'bannerWidth',
      'bannerHeight',
      'bannerHardwareSrgb',
      'stripeState',
      'stripeParts',
      'stripeMaterials',
      'stripeTextures',
      'stripeTriangles',
      'stripeWidth',
      'stripeHeight',
      'stripeHardwareSrgb',
    ];
    const values = Object.fromEntries(
      keys.map((key) => [key, safely(`dataset.${key}`, () => data?.[key])]),
    );
    const raw = Object.fromEntries(keys.map((key) => [key, text(values[key], 128)]));
    const truncatedFields = keys.filter(
      (key) => typeof values[key] === 'string' && values[key].length > 128,
    );
    // Compute from full values before bounded evidence truncation. Use undefined
    // for absent values, matching the unchanged production predicate exactly.
    const submitted = Number(values.renderedFrames ?? undefined);
    const completed = Number(values.completedFrames ?? undefined);
    // Allow only documented scalar diagnostics. Foreign graph members, getters,
    // callbacks and scene/resource objects are never traversed or exposed.
    const queue = {
      pending: 'boolean',
      submitted: 'number',
      completed: 'number',
      deferredCallbacks: 'number',
      flushRefreshes: 'number',
      pendingMs: 'number',
      activeWaitMs: 'number',
      failure: 'string',
      latencyMs: 'number',
    };
    const preparation = {
      active: 'boolean',
      started: 'number',
      completed: 'number',
      failure: 'string',
      last: { label: 'string', startedAtMs: 'number', elapsedMs: 'number', state: 'string' },
    };
    const owner = {
      exists: 'boolean',
      completed: 'boolean',
      canDraw: 'boolean',
      errors: ['string'],
    };
    const schema = {
      phase: 'string',
      lastDrawCpuMs: 'number',
      drawStartedAtMs: 'number',
      losses: 'number',
      lastLoss: {
        number: 'number',
        observedAtMs: 'number',
        phase: 'string',
        pendingSequence: 'number',
        pendingSubmittedAtMs: 'number',
        pendingAgeMs: 'number',
        submitted: 'number',
        completed: 'number',
        lastCompletedSequence: 'number',
        lastDrawCpuMs: 'number',
        drawStartedAtMs: 'number',
        queue,
        preparation,
      },
      preparation,
      submitted: 'number',
      completed: 'number',
      lastCompletedSequence: 'number',
      abandoned: 'number',
      settled: 'boolean',
      lost: 'boolean',
      disposed: 'boolean',
      queue,
      readinessError: 'string',
      readiness: {
        paused: 'boolean',
        stopped: 'boolean',
        restartPending: 'boolean',
        restartRequired: 'boolean',
        resizePending: 'boolean',
        owners: { surface: owner, gantry: owner, lamps: owner, banner: owner, stripe: owner },
        schedule: { requested: 'boolean', preparationCount: 'number', pending: 'boolean' },
      },
    };
    const select = (value, allowed, path) => {
      if (value === undefined || value === null) return null;
      if (typeof allowed === 'string') {
        if (typeof value !== allowed) {
          errors.push(`${path}: invalid scalar`);
          return null;
        }
        return allowed === 'string' ? text(value) : allowed === 'number' ? finite(value) : value;
      }
      if (Array.isArray(allowed)) {
        if (!Array.isArray(value)) throw new Error(`${path}: invalid diagnostic array`);
        const result = [];
        for (let index = 0; index < Math.min(value.length, 8); index++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            result.push(null);
            continue;
          }
          result.push(select(descriptor.value, allowed[0], `${path}[${index}]`));
        }
        return result;
      }
      if (typeof value !== 'object' || Array.isArray(value))
        throw new Error(`${path}: invalid diagnostic object`);
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        throw new Error(`${path}: non-plain diagnostic object`);
      const result = {};
      for (const [key, child] of Object.entries(allowed)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && !Object.hasOwn(descriptor, 'value')) {
          errors.push(`${path}.${key}: accessor unavailable`);
          result[key] = null;
          continue;
        }
        result[key] = select(descriptor?.value, child, `${path}.${key}`);
      }
      return result;
    };
    let graphics = safely('graphics', () =>
      select(globalThis.window?.babylonGraphicsDiagnostics?.(), schema, 'graphics'),
    );
    if (new TextEncoder().encode(JSON.stringify(graphics)).length > 4096) {
      graphics = null;
      errors.push('graphics: snapshot exceeds 4096-byte limit');
    }
    return {
      renderer: {
        nowMs: finite(safely('performance.now', () => globalThis.performance?.now())),
        timeOriginMs: finite(
          safely('performance.timeOrigin', () => globalThis.performance?.timeOrigin),
        ),
      },
      dom: {
        statusText: text(safely('status.textContent', () => status?.textContent)),
        pauseButton: text(
          safely('pause.textContent', () => doc?.querySelector('#pause')?.textContent),
        ),
        loadDisabled: boolean(
          safely('load.disabled', () => doc?.querySelector('#loadAsset')?.disabled),
        ),
        hidden: boolean(safely('document.hidden', () => doc?.hidden)),
        focused: boolean(safely('document.hasFocus', () => doc?.hasFocus())),
        data: raw,
        truncatedFields,
      },
      predicate: {
        submitted: finite(submitted),
        completed: finite(completed),
        ready:
          values.presentationSettled === 'true' &&
          Number.isSafeInteger(submitted) &&
          submitted > 0 &&
          completed === submitted,
      },
      graphics,
      errors: errors.slice(0, 16),
    };
  };
  const errorText = (error) => {
    try {
      return String(error).slice(0, 256);
    } catch {
      return 'Unprintable readiness observation error';
    }
  };
  if (options?.mode === 'health') {
    // Original health-query failures, including falsy ones, must still reject.
    const document = window.motoboundGraphicsObservation?.();
    const babylon = window.babylonGraphicsDiagnostics?.();
    let readiness;
    try {
      readiness = read();
    } catch (error) {
      readiness = { observationError: errorText(error) };
    }
    return { document, babylon, readiness };
  }
  if (options?.mode === 'poll') {
    const { gateId, binding, failurePrefix } = options;
    const data = document.querySelector('#status')?.dataset;
    const submitted = Number(data?.renderedFrames);
    const completed = Number(data?.completedFrames);
    const ready =
      data?.presentationSettled === 'true' &&
      Number.isSafeInteger(submitted) &&
      submitted > 0 &&
      completed === submitted;
    const observationFailure = (phase, error) => {
      try {
        console.debug(failurePrefix + JSON.stringify({ gateId, phase, error: errorText(error) }));
      } catch {
        /* Missing diagnostic transport must not alter this predicate. */
      }
    };
    // Evidence only: no await, new timer or diagnostic-driven admission.
    try {
      const sample = read();
      if (typeof window[binding] === 'function')
        void window[binding](gateId, sample).catch((error) =>
          observationFailure('binding-rejection', error),
        );
    } catch (error) {
      observationFailure('poll-capture', error);
    }
    return ready;
  }
  return read();
}

/** Fixed-size harness evidence only. Caller-provided clocks bracket the existing
 * operation; this sink has no clock, timer, wait, renderer hook or budget owner. */
export function createNativeReadinessHistory({ maxEntries = 64 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 64)
    throw new RangeError('Native readiness history requires 1..64 entries');
  const limits = { maxEntries, maxSampleBytes: 16384, maxTotalBytes: 262144 };
  const entries = [];
  let received = 0,
    evicted = 0,
    rejected = 0,
    retainedBytes = 0;
  const safeText = (value, limit = 2048) => {
    try {
      return String(value).slice(0, limit);
    } catch {
      return 'Unprintable diagnostic failure';
    }
  };
  const copy = (input) => {
    let nodes = 0;
    const seen = new Set();
    const walk = (value, depth) => {
      if (value === null || typeof value === 'boolean') return value;
      if (typeof value === 'string') return value.slice(0, 2048);
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (!value || typeof value !== 'object' || depth > 8 || ++nodes > 256 || seen.has(value))
        return null;
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
        return null;
      seen.add(value);
      const result = Array.isArray(value) ? [] : {};
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value)).slice(
        0,
        64,
      )) {
        if (key === 'length' || key === '__proto__' || key === 'constructor' || key === 'prototype')
          continue;
        if (!Object.hasOwn(descriptor, 'value')) continue;
        if (Array.isArray(result)) result.push(walk(descriptor.value, depth + 1));
        else result[key.slice(0, 128)] = walk(descriptor.value, depth + 1);
      }
      return result;
    };
    return walk(input, 0);
  };
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
  return {
    record(phase, sample, hostBefore, hostAfter) {
      received++;
      let row;
      try {
        const copied = copy(sample);
        if (!copied || typeof copied !== 'object' || Array.isArray(copied))
          throw new Error('Missing or malformed readiness sample');
        if (bytes(copied) > limits.maxSampleBytes)
          throw new Error('Readiness sample exceeds byte limit');
        row = {
          phase: safeText(phase, 128),
          hostBefore: copy(hostBefore),
          hostAfter: copy(hostAfter),
          sample: copied,
          error: null,
        };
        if (bytes(row) > limits.maxSampleBytes + 2048)
          throw new Error('Readiness clock bracket exceeds byte limit');
      } catch (error) {
        rejected++;
        row = {
          phase: safeText(phase, 128),
          hostBefore: null,
          hostAfter: null,
          sample: null,
          error: safeText(error),
        };
      }
      const size = bytes(row);
      entries.push({ row, size });
      retainedBytes += size;
      while (entries.length > limits.maxEntries || retainedBytes > limits.maxTotalBytes) {
        // Keep phase checkpoints useful after hundreds of existing 100ms polls.
        // Still obey hard count/byte caps; oldest checkpoints yield if no polls remain.
        const poll = entries.findIndex(({ row }) => row.phase === 'poll');
        const [removed] = entries.splice(poll < 0 ? 0 : poll, 1);
        retainedBytes -= removed.size;
        evicted++;
      }
      return row.sample !== null;
    },
    snapshot() {
      return {
        version: 1,
        limits: { ...limits },
        received,
        evicted,
        rejected,
        retainedBytes,
        observations: entries.map(({ row }) => copy(row)),
      };
    },
  };
}

/** Synchronous cached-evidence recording only: never add a diagnostic wait.
 * A secondary diagnostic must never replace even a falsy primary failure. */
export function preserveNativeFailureWhileObserving(error, observe) {
  try {
    observe();
  } catch {
    /* The caller retains diagnostic errors separately. */
  }
  throw error;
}

/** Host boundary for renderer binding packets. Only the documented scalar
 * envelope crosses into evidence; no getters, unknown graph branches, callbacks
 * or resource objects are read. Malformed/oversize packets are rejected, not
 * converted into readiness or substituted for the unchanged wait predicate. */
export function normalizeNativeBabylonReadiness(value) {
  const keys = [
    'presentationSettled',
    'renderedFrames',
    'completedFrames',
    'sceneReady',
    'lastCompletedSequence',
    'abandonedFrames',
    'surfaceKind',
    'surfaceRoadChunks',
    'surfacePaintChunks',
    'surfaceLeftPaintChunks',
    'surfaceRightPaintChunks',
    'surfaceCoarseMeshes',
    'surfaceVertices',
    'surfacePaintFinishMaterials',
    'surfaceAsphaltSubstrateRoadChunks',
    'surfaceAsphaltSubstrateMaterials',
    'surfaceAsphaltSubstrateTextures',
    'surfaceAsphaltSubstrateSrgbTextures',
    'surfaceFormulaGroundingRoadChunks',
    'surfaceFormulaGroundingPaintChunks',
    'surfaceFormulaGroundingMaterials',
    'surfaceFormulaGroundingCars',
    'gantryState',
    'gantryParts',
    'gantryMaterials',
    'gantryTextures',
    'gantryTriangles',
    'gantrySha256',
    'lampState',
    'lampParts',
    'lampMaterials',
    'lampTriangles',
    'lampLights',
    'bannerState',
    'bannerParts',
    'bannerMaterials',
    'bannerTextures',
    'bannerTriangles',
    'bannerWidth',
    'bannerHeight',
    'bannerHardwareSrgb',
    'stripeState',
    'stripeParts',
    'stripeMaterials',
    'stripeTextures',
    'stripeTriangles',
    'stripeWidth',
    'stripeHeight',
    'stripeHardwareSrgb',
  ];
  const queue = {
    pending: 'boolean',
    submitted: 'number',
    completed: 'number',
    deferredCallbacks: 'number',
    flushRefreshes: 'number',
    pendingMs: 'number',
    activeWaitMs: 'number',
    failure: 'string',
    latencyMs: 'number',
  };
  const preparation = {
    active: 'boolean',
    started: 'number',
    completed: 'number',
    failure: 'string',
    last: { label: 'string', startedAtMs: 'number', elapsedMs: 'number', state: 'string' },
  };
  const owner = { exists: 'boolean', completed: 'boolean', canDraw: 'boolean', errors: ['string'] };
  const graphicsSchema = {
    phase: 'string',
    lastDrawCpuMs: 'number',
    drawStartedAtMs: 'number',
    losses: 'number',
    lastLoss: {
      number: 'number',
      observedAtMs: 'number',
      phase: 'string',
      pendingSequence: 'number',
      pendingSubmittedAtMs: 'number',
      pendingAgeMs: 'number',
      submitted: 'number',
      completed: 'number',
      lastCompletedSequence: 'number',
      lastDrawCpuMs: 'number',
      drawStartedAtMs: 'number',
      queue,
      preparation,
    },
    preparation,
    submitted: 'number',
    completed: 'number',
    lastCompletedSequence: 'number',
    abandoned: 'number',
    settled: 'boolean',
    lost: 'boolean',
    disposed: 'boolean',
    queue,
    readinessError: 'string',
    readiness: {
      paused: 'boolean',
      stopped: 'boolean',
      restartPending: 'boolean',
      restartRequired: 'boolean',
      resizePending: 'boolean',
      owners: { surface: owner, gantry: owner, lamps: owner, banner: owner, stripe: owner },
      schedule: { requested: 'boolean', preparationCount: 'number', pending: 'boolean' },
    },
  };

  const isPlain = (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const prototype = Object.getPrototypeOf(item);
    return prototype === Object.prototype || prototype === null;
  };
  const select = (item, allowed) => {
    if (item === undefined || item === null) return null;
    if (typeof allowed === 'string') {
      if (typeof item !== allowed) throw new Error('Invalid scalar');
      if (allowed === 'number' && !Number.isFinite(item)) throw new Error('Invalid number');
      if (allowed === 'string' && item.length > 2048) throw new Error('Oversize string');
      return item;
    }
    if (Array.isArray(allowed)) {
      if (!Array.isArray(item) || item.length > (allowed[1] ?? 8)) throw new Error('Invalid array');
      const result = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value'))
          throw new Error('Diagnostic accessor');
        result.push(select(descriptor.value, allowed[0]));
      }
      return result;
    }
    if (!isPlain(item)) throw new Error('Non-plain object');
    const result = {};
    for (const [key, child] of Object.entries(allowed)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new Error('Diagnostic accessor');
      result[key] = select(descriptor?.value, child);
    }
    return result;
  };
  try {
    if (!isPlain(value)) return null;
    // Required envelope objects distinguish an actual sample from arbitrary
    // payloads containing only unknown fields. All missing leaf values stay null.
    for (const key of ['renderer', 'dom', 'predicate']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !isPlain(descriptor.value))
        return null;
    }
    for (const key of ['graphics', 'errors']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    }
    const result = select(value, {
      renderer: { nowMs: 'number', timeOriginMs: 'number' },
      dom: {
        statusText: 'string',
        pauseButton: 'string',
        loadDisabled: 'boolean',
        hidden: 'boolean',
        focused: 'boolean',
        data: Object.fromEntries(keys.map((key) => [key, 'string'])),
        truncatedFields: ['string', keys.length],
      },
      predicate: { submitted: 'number', completed: 'number', ready: 'boolean' },
      graphics: graphicsSchema,
      errors: ['string', 16],
    });
    if (
      !result.dom.data ||
      !Array.isArray(result.dom.truncatedFields) ||
      !Array.isArray(result.errors) ||
      typeof result.predicate.ready !== 'boolean'
    )
      return null;
    if (Object.values(result.dom.data).some((field) => field !== null && field.length > 128))
      return null;
    if (result.dom.truncatedFields.some((key) => !keys.includes(key))) return null;
    if (new TextEncoder().encode(JSON.stringify(result.graphics)).length > 4096) return null;
    if (new TextEncoder().encode(JSON.stringify(result)).length > 16384) return null;
    return result;
  } catch {
    return null;
  }
}
