import { afterEach, describe, expect, it, vi } from 'vitest';
import { RacingAudio } from '../src/audio/engine.ts';
import { CueSynth, validateDrivingAudio } from '../src/audio/driving-cues.ts';
import { EngineVoices } from '../src/audio/engine-voices.ts';
import { ContactAudio } from '../src/audio/surface-audio.ts';
import { PowerUnitAudio } from '../src/audio/power-unit.ts';
import { StartLightsAudio } from '../src/audio/start-lights.ts';
import { MasterBus } from '../src/audio/mixer.ts';
import { MusicBus } from '../src/audio/music.ts';
import type { AudioView } from '../src/audio/spatial.ts';
import { FakeContext, asContext } from './fake-audio.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ready, failed) => {
    resolve = ready;
    reject = failed;
  });
  return { promise, resolve, reject };
}

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
  interior: false,
  followedCar: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RacingAudio context and graph ownership', () => {
  it('revokes the old graph synchronously while close is still pending', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      closed = deferred();
    ctx.close.mockReturnValue(closed.promise);
    await audio.start(asContext(ctx));
    const disposing = audio.dispose();
    expect(audio.diagnostics().state).toBe('uninitialized');
    expect(audio.locked).toBe(false);
    expect(() => audio.captureOutput()).toThrow('not initialized');
    ctx.currentTime = 1;
    expect(() => audio.update(new Float32Array(), true, true, view)).not.toThrow();
    closed.resolve();
    await disposing;
  });

  it('closes a context only once across repeated concurrent disposal', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      closed = deferred();
    ctx.close.mockReturnValue(closed.promise);
    await audio.start(asContext(ctx));
    const first = audio.dispose(),
      second = audio.dispose();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    closed.resolve();
    await Promise.all([first, second]);
    expect(
      ctx.nodes.filter((node) => node.started.length).every((node) => node.stopped.length === 1),
    ).toBe(true);
  });

  it('starts a fresh graph during old close and preserves it after that close resolves', async () => {
    const audio = new RacingAudio(),
      old = new LiveContext(),
      next = new LiveContext(),
      closed = deferred();
    old.close.mockReturnValue(closed.promise);
    await audio.start(asContext(old));
    const disposing = audio.dispose();
    await audio.start(asContext(next));
    expect(next.nodes.length).toBeGreaterThan(100);
    const liveNodes = next.nodes.length;
    closed.resolve();
    await disposing;
    expect(audio.diagnostics().state).toBe('running');
    await audio.start(asContext(next));
    expect(next.nodes).toHaveLength(liveNodes);
    expect(next.close).not.toHaveBeenCalled();
    await audio.dispose();
    expect(next.close).toHaveBeenCalledTimes(1);
  });

  it('permits retry after a rejected close without retaining the failed context', async () => {
    const audio = new RacingAudio(),
      old = new LiveContext(),
      next = new LiveContext(),
      failure = new Error('device closed externally');
    old.close.mockRejectedValue(failure);
    await audio.start(asContext(old));
    await expect(audio.dispose()).rejects.toBe(failure);
    expect(audio.diagnostics().state).toBe('uninitialized');
    await audio.start(asContext(next));
    expect(next.nodes.length).toBeGreaterThan(100);
    expect(audio.diagnostics().state).toBe('running');
    await audio.dispose();
  });

  it('does not let an old rejected close overwrite a replacement graph', async () => {
    const audio = new RacingAudio(),
      old = new LiveContext(),
      next = new LiveContext(),
      closed = deferred(),
      failure = new Error('old close failed');
    old.close.mockReturnValue(closed.promise);
    await audio.start(asContext(old));
    const disposing = audio.dispose();
    const rejected = expect(disposing).rejects.toBe(failure);
    await audio.start(asContext(next));
    closed.reject(failure);
    await rejected;
    expect(audio.diagnostics().state).toBe('running');
    expect(next.nodes.length).toBeGreaterThan(100);
    await audio.dispose();
  });

  it('releases independent owners and closes the context after one owner throws', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      failure = new Error('cue disposal failed');
    await audio.start(asContext(ctx));
    const synth = vi.spyOn(CueSynth.prototype, 'dispose').mockImplementationOnce(() => {
      throw failure;
    });
    const owners = [
      vi.spyOn(ContactAudio.prototype, 'dispose'),
      vi.spyOn(PowerUnitAudio.prototype, 'dispose'),
      vi.spyOn(StartLightsAudio.prototype, 'dispose'),
      vi.spyOn(MusicBus.prototype, 'dispose'),
      vi.spyOn(EngineVoices.prototype, 'dispose'),
      vi.spyOn(MasterBus.prototype, 'dispose'),
    ];
    await expect(audio.dispose()).rejects.toBe(failure);
    expect(synth).toHaveBeenCalledTimes(2);
    for (const owner of owners) expect(owner).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audio.diagnostics().state).toBe('uninitialized');
    expect(ctx.of('source').every((source) => source.stopped.length === 1)).toBe(true);
  });

  it('preserves the first thrown value while continuing node and context cleanup', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext();
    await audio.start(asContext(ctx));
    vi.spyOn(CueSynth.prototype, 'dispose').mockImplementationOnce(() => {
      throw undefined;
    });
    ctx.close.mockRejectedValue(new Error('later close error'));
    const outcome = audio.dispose().then(
      () => ({ ok: true }),
      (error: unknown) => ({ ok: false, error }),
    );
    expect(await outcome).toEqual({ ok: false, error: undefined });
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audio.diagnostics().state).toBe('uninitialized');
  });

  it('does not redispose a graph when a child cleanup calls dispose again', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext();
    await audio.start(asContext(ctx));
    const original = CueSynth.prototype.dispose;
    let nested: Promise<void> | undefined;
    const synth = vi.spyOn(CueSynth.prototype, 'dispose').mockImplementationOnce(function (
      this: CueSynth,
    ) {
      nested = audio.dispose();
      original.call(this);
    });
    await audio.dispose();
    await nested;
    expect(synth).toHaveBeenCalledTimes(2);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('cleans an interrupted graph build and allows the next startup to build normally', async () => {
    const audio = new RacingAudio(),
      broken = new LiveContext(),
      next = new LiveContext(),
      failure = new Error('buffer allocation failed');
    vi.spyOn(broken, 'createBuffer').mockImplementationOnce(() => {
      throw failure;
    });
    await expect(audio.start(asContext(broken))).rejects.toBe(failure);
    expect(broken.close).toHaveBeenCalledTimes(1);
    expect(audio.diagnostics().state).toBe('uninitialized');
    expect(broken.nodes[0].outputs).toHaveLength(0);
    expect(
      broken.nodes.filter((node) => node.started.length).every((node) => node.stopped.length === 1),
    ).toBe(true);
    await audio.start(asContext(next));
    expect(next.nodes.length).toBeGreaterThan(100);
    await audio.dispose();
  });

  it('owns partially allocated ambient nodes before a later allocation fails', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      failure = new Error('ambient filter allocation failed');
    const createFilter = ctx.createBiquadFilter.bind(ctx);
    vi.spyOn(ctx, 'createBiquadFilter').mockImplementation(() => {
      if (ctx.of('source').length === 1) throw failure;
      return createFilter();
    });
    const createSource = ctx.createBufferSource.bind(ctx);
    const disconnects: (() => void)[] = [];
    vi.spyOn(ctx, 'createBufferSource').mockImplementation(() => {
      const source = createSource();
      vi.spyOn(source, 'disconnect');
      disconnects.push(source.disconnect);
      return source;
    });
    await expect(audio.start(asContext(ctx))).rejects.toBe(failure);
    expect(disconnects).toHaveLength(1);
    expect(disconnects[0]).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed construction promptly while its background close remains pending', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      closed = deferred(),
      failure = new Error('failed graph');
    ctx.close.mockReturnValue(closed.promise);
    vi.spyOn(ctx, 'createGain').mockImplementationOnce(() => {
      throw failure;
    });
    await expect(audio.start(asContext(ctx))).rejects.toBe(failure);
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audio.diagnostics().state).toBe('uninitialized');
    closed.resolve();
    await audio.dispose();
  });

  it('keeps the constructor failure when background cleanup also rejects', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      failure = new Error('failed graph');
    ctx.close.mockRejectedValue(new Error('failed close'));
    vi.spyOn(ctx, 'createGain').mockImplementationOnce(() => {
      throw failure;
    });
    await expect(audio.start(asContext(ctx))).rejects.toBe(failure);
    await Promise.resolve();
    expect(ctx.close).toHaveBeenCalledTimes(1);
    expect(audio.diagnostics().state).toBe('uninitialized');
  });

  it('does not close a borrowed offline rendering context', async () => {
    const audio = new RacingAudio(),
      ctx = Object.assign(new LiveContext(), { startRendering: vi.fn() });
    await audio.start(asContext(ctx));
    await audio.dispose();
    expect(ctx.close).not.toHaveBeenCalled();
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(
      ctx.nodes.filter((node) => node.started.length).every((node) => node.stopped.length === 1),
    ).toBe(true);
  });

  it('reuses a ready graph across repeated starts', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext();
    await audio.start(asContext(ctx));
    const nodes = ctx.nodes.length;
    await audio.start(asContext(ctx));
    expect(ctx.nodes).toHaveLength(nodes);
    expect(ctx.resume).not.toHaveBeenCalled();
    await audio.dispose();
  });
});

