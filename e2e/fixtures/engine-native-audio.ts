import { PowerUnitAudio } from '../../src/audio/power-unit.ts';
import { CAR_STRIDE, F, HEADER, R, RACE_BASE, carBase } from '../../src/simulation/protocol.ts';
import { vehicleIndex } from '../../src/simulation/vehicles.ts';

const SAMPLE_RATE = 48000;
const CAR = carBase(0);

type OwnedVoice = { source: AudioBufferSourceNode };

/** Read ownership only; every context, node, parameter, render and ended event
 * in this fixture is supplied by the browser's native Web Audio implementation. */
function voices(audio: PowerUnitAudio) {
  return (audio as unknown as { voices: ReadonlySet<OwnedVoice> }).voices;
}

function frame(rpm: number, speed: number, gear: number) {
  const result = new Float32Array(HEADER + CAR_STRIDE);
  result[CAR + F.RPM] = rpm;
  result[CAR + F.ENGINE_TORQUE] = -50;
  result[CAR + F.THROTTLE] = 0;
  result[CAR + F.SPEED] = speed;
  result[CAR + F.GEAR] = gear;
  return result;
}

function graph(seconds: number) {
  const context = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  return { context, audio: new PowerUnitAudio(context, context.destination) };
}

function signal(samples: Float32Array) {
  let peak = 0;
  let squareSum = 0;
  let finite = true;
  for (const sample of samples) {
    finite &&= Number.isFinite(sample);
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
  }
  return { finite, peak, rms: Math.sqrt(squareSum / samples.length), samples: samples.length };
}

/** Subscribe without replacing PowerUnitAudio's own onended cleanup. Waiting
 * for both native rendering and all expected native events avoids assuming an
 * ordering between the OfflineAudioContext completion and ended task queues. */
async function render(context: OfflineAudioContext, audio: PowerUnitAudio) {
  const ownedBefore = voices(audio).size;
  let ended = 0;
  const completed = [...voices(audio)].map(
    ({ source }) =>
      new Promise<void>((resolve) => {
        source.addEventListener(
          'ended',
          () => {
            ended++;
            resolve();
          },
          { once: true },
        );
      }),
  );
  const buffer = await context.startRendering();
  await Promise.all(completed);
  return {
    samples: buffer.getChannelData(0).slice(),
    ownedBefore,
    ownedAfter: voices(audio).size,
    ended,
    finalTime: context.currentTime,
  };
}

async function trajectory(hz: number, crackles: boolean) {
  const { context, audio } = graph(10.4);
  try {
    const data = frame(crackles ? 12000 : 7000, 70, 6);
    for (let step = 0; step <= 10 * hz; step++) audio.update(data, 0, step / hz, 1, true);
    const beforeRendering = context.currentTime;
    const bursts = audio.bursts;
    const result = await render(context, audio);
    return { hz, crackles, beforeRendering, bursts, ...result };
  } finally {
    audio.dispose();
  }
}

/** The low-RPM reference has the same load, road speed, gear and oscillator
 * targets. Subtracting it isolates audible crackles from constant gear whine. */
export async function offlineCadence() {
  const slow = await trajectory(5, true);
  const fast = await trajectory(60, true);
  const quiet = await trajectory(5, false);
  const lateTransientRms = [];
  for (let second = 6; second < 10; second++) {
    let squareSum = 0;
    for (let i = second * SAMPLE_RATE; i < (second + 1) * SAMPLE_RATE; i++) {
      const difference = slow.samples[i] - quiet.samples[i];
      squareSum += difference * difference;
    }
    lateTransientRms.push({ second, rms: Math.sqrt(squareSum / SAMPLE_RATE) });
  }
  const summarize = ({ samples, ...result }: Awaited<ReturnType<typeof trajectory>>) => ({
    ...result,
    signal: signal(samples),
  });
  return {
    sampleRate: SAMPLE_RATE,
    slow: summarize(slow),
    fast: summarize(fast),
    quiet: summarize(quiet),
    lateTransientRms,
  };
}

function scheduleShifts(audio: PowerUnitAudio, loaded = false) {
  for (let step = 0; step <= 10; step++) {
    const data = frame(
      loaded ? 6000 + step * 400 : 1000,
      loaded ? 25 + step * 4 : 0,
      step % 2 ? 2 : 1,
    );
    if (loaded) {
      // Materially different old fixed-graph targets: alternating loaded
      // combustion/electric states activate turbo, whine and motor automation.
      data[CAR + F.ENGINE_TORQUE] = 400 + step * 20;
      data[CAR + F.THROTTLE] = 1;
      data[CAR + RACE_BASE + R.VEHICLE] = vehicleIndex(step % 2 ? 'eh3' : 'apx01');
    }
    audio.update(data, 0, step / 10, 1, true);
  }
}

async function resetRender(replace: boolean, oldTimeline: boolean) {
  const { context, audio } = graph(1.4);
  try {
    if (oldTimeline) scheduleShifts(audio, true);
    const oldVoices = [...voices(audio)];
    const oldBursts = audio.bursts;
    if (oldTimeline) audio.reset();
    const afterReset = voices(audio).size;
    const oldHandlersReleased = oldVoices.every(({ source }) => source.onended === null);
    if (replace) {
      audio.update(frame(1000, 0, 1), 0, 0, 1, true);
      // An uncancelled old downshift at 0.2 s would alter this impulse's shared
      // filter while it is audible; old loaded targets would also reopen the
      // otherwise silent fixed oscillators. No audio has rendered before reset,
      // so phase is identical and fresh/reset graphs must agree exactly.
      audio.update(frame(1000, 0, 2), 0, 0.19, 1, true);
    }
    const result = await render(context, audio);
    return { oldBursts, afterReset, oldHandlersReleased, bursts: audio.bursts, ...result };
  } finally {
    audio.dispose();
  }
}

export async function resetTimeline() {
  const cancelled = await resetRender(false, true);
  const replaced = await resetRender(true, true);
  const fresh = await resetRender(true, false);
  let differingSamples = 0;
  let maxDifference = 0;
  for (let i = 0; i < replaced.samples.length; i++) {
    const difference = Math.abs(replaced.samples[i] - fresh.samples[i]);
    if (replaced.samples[i] !== fresh.samples[i]) differingSamples++;
    maxDifference = Math.max(maxDifference, difference);
  }
  const summarize = ({ samples, ...result }: Awaited<ReturnType<typeof resetRender>>) => ({
    ...result,
    signal: signal(samples),
  });
  return {
    cancelled: summarize(cancelled),
    replaced: summarize(replaced),
    fresh: summarize(fresh),
    differingSamples,
    maxDifference,
  };
}

export async function disposedTimeline() {
  const { context, audio } = graph(1.4);
  try {
    scheduleShifts(audio);
    const scheduled = audio.bursts;
    const beforeDispose = voices(audio).size;
    audio.dispose();
    audio.dispose();
    audio.reset();
    audio.update(frame(12000, 70, 7), 0, 0.2, 1, true);
    const afterDispose = voices(audio).size;
    const { samples, ...result } = await render(context, audio);
    return {
      scheduled,
      beforeDispose,
      afterDispose,
      finalBursts: audio.bursts,
      ...result,
      signal: signal(samples),
    };
  } finally {
    audio.dispose();
  }
}
