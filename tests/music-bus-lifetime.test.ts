import { afterEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_CUES, MusicBus, type MusicLoader } from '../src/audio/music.ts';
import { DEFAULT_LEVELS } from '../src/audio/mixer.ts';
import { FakeContext, asContext, asNode } from './fake-audio.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: (buffer: AudioBuffer) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<AudioBuffer>((ready, failed) => {
    resolve = ready;
    reject = failed;
  });
  return { promise, resolve, reject };
}

const buffer = (id: string) => ({ id }) as unknown as AudioBuffer;
const cues = {
  ...MUSIC_CUES,
  menu: { ...MUSIC_CUES.menu, src: 'menu.ogg', loop: [1.5, 61.5] as const },
  results: { ...MUSIC_CUES.results, src: 'results.ogg' },
  'race-ambient': { ...MUSIC_CUES['race-ambient'], src: 'race.ogg' },
  'wildcard-sting': { ...MUSIC_CUES['wildcard-sting'], src: 'sting.ogg' },
};

function fixture(load: MusicLoader = async (src) => buffer(src)) {
  const context = new FakeContext();
  const bus = new MusicBus(asContext(context), asNode(context.destination), load, cues);
  bus.enabled = true;
  return { context, bus };
}

describe('music request ownership', () => {
  it('keeps the newest requested cue when an older load resolves last', async () => {
    const menu = deferred(),
      results = deferred();
    const { bus, context } = fixture((src) =>
      src === 'menu.ogg' ? menu.promise : results.promise,
    );
    const first = bus.play('menu'),
      second = bus.play('results');
    results.resolve(buffer('results'));
    expect(await second).toBe(true);
    const current = context.of('source')[0];
    menu.resolve(buffer('menu'));
    expect(await first).toBe(false);
    expect(bus.playing).toBe('results');
    expect(context.of('source')).toEqual([current]);
    expect(current.stopped).toEqual([]);
    bus.dispose();
  });

  it('does not install a superseded cue while the newest one is still loading', async () => {
    const menu = deferred(),
      results = deferred();
    const { bus, context } = fixture((src) =>
      src === 'menu.ogg' ? menu.promise : results.promise,
    );
    const first = bus.play('menu'),
      second = bus.play('results');
    menu.resolve(buffer('menu'));
    expect(await first).toBe(false);
    expect(context.of('source')).toEqual([]);
    expect(bus.playing).toBeNull();
    results.resolve(buffer('results'));
    expect(await second).toBe(true);
    expect(bus.playing).toBe('results');
    bus.dispose();
  });

  it('shares a pending decode without creating duplicate voices for the same cue', async () => {
    const pending = deferred(),
      load = vi.fn(() => pending.promise);
    const { bus, context } = fixture(load);
    const first = bus.play('menu'),
      second = bus.play('menu');
    pending.resolve(buffer('menu'));
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(context.of('source')).toHaveLength(1);
    expect(context.of('source')[0].stopped).toEqual([]);
    bus.dispose();
  });

  it('cancels a pending replacement when the current cue is requested again', async () => {
    const pending = deferred();
    const { bus, context } = fixture((src) =>
      src === 'menu.ogg' ? Promise.resolve(buffer(src)) : pending.promise,
    );
    expect(await bus.play('menu')).toBe(true);
    const replacement = bus.play('results');
    expect(await bus.play('menu')).toBe(true);
    pending.resolve(buffer('results'));
    expect(await replacement).toBe(false);
    expect(bus.playing).toBe('menu');
    expect(context.of('source')).toHaveLength(1);
    expect(context.of('source')[0].stopped).toEqual([]);
    bus.dispose();
  });

  it('stopping cancels a pending load but retains its decoded buffer for an explicit restart', async () => {
    const pending = deferred(),
      load = vi.fn(() => pending.promise);
    const { bus, context } = fixture(load);
    const play = bus.play('menu');
    bus.stop();
    pending.resolve(buffer('menu'));
    expect(await play).toBe(false);
    expect(context.of('source')).toEqual([]);
    expect(bus.playing).toBeNull();
    expect(await bus.play('menu')).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    bus.dispose();
  });

  it('does not revive a pending request after the switch is turned off and on', async () => {
    const pending = deferred();
    const { bus, context } = fixture(() => pending.promise);
    const play = bus.play('menu');
    bus.enabled = false;
    bus.enabled = true;
    pending.resolve(buffer('menu'));
    expect(await play).toBe(false);
    expect(context.of('source')).toEqual([]);
    expect(await bus.play('menu')).toBe(true);
    bus.dispose();
  });

  it('cannot be reopened by enabling or playing after disposal', async () => {
    const pending = deferred(),
      load = vi.fn(() => pending.promise);
    const { bus, context } = fixture(load);
    const play = bus.play('menu');
    bus.dispose();
    bus.enabled = true;
    pending.resolve(buffer('menu'));
    expect(await play).toBe(false);
    expect(await bus.play('results')).toBe(false);
    expect(bus.enabled).toBe(false);
    expect(bus.playing).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    expect(context.of('source')).toEqual([]);
  });

  it('allows a failed load to retry without disturbing the playing cue', async () => {
    const failure = new Error('decode failed');
    const load = vi
      .fn<MusicLoader>()
      .mockResolvedValueOnce(buffer('menu'))
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(buffer('results'));
    const { bus, context } = fixture(load);
    expect(await bus.play('menu')).toBe(true);
    const original = context.of('source')[0];
    expect(await bus.play('results')).toBe(false);
    expect(bus.playing).toBe('menu');
    expect(original.stopped).toEqual([]);
    expect(await bus.play('results')).toBe(true);
    expect(load.mock.calls.map(([src]) => src)).toEqual(['menu.ogg', 'results.ogg', 'results.ogg']);
    bus.dispose();
  });

  it('preserves mute-switch behavior for an already playing voice', async () => {
    const { bus, context } = fixture();
    await bus.play('menu');
    const source = context.of('source')[0];
    bus.enabled = false;
    bus.update(DEFAULT_LEVELS, 0, 4);
    expect(context.of('gain')[0].gain.events.at(-1)).toMatchObject({
      kind: 'target',
      value: 0,
      time: 4,
    });
    expect(source.stopped).toEqual([]);
    bus.enabled = true;
    expect(await bus.play('menu')).toBe(true);
    expect(context.of('source')).toEqual([source]);
    bus.dispose();
  });
});

