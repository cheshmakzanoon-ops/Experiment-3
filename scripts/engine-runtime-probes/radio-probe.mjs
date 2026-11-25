import { createHash } from 'node:crypto';
import { assert, BASELINE, variants } from './support.mjs';

const entry = [
  "export { RadioArbiter, URGENCY } from './src/core/radio.ts';",
  "export { FLAG } from './src/simulation/marshal.ts';",
  "export { CAR_STRIDE, F, H, HEADER, carBase } from './src/simulation/protocol.ts';",
  "export { SC_PHASE } from './src/simulation/safety-car.ts';",
].join('\n');
const { baseline, candidate, provenance } = await variants(entry, ['src/core/radio.ts']);
assert.equal(provenance.baselineRef, BASELINE);

const { CAR_STRIDE, F, FLAG, H, HEADER, SC_PHASE, URGENCY, carBase } = candidate;
const player = carBase(0);
const fieldOffsets = {
  length: H.LENGTH,
  safetyCar: H.SC_PHASE,
  flag: player + F.LOCAL_FLAG,
  penalty: player + F.PENALTY,
  controlPenalties: player + F.CONTROL_PENALTIES,
  controlSequence: player + F.CONTROL_SEQUENCE,
  warnings: player + F.WARNINGS,
  inPit: player + F.IN_PIT,
  laps: player + F.LAPS,
  fuel: player + F.FUEL,
};

function snapshot(cars = 24) {
  const frame = new Float32Array(HEADER + cars * CAR_STRIDE);
  frame[H.CARS] = cars;
  frame[H.LENGTH] = 3000;
  frame[player + F.FUEL] = 50;
  return frame;
}

const copyMessage = (message) => (message === null ? null : { ...message });
const observe = (time, fields = {}, extra = {}) => ({ op: 'observe', time, fields, ...extra });
const update = (time) => ({ op: 'update', time });
const post = (time, key, fields = {}) => ({
  op: 'post',
  time,
  message: {
    key,
    text: key,
    speaker: 'RACE CONTROL',
    urgency: URGENCY.RACE_CONTROL,
    expires: time + 5,
    hold: 2,
    ...fields,
  },
});

// This interpreter supplies inputs and records public offers/captions. The
// expected implementation is the imported Git baseline, never a reimplementation.
function runTrace(module, scenario) {
  const radio = new module.RadioArbiter(
    { engineer: scenario.engineer ?? true },
    scenario.cooldown ?? 20,
  );
  const offers = [];
  const originalPost = radio.post;
  radio.post = function (message, now) {
    offers.push({ at: now, message: copyMessage(message) });
    return originalPost.call(this, message, now);
  };
  let frame = null;
  return scenario.steps.map((step, index) => {
    const offerStart = offers.length;
    let at = step.time ?? null;
    let caption = radio.current;
    switch (step.op) {
      case 'observe': {
        const cars = step.cars ?? frame?.[H.CARS] ?? 24;
        if (frame === null || frame.length !== HEADER + cars * CAR_STRIDE) {
          frame = snapshot(cars);
        } else if (scenario.ownership === 'fresh') {
          frame = new Float32Array(frame);
        } else if (scenario.ownership === 'transferred') {
          const old = frame;
          frame = structuredClone(old, { transfer: [old.buffer] });
          assert.equal(old.byteLength, 0, 'the old fixture buffer must really detach');
        }
        frame[H.TIME] = step.time;
        frame[H.CARS] = cars;
        for (const [field, value] of Object.entries(step.fields)) {
          assert.ok(Object.hasOwn(fieldOffsets, field), 'unknown fixture field: ' + field);
          frame[fieldOffsets[field]] = value;
        }
        at = frame[H.TIME];
        caption = radio.observe(frame, step.raceLaps ?? 5);
        break;
      }
      case 'update':
        caption = radio.update(step.time);
        break;
      case 'post':
        radio.post({ ...step.message }, step.time);
        caption = radio.current;
        break;
      case 'release':
        // Simulate the caller overwriting and transferring its accepted snapshot.
        assert.ok(frame !== null);
        frame.fill(0);
        structuredClone(frame.buffer, { transfer: [frame.buffer] });
        assert.equal(frame.byteLength, 0);
        frame = null;
        caption = radio.current;
        break;
      case 'reset':
        radio.reset();
        caption = radio.current;
        break;
      default:
        assert.fail('unknown operation: ' + step.op);
    }
    return {
      step: index,
      op: step.op,
      at,
      offers: offers.slice(offerStart),
      caption: copyMessage(caption),
    };
  });
}

