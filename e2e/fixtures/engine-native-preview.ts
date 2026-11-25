import { RacingAudio } from '../../src/audio/engine.ts';
import { validateDrivingAudio } from '../../src/audio/driving-cues.ts';

const RATE = 48000;
const settings = validateDrivingAudio({ volume: 0.8 });
export type Cancellation = 'mute' | 'stop' | 'blur';
export type PreviewState = 'menu' | 'paused';

interface Host {
  state: PreviewState;
  rumbleStops: number;
  interruptions: string[];
  releaseListener(): void;
}

/** The spec supplies the actual host suspension members and blur registration,
 * extracted without booting the application's renderer. The event target here
 * is the real browser window; the audio graph is entirely native Web Audio. */
function host(audio: RacingAudio, state: PreviewState, source: string): Host {
  const make = new Function(
    'audio',
    'state',
    `${source}; return new PreviewHost(audio, state);`,
  ) as (audio: RacingAudio, state: PreviewState) => Host;
  return make(audio, state);
}

function ownership(audio: RacingAudio) {
  return audio as unknown as { lastPreview: number; generation: number; master: GainNode | null };
}

function cancel(audio: RacingAudio, action: Cancellation) {
  if (action === 'mute') {
    audio.muted = true;
    audio.muted = false;
  } else if (action === 'stop') audio.stop();
  else window.dispatchEvent(new Event('blur'));
}

function statistics(channels: readonly Float32Array[], from = 0, to = channels[0].length / RATE) {
  const first = Math.max(0, Math.floor(from * RATE));
  const end = Math.min(channels[0].length, Math.ceil(to * RATE));
  let peak = 0;
  let squareSum = 0;
  let finite = true;
  const channelRms = channels.map((channel) => {
    let channelSum = 0;
    for (let i = first; i < end; i++) {
      const value = channel[i];
      finite &&= Number.isFinite(value);
      peak = Math.max(peak, Math.abs(value));
      channelSum += value * value;
    }
    squareSum += channelSum;
    return Math.sqrt(channelSum / Math.max(1, end - first));
  });
  return {
    from,
    to,
    finite,
    peak,
    rms: Math.sqrt(squareSum / Math.max(1, (end - first) * channels.length)),
    channelRms,
    frames: end - first,
  };
}

function samples(buffer: AudioBuffer) {
  return [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()];
}

function tones(channels: readonly Float32Array[], start: number) {
  return [0, 0.25, 0.5].map((offset) =>
    statistics(channels, start + offset + 0.03, start + offset + 0.1),
  );
}

export async function freshPreview() {
  const context = new OfflineAudioContext(2, RATE, RATE);
  const audio = new RacingAudio();
  try {
    await audio.start(context);
    audio.stop();
    const raceMasterGain = ownership(audio).master!.gain.value;
    await audio.previewDriving(settings);
    const channels = samples(await context.startRendering());
    return {
      sampleRate: context.sampleRate,
      raceMasterGain,
      signal: statistics(channels),
      tones: tones(channels, 0),
      tail: statistics(channels, 0.8, 1),
    };
  } finally {
    await audio.dispose();
  }
}

export async function cancelScheduled(action: Cancellation, state: PreviewState, source: string) {
  const context = new OfflineAudioContext(2, Math.ceil(1.8 * RATE), RATE);
  const audio = new RacingAudio();
  const owner = action === 'blur' ? host(audio, state, source) : null;
  try {
    await audio.start(context);
    audio.stop();
    await audio.previewDriving(settings);
    // Suspend the real offline renderer while the first tone is audible. Its
    // render-quantum boundary, rather than an assumed decimal time, is recorded.
    const stopping = context.suspend(0.1);
    const fresh = context.suspend(1);
    const rendering = context.startRendering();
    await stopping;
    const cancelledAt = context.currentTime;
    cancel(audio, action);
    await context.resume();
    await fresh;
    const freshAt = context.currentTime;
    await audio.previewDriving(settings);
    await context.resume();
    const channels = samples(await rendering);
    return {
      action,
      state,
      cancelledAt,
      freshAt,
      raceMasterGain: ownership(audio).master!.gain.value,
      hostState: owner?.state ?? null,
      rumbleStops: owner?.rumbleStops ?? 0,
      interruptions: owner?.interruptions ?? [],
      signal: statistics(channels),
      beforeCancellation: statistics(channels, 0.03, 0.08),
      cancelledFuture: [statistics(channels, 0.28, 0.35), statistics(channels, 0.53, 0.6)],
      freshTones: tones(channels, freshAt),
      tail: statistics(channels, 1.72, 1.8),
    };
  } finally {
    owner?.releaseListener();
    await audio.dispose();
  }
}

async function pendingRender(action: Cancellation | null, replace: boolean, source: string) {
  const context = new OfflineAudioContext(2, RATE, RATE);
  const audio = new RacingAudio();
  const owner = action === 'blur' ? host(audio, 'menu', source) : null;
  try {
    await audio.start(context);
    let staleScheduled = false;
    if (action) {
      // Even an initialized offline graph crosses previewDriving's real async
      // start boundary. Revoke that request before its continuation can run.
      const request = audio.previewDriving(settings);
      cancel(audio, action);
      await request;
      staleScheduled = Number.isFinite(ownership(audio).lastPreview);
    }
    if (replace) await audio.previewDriving(settings);
    const channels = samples(await context.startRendering());
    return { channels, staleScheduled, signal: statistics(channels) };
  } finally {
    owner?.releaseListener();
    await audio.dispose();
  }
}

export async function pendingContinuations(source: string) {
  const reference = await pendingRender(null, true, source);
  const results = [];
  for (const action of ['mute', 'stop', 'blur'] as const) {
    const cancelled = await pendingRender(action, false, source);
    const replaced = await pendingRender(action, true, source);
    let differingSamples = 0;
    let maxDifference = 0;
    for (let channel = 0; channel < reference.channels.length; channel++) {
      for (let i = 0; i < reference.channels[channel].length; i++) {
        const a = reference.channels[channel][i];
        const b = replaced.channels[channel][i];
        if (a !== b) differingSamples++;
        maxDifference = Math.max(maxDifference, Math.abs(a - b));
      }
    }
    results.push({
      action,
      staleScheduled: cancelled.staleScheduled || replaced.staleScheduled,
      cancelled: cancelled.signal,
      replaced: replaced.signal,
      differingSamples,
      maxDifference,
    });
  }
  return { reference: reference.signal, results };
}

/** A genuine suspended live context exercises the production resume await.
 * Waveform assertions use offline rendering above; this checks request ownership
 * without assuming autoplay policy or a physical speaker is available. */
export async function pendingNativeResume() {
  const context = new AudioContext({ sampleRate: RATE });
  const audio = new RacingAudio();
  try {
    await audio.start(context);
    await context.suspend();
    const before = context.state;
    const request = audio.previewDriving(settings);
    audio.muted = true;
    audio.muted = false;
    await request;
    const staleScheduled = Number.isFinite(ownership(audio).lastPreview);
    const after = context.state;
    await audio.previewDriving(settings);
    const freshScheduled = Number.isFinite(ownership(audio).lastPreview);
    audio.stop();
    return { before, after, staleScheduled, freshScheduled, sampleRate: context.sampleRate };
  } finally {
    await audio.dispose();
  }
}