describe('RacingAudio activation and preview lifetime', () => {
  it('keeps the production graph available after a synchronous resume refusal', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext();
    ctx.state = 'suspended';
    ctx.resume.mockImplementationOnce(() => {
      throw new Error('activation refused synchronously');
    });
    await expect(audio.start(asContext(ctx))).resolves.toBeUndefined();
    expect(audio.locked).toBe(true);
    const nodes = ctx.nodes.length;
    await audio.start();
    expect(ctx.nodes).toHaveLength(nodes);
    expect(audio.locked).toBe(false);
    await audio.dispose();
  });

  it('bounds an unresolved resume and ignores its late settlement after disposal', async () => {
    vi.useFakeTimers();
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      resumed = deferred();
    ctx.state = 'suspended';
    ctx.resume.mockReturnValue(resumed.promise);
    const starting = audio.start(asContext(ctx));
    await vi.advanceTimersByTimeAsync(250);
    await starting;
    await audio.dispose();
    resumed.resolve();
    await Promise.resolve();
    expect(audio.diagnostics().state).toBe('uninitialized');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending preview when stopped before activation settles', async () => {
    const audio = new RacingAudio(),
      ctx = new LiveContext(),
      resumed = deferred();
    await audio.start(asContext(ctx));
    ctx.state = 'suspended';
    ctx.resume.mockReturnValue(resumed.promise);
    const play = vi.spyOn(CueSynth.prototype, 'play');
    const preview = audio.previewDriving(validateDrivingAudio(null));
    audio.stop();
    ctx.state = 'running';
    resumed.resolve();
    await preview;
    expect(play).not.toHaveBeenCalled();
    await audio.dispose();
  });

  it('does not move an old pending preview onto a replacement audio graph', async () => {
    const audio = new RacingAudio(),
      old = new LiveContext(),
      next = new LiveContext(),
      resumed = deferred();
    await audio.start(asContext(old));
    old.state = 'suspended';
    old.resume.mockReturnValue(resumed.promise);
    const play = vi.spyOn(CueSynth.prototype, 'play');
    const preview = audio.previewDriving(validateDrivingAudio(null));
    await audio.dispose();
    await audio.start(asContext(next));
    resumed.resolve();
    await preview;
    expect(play).not.toHaveBeenCalled();
    await audio.dispose();
  });

  it('restarts preview throttling at the replacement context time origin', async () => {
    const audio = new RacingAudio(),
      old = new LiveContext(),
      next = new LiveContext();
    old.currentTime = 100;
    await audio.start(asContext(old));
    const play = vi.spyOn(CueSynth.prototype, 'play');
    await audio.previewDriving(validateDrivingAudio(null));
    expect(play).toHaveBeenCalledTimes(3);
    await audio.dispose();
    await audio.start(asContext(next));
    play.mockClear();
    await audio.previewDriving(validateDrivingAudio(null));
    expect(play).toHaveBeenCalledTimes(3);
    expect(play.mock.calls.map(([cue, time]) => [cue.frequency, cue.pan, time])).toEqual([
      [660, -0.85, 0],
      [800, 0, 0.25],
      [660, 0.85, 0.5],
    ]);
    await audio.dispose();
  });
});