const transitions = [
  ['virtual-safety-car', { safetyCar: SC_PHASE.VSC }, 'sc-' + SC_PHASE.VSC],
  ['deployed-safety-car', { safetyCar: SC_PHASE.DEPLOYED }, 'sc-' + SC_PHASE.DEPLOYED],
  ['safety-car-in-this-lap', { safetyCar: SC_PHASE.IN_THIS_LAP }, 'sc-' + SC_PHASE.IN_THIS_LAP],
  ['yellow-rounded-sequence', { flag: FLAG.YELLOW, controlSequence: 1.6 }, 'yellow-2'],
  ['double-yellow', { flag: FLAG.DOUBLE_YELLOW, controlSequence: 3 }, 'yellow-3'],
  ['blue-flag', { flag: FLAG.BLUE }, 'blue'],
  ['penalty-rounding', { penalty: 5.5, controlPenalties: 2 }, 'penalty-2'],
  ['warning-rounding', { warnings: 2.5 }, 'limits-2.5'],
  ['pit-entry', { inPit: 1 }, 'pit-limit'],
  ['final-lap', { laps: 4 }, 'final-lap'],
  ['fuel-crossing', { fuel: 5 }, 'fuel'],
];
const scenarios = [];
for (const ownership of ['fresh', 'reused', 'transferred']) {
  for (const [name, fields, key] of transitions) {
    scenarios.push({
      name: name + '/' + ownership,
      ownership,
      steps: [observe(0), observe(1, fields), update(1.5), update(20)],
      expectedOfferKeys: [key],
      expectedCaptionKeys: [null, key, key, null],
    });
  }
}