describe('music voice resource ownership', () => {
  it('releases both source and gain after natural completion', async () => {
    const { bus, context } = fixture();
    await bus.play('wildcard-sting');
    const source = context.of('source')[0],
      gain = context.of('gain').at(-1)!;
    source.onended!();
    expect(bus.playing).toBeNull();
    expect(source.outputs).toEqual([]);
    expect(gain.outputs).toEqual([]);
    expect(source.onended).toBeNull();
    bus.dispose();
  });

  it('forgets the current stinger even while an older voice is still fading', async () => {
    const { bus, context } = fixture();
    await bus.play('menu');
    await bus.play('wildcard-sting');
    const menu = context.of('source')[0],
      sting = context.of('source')[1];
    sting.onended!();
    expect(bus.playing).toBeNull();
    expect(await bus.play('wildcard-sting')).toBe(true);
    expect(context.of('source')).toHaveLength(3);
    menu.onended!();
    expect(bus.playing).toBe('wildcard-sting');
    bus.dispose();
  });

  it('ignores captured ended callbacks after disposal and releases each node once', async () => {
    const { bus, context } = fixture();
    await bus.play('menu');
    const source = context.of('source')[0],
      ended = source.onended!;
    const disconnects = context.nodes.map((node) => vi.spyOn(node, 'disconnect'));
    bus.dispose();
    bus.dispose();
    ended();
    expect(source.stopped).toEqual([undefined]);
    expect(source.onended).toBeNull();
    for (const disconnect of disconnects) expect(disconnect).toHaveBeenCalledTimes(1);
    expect(bus.playing).toBeNull();
  });

  it('releases remaining voices and output nodes even if an earlier disconnect fails', async () => {
    const { bus, context } = fixture();
    await bus.play('menu');
    await bus.play('results');
    const sources = context.of('source'),
      gains = context.of('gain');
    const failure = new Error('disconnect failed');
    vi.spyOn(sources[0], 'disconnect').mockImplementation(() => {
      throw failure;
    });
    expect(() => bus.dispose()).toThrow(failure);
    expect(bus.playing).toBeNull();
    expect(bus.enabled).toBe(false);
    expect(sources[1].outputs).toEqual([]);
    for (const gain of gains) expect(gain.outputs).toEqual([]);
    expect(sources.every((source) => source.onended === null)).toBe(true);
    expect(() => bus.dispose()).not.toThrow();
    expect(await bus.play('menu')).toBe(false);
  });

  it('contains an ended-node cleanup failure and still releases its gain', async () => {
    const { bus, context } = fixture();
    await bus.play('wildcard-sting');
    const source = context.of('source')[0],
      gain = context.of('gain').at(-1)!;
    vi.spyOn(source, 'disconnect').mockImplementation(() => {
      throw new Error('closed graph');
    });
    expect(() => source.onended!()).not.toThrow();
    expect(gain.outputs).toEqual([]);
    expect(source.onended).toBeNull();
    expect(bus.playing).toBeNull();
    bus.dispose();
  });

  for (const failAt of ['gain', 'connect', 'automation', 'start'] as const) {
    it(`cleans a partially built voice after ${failAt} fails and allows retry`, async () => {
      const { bus, context } = fixture();
      await bus.play('menu');
      const previous = context.of('source')[0];
      const failure = new Error(`${failAt} failed`);
      const originalSource = context.createBufferSource.bind(context);
      vi.spyOn(context, 'createBufferSource').mockImplementationOnce(() => {
        const source = originalSource();
        if (failAt === 'connect')
          vi.spyOn(source, 'connect').mockImplementation(() => {
            throw failure;
          });
        if (failAt === 'start')
          vi.spyOn(source, 'start').mockImplementation(() => {
            throw failure;
          });
        return source;
      });
      const originalGain = context.createGain.bind(context);
      vi.spyOn(context, 'createGain').mockImplementationOnce(() => {
        if (failAt === 'gain') throw failure;
        const gain = originalGain();
        if (failAt === 'automation')
          vi.spyOn(gain.gain, 'setValueAtTime').mockImplementation(() => {
            throw failure;
          });
        return gain;
      });
      expect(await bus.play('results')).toBe(false);
      expect(bus.playing).toBe('menu');
      expect(previous.stopped).toEqual([]);
      const failed = context.of('source')[1];
      expect(failed.outputs).toEqual([]);
      expect(failed.onended).toBeNull();
      if (failAt !== 'gain') expect(context.of('gain').at(-1)!.outputs).toEqual([]);
      expect(await bus.play('results')).toBe(true);
      expect(bus.playing).toBe('results');
      bus.dispose();
    });
  }

  it('stops every voice even if one fade cannot be scheduled', async () => {
    const { bus, context } = fixture();
    await bus.play('menu');
    await bus.play('results');
    const [menu, results] = context.of('source');
    const menuGain = context.of('gain')[2];
    vi.spyOn(menuGain.gain, 'cancelScheduledValues').mockImplementation(() => {
      throw new Error('closed parameter');
    });
    context.currentTime = 10;
    expect(() => bus.stop(2)).not.toThrow();
    expect(bus.playing).toBeNull();
    expect(menu.outputs).toEqual([]);
    expect(results.stopped.at(-1)).toBe(12.05);
    bus.dispose();
  });

  it('does not touch the output graph after disposal', () => {
    const { bus, context } = fixture();
    bus.dispose();
    const output = context.of('gain')[0];
    const before = [...output.gain.events];
    bus.update(DEFAULT_LEVELS, 0, 10);
    bus.stop();
    expect(output.gain.events).toEqual(before);
  });
});
