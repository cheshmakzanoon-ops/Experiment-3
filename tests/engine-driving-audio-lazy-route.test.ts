import { afterEach, describe, expect, it, vi } from 'vitest';
import { RacingAudio } from '../src/audio/engine.ts';
import { CueSynth, CUE_PEAK, validateDrivingAudio } from '../src/audio/driving-cues.ts';
import type { AudioView } from '../src/audio/spatial.ts';
import { GUIDE_SPACING } from '../src/rendering/driving-guide.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { FakeContext, asContext } from './fake-audio.ts';

class LiveContext extends FakeContext {
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

const view: AudioView = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  rightX: 1,
  rightY: 0,
  rightZ: 0,
  interior: true,
  followedCar: 0,
};
const enabled = validateDrivingAudio({
  enabled: true,
  brake: false,
  turns: false,
  trackLimits: false,
  wrongWay: false,
});
const upshift = { kind: 'upshift', frequency: 1100, pan: 0, duration: 0.09 };
const owners: RacingAudio[] = [];

function trackFixture() {
  const track = new Track('clear', true),
    point = track.at(30, trackPoint()),
    frame = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  frame[H.CARS] = 1;
  frame[H.PHASE] = 2;
  frame[H.TICK] = 1;
  frame[o + F.S] = 30;
  frame[o + F.QW] = 1;
  frame[o + F.SPEED] = 35;
  frame[o + F.RPM] = 12500;
  frame[o + F.GEAR] = 3;
  frame[o + F.THROTTLE] = 1;
  frame[o + F.VX] = point.tx * 35;
  frame[o + F.VZ] = point.tz * 35;
  // Count the production route's work after fixture construction. Neither the
  // director, GuideRoute nor Track.at is replaced by a stand-in.
  const at = vi.spyOn(track, 'at');
  return { track, frame, at, routeSamples: Math.ceil(track.length / GUIDE_SPACING) };
}

function fixture() {
  const audio = new RacingAudio(),
    context = new LiveContext();
  owners.push(audio);
  return { audio, context, ...trackFixture() };
}

function update(
  audio: RacingAudio,
  context: LiveContext,
  frame: Float32Array,
  time: number,
  playing = true,
  liveHuman = true,
) {
  context.currentTime = time;
  frame[H.TICK]++;
  audio.update(frame, true, playing, view, liveHuman);
}

afterEach(async () => {
  for (const audio of owners.splice(0)) await audio.dispose();
  vi.restoreAllMocks();
});