scenarios.push(
  {
    name: 'simultaneous-offers-order-hold-and-expiry',
    ownership: 'reused',
    steps: [
      observe(0),
      observe(1, {
        safetyCar: SC_PHASE.VSC,
        flag: FLAG.YELLOW,
        controlSequence: 7,
        penalty: 5,
        controlPenalties: 2,
        warnings: 3,
        inPit: 1,
        laps: 4,
        fuel: 1,
      }),
      ...[4, 5, 6, 7, 12, 16].map(update),
    ],
    expectedOfferKeys: ['sc-1', 'yellow-7', 'penalty-2', 'limits-3', 'pit-limit', 'final-lap', 'fuel'],
    expectedCaptionKeys: [null, 'sc-1', 'sc-1', 'yellow-7', 'yellow-7', 'penalty-2', 'fuel', null],
  },
  {
    name: 'first-frame-and-changing-car-counts',
    ownership: 'reused',
    steps: [
      observe(0, {
        safetyCar: SC_PHASE.VSC,
        flag: FLAG.YELLOW,
        penalty: 5,
        warnings: 2,
        inPit: 1,
        laps: 4,
        fuel: 1,
      }, { cars: 1 }),
      observe(1, {
        safetyCar: SC_PHASE.DEPLOYED,
        flag: FLAG.DOUBLE_YELLOW,
        penalty: 10,
        warnings: 3,
      }, { cars: 2 }),
      observe(2),
      observe(3, { safetyCar: SC_PHASE.IN_THIS_LAP }),
      observe(4, {}, { cars: 1 }),
      observe(8),
    ],
    expectedOfferKeys: ['sc-3'],
    expectedCaptionKeys: [null, null, null, 'sc-3', 'sc-3', null],
  },
  {
    name: 'overwrite-and-detach-previous-source',
    ownership: 'reused',
    steps: [
      observe(0, { penalty: 5 }),
      { op: 'release' },
      observe(1, { penalty: 8, controlPenalties: 2 }),
      update(2),
    ],
    expectedOfferKeys: ['penalty-2'],
    expectedCaptionKeys: [null, null, 'penalty-2', 'penalty-2'],
    expectedCaptionFragment: 'Time penalty +3 s,',
  },
  {
    name: 'engineer-muted-race-control-retained',
    ownership: 'reused',
    engineer: false,
    steps: [
      observe(0),
      observe(1, { inPit: 1, laps: 4, fuel: 1 }),
      observe(2, { flag: FLAG.BLUE }),
      update(6),
    ],
    expectedOfferKeys: ['pit-limit', 'final-lap', 'fuel', 'blue'],
    expectedCaptionKeys: [null, null, 'blue', null],
  },
  {
    name: 'cooldown-survives-expiry-and-rewind-exact-boundary',
    steps: [
      post(100, 'yellow-1'),
      update(100),
      update(200),
      post(5, 'yellow-1'),
      update(5),
      post(119, 'yellow-1'),
      update(119),
      post(120, 'yellow-1'),
      update(120),
    ],
    expectedCaptionKeys: [null, 'yellow-1', null, null, null, null, null, null, 'yellow-1'],
  },
  {
    name: 'custom-cooldown-exact-boundary',
    cooldown: 3,
    steps: [
      post(10, 'custom'),
      update(10),
      update(20),
      post(0, 'custom'),
      update(0),
      post(12.999, 'custom'),
      update(12.999),
      post(13, 'custom'),
      update(13),
    ],
    expectedCaptionKeys: [null, 'custom', null, null, null, null, null, null, 'custom'],
  },
  {
    name: 'reset-clears-caption-queue-history-and-comparison',
    ownership: 'reused',
    steps: [
      observe(100),
      post(100, 'yellow-1'),
      update(100),
      post(101, 'queued'),
      { op: 'reset' },
      observe(1, { safetyCar: SC_PHASE.DEPLOYED }),
      post(1, 'yellow-1'),
      update(1),
      update(4),
      observe(5, { safetyCar: SC_PHASE.IN_THIS_LAP }),
    ],
    expectedCaptionKeys: [null, null, 'yellow-1', 'yellow-1', null, null, null, 'yellow-1', null, 'sc-3'],
  },
  {
    name: 'urgent-interruption-and-stale-queued-message',
    steps: [
      post(0, 'tip', { urgency: URGENCY.INFO, speaker: 'ENGINEER' }),
      update(0),
      post(0.5, 'control'),
      update(0.5),
      post(1, 'late', { urgency: URGENCY.STRATEGY, speaker: 'ENGINEER' }),
      update(20),
    ],
    expectedCaptionKeys: [null, 'tip', 'tip', 'control', 'control', null],
  },
  {
    name: 'queued-key-replacement-preserves-equal-priority-order',
    cooldown: 0,
    steps: [
      post(0, 'a'),
      post(0, 'b'),
      post(0.5, 'a', { text: 'replacement a' }),
      update(1),
      update(3),
      update(5),
    ],
    expectedCaptionKeys: [null, null, null, 'b', 'a', null],
  },
  {
    name: 'expiry-equality-is-inclusive',
    steps: [
      post(0, 'expiry', { hold: 10, expires: 2 }),
      update(0),
      update(2),
      update(2.25),
    ],
    expectedCaptionKeys: [null, 'expiry', 'expiry', null],
  },
  {
    name: 'single-lap-finish-does-not-offer-final-lap-or-fuel',
    ownership: 'reused',
    steps: [observe(0, {}, { raceLaps: 1 }), observe(1, { laps: 1, fuel: 0 }, { raceLaps: 1 })],
    expectedOfferKeys: [],
    expectedCaptionKeys: [null, null],
  },
);

const seed = 0x25a5c0de;
function mixedSteps() {
  let state = seed;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const steps = [];
  const flags = [FLAG.GREEN, FLAG.YELLOW, FLAG.DOUBLE_YELLOW, FLAG.BLUE, FLAG.CHEQUERED];
  let time = 100;
  for (let index = 0; index < 512; index++) {
    if (index > 0 && index % 73 === 0) time -= 40;
    if (index > 0 && index % 127 === 0) steps.push({ op: 'reset' });
    time += 0.5;
    const bits = random();
    steps.push(observe(time, {
      safetyCar: bits % 4,
      flag: flags[(bits >>> 3) % flags.length],
      controlSequence: index % 12 + 0.6,
      penalty: ((bits >>> 7) % 9) * 2.5,
      controlPenalties: (bits >>> 11) % 8,
      warnings: (bits >>> 15) % 5,
      inPit: (bits >>> 18) % 2,
      laps: (bits >>> 20) % 6,
      fuel: (bits >>> 23) % 12,
      length: index % 17 === 0 ? 5000 : 3000,
    }, {
      cars: [1, 24, 32][Math.floor(index / 64) % 3],
      raceLaps: index % 19 === 0 ? 1 : 5,
    }));
    if (index % 11 === 0) steps.push(update(time + 0.25));
  }
  return steps;
}
for (const ownership of ['fresh', 'reused', 'transferred']) {
  scenarios.push({
    name: 'seeded-mixed-events-rewinds-count-changes-and-resets/' + ownership,
    ownership,
    steps: mixedSteps(),
  });
}

const equivalenceCases = scenarios.map((scenario) => {
  const before = runTrace(baseline, scenario);
  const after = runTrace(candidate, scenario);
  assert.deepEqual(after, before, 'baseline event/caption stream mismatch: ' + scenario.name);
  const offers = after.flatMap((step) => step.offers);
  if (scenario.expectedOfferKeys) {
    assert.deepEqual(
      offers.map(({ message }) => message.key),
      scenario.expectedOfferKeys,
      'fixture must exercise its intended offers: ' + scenario.name,
    );
  }
  if (scenario.expectedCaptionKeys) {
    assert.deepEqual(
      after.map(({ caption }) => caption?.key ?? null),
      scenario.expectedCaptionKeys,
      'fixture must exercise its intended captions: ' + scenario.name,
    );
  }
  if (scenario.expectedCaptionFragment) {
    assert.ok(after.some(({ caption }) => caption?.text.includes(scenario.expectedCaptionFragment)));
  }
  return {
    name: scenario.name,
    operations: after.length,
    observations: scenario.steps.filter((step) => step.op === 'observe').length,
    postOffers: offers.length,
    nonNullCaptionSamples: after.filter((step) => step.caption !== null).length,
    streamSha256: createHash('sha256').update(JSON.stringify(after)).digest('hex'),
  };
});

function countFrameSlices(module, cars, observations) {
  const frame = snapshot(cars);
  const radio = new module.RadioArbiter();
  const original = Float32Array.prototype.slice;
  const descriptor = Object.getOwnPropertyDescriptor(Float32Array.prototype, 'slice');
  const result = {
    observations,
    frameBytes: frame.byteLength,
    sliceCalls: 0,
    sliceCopiedBytes: 0,
    fullFrameSliceCalls: 0,
    fullFrameCopiedBytes: 0,
  };
  Object.defineProperty(Float32Array.prototype, 'slice', {
    configurable: true,
    writable: true,
    value: function (...args) {
      const copied = Reflect.apply(original, this, args);
      result.sliceCalls++;
      result.sliceCopiedBytes += copied.byteLength;
      if (this === frame && copied.byteLength === frame.byteLength) {
        result.fullFrameSliceCalls++;
        result.fullFrameCopiedBytes += copied.byteLength;
      }
      return copied;
    },
  });
  try {
    // No awaits, concurrent work, frame construction, or fixture cloning inside this scope.
    for (let index = 0; index < observations; index++) {
      frame[H.TIME] = index / 60;
      assert.equal(radio.observe(frame, 5), null, 'ordinary frames must stay silent');
    }
  } finally {
    if (descriptor) Object.defineProperty(Float32Array.prototype, 'slice', descriptor);
    else delete Float32Array.prototype.slice;
  }
  return result;
}

const observations = 600;
const copyCounts = [1, 24, 32].map((cars) => {
  const before = countFrameSlices(baseline, cars, observations);
  const after = countFrameSlices(candidate, cars, observations);
  assert.equal(before.sliceCalls, observations, 'baseline must actually execute its frame slices');
  assert.equal(before.fullFrameSliceCalls, observations);
  assert.equal(before.fullFrameCopiedBytes, observations * before.frameBytes);
  assert.equal(before.sliceCopiedBytes, before.fullFrameCopiedBytes);
  assert.equal(after.frameBytes, before.frameBytes);
  assert.equal(after.sliceCalls, 0, 'candidate must eliminate observed Float32Array slice calls');
  assert.equal(after.sliceCopiedBytes, 0);
  assert.equal(after.fullFrameSliceCalls, 0);
  assert.equal(after.fullFrameCopiedBytes, 0);
  return { cars, baseline: before, candidate: after };
});

console.log(JSON.stringify({
  probe: 'radio',
  status: 'passed',
  provenance,
  equivalence: {
    equal: true,
    seed,
    scenarios: equivalenceCases.length,
    observationsPerVariant: equivalenceCases.reduce((sum, scenario) => sum + scenario.observations, 0),
    cases: equivalenceCases,
  },
  copyCounts: {
    measurement: 'Float32Array.slice calls and returned bytes during synchronous observe calls',
    observationsPerCasePerVariant: observations,
    cases: copyCounts,
  },
  limitations: [
    'Only src/core/radio.ts is replaced by baseline source; dependencies use the same candidate checkout.',
    'Copy counters cover Float32Array.slice, not all allocations, retained heap, garbage collection, or elapsed time.',
    'No whole-game or FPS improvement is measured or claimed.',
  ],
}, null, 2));