describe('lazy driving-audio route ownership', () => {
  it.each([
    ['default disabled', validateDrivingAudio(null)],
    ['zero cue volume', { ...enabled, volume: 0 }],
    ['all cue types disabled', { ...enabled, gears: false }],
  ] as const)(
    'does no route work with %s settings, before or after audio startup',
    async (_, settings) => {
      const { audio, context, track, frame, at } = fixture(),
        play = vi.spyOn(CueSynth.prototype, 'play'),
        silence = vi.spyOn(CueSynth.prototype, 'silence');
      audio.configureDriving(track, settings);
      audio.configureDriving(track, settings);
      expect(at).not.toHaveBeenCalled();
      expect(audio.diagnostics().state).toBe('uninitialized');
      await audio.start(asContext(context));
      update(audio, context, frame, 0);
      update(audio, context, frame, 0.1);
      expect(at).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      // Inactive settings must not add recurring AudioParam cancellation work.
      expect(silence).not.toHaveBeenCalled();
      expect(audio.diagnostics().drivingCues).toEqual({
        enabled: settings.enabled,
        last: null,
        emitted: 0,
      });
    },
  );

  it('builds once at first live use and schedules the original cue envelope with the latest settings', async () => {
    const { audio, context, track, frame, at, routeSamples } = fixture(),
      play = vi.spyOn(CueSynth.prototype, 'play');
    audio.configureDriving(track, enabled);
    update(audio, context, frame, 0);
    expect(at).not.toHaveBeenCalled();
    await audio.start(asContext(context));
    update(audio, context, frame, 0, false);
    update(audio, context, frame, 0.1, true, false);
    audio.muted = true;
    update(audio, context, frame, 0.2);
    audio.muted = false;
    expect(at).not.toHaveBeenCalled();

    const settings = { ...enabled, volume: 0.7 };
    audio.configureDriving(track, settings);
    settings.volume = 0;
    update(audio, context, frame, 0.3);
    expect(routeSamples).toBe(744);
    expect(at).toHaveBeenCalledTimes(routeSamples + 2);
    expect(play).toHaveBeenCalledExactlyOnceWith(upshift, 0.3, 0.7);
    const oscillator = context
      .of('oscillator')
      .find((node) =>
        node.frequency.events.some((event) => event.kind === 'set' && event.value === 1100),
      );
    expect(oscillator).toBeDefined();
    expect(oscillator!.outputs[0].gain.events.slice(-4)).toEqual([
      { kind: 'cancel', value: 0, time: 0.3 },
      { kind: 'set', value: 0, time: 0.3 },
      { kind: 'linear', value: 0.7 * CUE_PEAK, time: 0.3 + 0.012 },
      { kind: 'linear', value: 0, time: 0.3 + 0.09 },
    ]);
    update(audio, context, frame, 0.4);
    expect(at).toHaveBeenCalledTimes(routeSamples + 4);
    expect(play).toHaveBeenCalledTimes(1);
    update(audio, context, frame, 0.8);
    expect(at).toHaveBeenCalledTimes(routeSamples + 6);
    expect(play).toHaveBeenLastCalledWith(upshift, 0.8, 0.7);
  });

  it('reuses a same-track route while resetting cooldowns on configuration and stop', async () => {
    const { audio, context, track, frame, at, routeSamples } = fixture(),
      play = vi.spyOn(CueSynth.prototype, 'play');
    audio.configureDriving(track, enabled);
    await audio.start(asContext(context));
    update(audio, context, frame, 0);
    expect(play).toHaveBeenCalledTimes(1);
    audio.configureDriving(track, { ...enabled, enabled: false });
    expect(audio.diagnostics().drivingCues.last).toBeNull();
    update(audio, context, frame, 0.1);
    expect(at).toHaveBeenCalledTimes(routeSamples + 2);
    expect(play).toHaveBeenCalledTimes(1);
    audio.configureDriving(track, enabled);
    update(audio, context, frame, 0.2);
    expect(play).toHaveBeenCalledTimes(2);
    update(audio, context, frame, 0.3);
    expect(play).toHaveBeenCalledTimes(2);
    audio.configureDriving(track, enabled);
    update(audio, context, frame, 0.4);
    expect(play).toHaveBeenCalledTimes(3);
    audio.stop();
    expect(audio.diagnostics().drivingCues.last).toBeNull();
    update(audio, context, frame, 0.5);
    expect(play).toHaveBeenCalledTimes(4);
    expect(at).toHaveBeenCalledTimes(routeSamples + 10);
    expect(audio.diagnostics().drivingCues.emitted).toBe(4);
  });

  it.each([false, true])(
    'retains only the latest track across a disabled replacement (old route built: %s)',
    async (warm) => {
      const { audio, context, track, frame, at, routeSamples } = fixture(),
        next = trackFixture(),
        play = vi.spyOn(CueSynth.prototype, 'play');
      audio.configureDriving(track, warm ? enabled : validateDrivingAudio(null));
      await audio.start(asContext(context));
      update(audio, context, frame, 0);
      at.mockClear();
      play.mockClear();
      audio.configureDriving(next.track, validateDrivingAudio(null));
      update(audio, context, next.frame, 0.1);
      expect(at).not.toHaveBeenCalled();
      expect(next.at).not.toHaveBeenCalled();
      expect(audio.diagnostics().drivingCues).toEqual({ enabled: false, last: null, emitted: 0 });
      audio.configureDriving(next.track, enabled);
      update(audio, context, next.frame, 0.2);
      expect(at).not.toHaveBeenCalled();
      expect(next.at).toHaveBeenCalledTimes(next.routeSamples + 2);
      expect(play).toHaveBeenCalledExactlyOnceWith(upshift, 0.2, enabled.volume);
      audio.configureDriving(track, enabled);
      update(audio, context, frame, 0.3);
      expect(at).toHaveBeenCalledTimes(routeSamples + 2);
      expect(next.at).toHaveBeenCalledTimes(next.routeSamples + 2);
      expect(play).toHaveBeenLastCalledWith(upshift, 0.3, enabled.volume);
      expect(audio.diagnostics().drivingCues.emitted).toBe(1);
    },
  );

  it('releases a pending track on disposal even when audio was never initialized', async () => {
    const { audio, context, track, frame, at, routeSamples } = fixture(),
      play = vi.spyOn(CueSynth.prototype, 'play');
    audio.configureDriving(track, enabled);
    await audio.dispose();
    await audio.start(asContext(context));
    update(audio, context, frame, 0);
    expect(at).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    audio.configureDriving(track, enabled);
    update(audio, context, frame, 0.1);
    expect(at).toHaveBeenCalledTimes(routeSamples + 2);
    expect(play).toHaveBeenCalledExactlyOnceWith(upshift, 0.1, enabled.volume);
  });

  it('revokes a warm route before close settles and keeps the replacement context cue timing', async () => {
    const { audio, context, track, frame, at, routeSamples } = fixture(),
      nextContext = new LiveContext(),
      play = vi.spyOn(CueSynth.prototype, 'play');
    let closed!: () => void;
    context.close.mockReturnValue(new Promise<void>((resolve) => (closed = resolve)));
    audio.configureDriving(track, enabled);
    await audio.start(asContext(context));
    update(audio, context, frame, 100);
    at.mockClear();
    play.mockClear();
    const disposing = audio.dispose();
    expect(audio.diagnostics().drivingCues).toEqual({ enabled: true, last: null, emitted: 0 });
    await audio.start(asContext(nextContext));
    update(audio, nextContext, frame, 0);
    expect(at).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    audio.configureDriving(track, enabled);
    update(audio, nextContext, frame, 0.1);
    expect(at).toHaveBeenCalledTimes(routeSamples + 2);
    expect(play).toHaveBeenCalledExactlyOnceWith(upshift, 0.1, enabled.volume);
    closed();
    await disposing;
    update(audio, nextContext, frame, 0.2);
    expect(at).toHaveBeenCalledTimes(routeSamples + 4);
    expect(play).toHaveBeenCalledTimes(1);
    expect(audio.diagnostics().state).toBe('running');
    expect(nextContext.close).not.toHaveBeenCalled();
  });
});
