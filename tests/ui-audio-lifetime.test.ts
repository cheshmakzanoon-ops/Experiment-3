import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiSounds } from '../src/audio/ui-sounds.ts';
import { uiCue } from '../src/ui/ui-cue.ts';
import { FakeContext, type FakeNode } from './fake-audio.ts';

class MenuContext extends FakeContext {
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
}

function fixture(context = new MenuContext()) {
  const target = new EventTarget();
  const create = vi.fn(() => context as unknown as AudioContext);
  const settings = vi.fn(() => ({ volume: 0.5, muted: false }));
  const sounds = new UiSounds({ target, createContext: create, settings, activated: () => true });
  return { sounds, target, context, create, settings };
}

const sources = (context: MenuContext) => context.nodes.filter((node) => node.started.length);
const disconnected = (nodes: readonly FakeNode[]) => nodes.every((node) => !node.outputs.length);

afterEach(() => vi.restoreAllMocks());

describe('menu audio graph lifetime', () => {
  it('cannot start from a direct call or a stale event after disposal', () => {
    const f = fixture();
    f.sounds.dispose();
    expect(f.sounds.cue('select')).toBe(false);
    uiCue('confirm', f.target);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.settings).not.toHaveBeenCalled();
    expect(f.sounds.played).toBe(0);
  });

  it.each(['constructor', 'toString', '__proto__'])('ignores inherited cue key %s', (cue) => {
    const { sounds, create } = fixture();
    expect(() => expect(sounds.cue(cue)).toBe(false)).not.toThrow();
    expect(create).not.toHaveBeenCalled();
    sounds.dispose();
  });

  it('releases each completed voice but keeps the shared trim until its last voice ends', () => {
    const { sounds, context } = fixture();
    expect(sounds.cue('select')).toBe(true);
    const voices = sources(context);
    expect(voices).toHaveLength(2);
    const trim = context.of('gain')[2];
    const ownedPath = (source: FakeNode) => {
      const nodes: FakeNode[] = [];
      let node = source;
      while (node !== trim) {
        nodes.push(node);
        node = node.outputs[0];
      }
      return nodes;
    };
    const first = ownedPath(voices[0]),
      second = ownedPath(voices[1]);
    const firstEnded = voices[0].onended;
    firstEnded?.();
    expect(disconnected(first)).toBe(true);
    expect(trim.outputs).toHaveLength(1);
    expect(disconnected(second)).toBe(false);
    voices[1].onended?.();
    expect(disconnected(second)).toBe(true);
    expect(trim.outputs).toHaveLength(0);
    expect(disconnected(context.nodes.slice(0, 3))).toBe(false);
    const releases = vi.spyOn(trim, 'disconnect');
    firstEnded?.();
    expect(releases).not.toHaveBeenCalled();
    sounds.dispose();
  });

  it('keeps overlapping cue branches independent as each finishes', () => {
    const { sounds, context } = fixture();
    sounds.cue('tick');
    const first = sources(context);
    sounds.cue('confirm');
    const second = sources(context).filter((node) => !first.includes(node));
    first.forEach((node) => node.onended?.());
    expect(disconnected(first)).toBe(true);
    expect(second.every((node) => node.outputs.length > 0)).toBe(true);
    second.forEach((node) => node.onended?.());
    expect(disconnected(context.nodes.slice(3))).toBe(true);
    sounds.dispose();
  });

  it('disconnects completed cue graphs across a long sequence without closing the bus', () => {
    const { sounds, context } = fixture();
    for (let i = 0; i < 100; i++) {
      context.currentTime = i;
      const before = context.nodes.length;
      expect(sounds.cue('tick')).toBe(true);
      const cueNodes = context.nodes.slice(Math.max(3, before));
      cueNodes.filter((node) => node.started.length).forEach((node) => node.onended?.());
      expect(disconnected(cueNodes)).toBe(true);
    }
    expect(sounds.played).toBe(100);
    expect(context.close).not.toHaveBeenCalled();
    sounds.dispose();
  });

  it('stops live sources and disconnects the whole owned graph once on disposal', () => {
    const { sounds, context, create } = fixture();
    sounds.cue('open');
    sounds.cue('confirm');
    const voices = sources(context);
    const ended = voices.map((node) => node.onended);
    const releases = context.nodes.map((node) => vi.spyOn(node, 'disconnect'));
    sounds.dispose();
    expect(disconnected(context.nodes)).toBe(true);
    expect(voices.every((node) => node.stopped.at(-1) === undefined)).toBe(true);
    expect(voices.every((node) => node.onended === null)).toBe(true);
    expect(context.close).toHaveBeenCalledTimes(1);
    const counts = releases.map((spy) => spy.mock.calls.length);
    sounds.dispose();
    ended.forEach((callback) => callback?.());
    expect(releases.map((spy) => spy.mock.calls.length)).toEqual(counts);
    context.currentTime = 2;
    expect(sounds.cue('select')).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('finishes disposal when a source refuses to stop and a different node refuses to disconnect', () => {
    const { sounds, context } = fixture();
    sounds.cue('tick');
    const voices = sources(context);
    vi.spyOn(voices[0], 'stop').mockImplementation(() => {
      throw new Error('stop refused');
    });
    vi.spyOn(context.nodes[0], 'disconnect').mockImplementation(() => {
      throw new Error('disconnect refused');
    });
    expect(() => sounds.dispose()).not.toThrow();
    expect(disconnected(context.nodes.slice(1))).toBe(true);
    expect(voices[1].stopped.at(-1)).toBeUndefined();
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('contains a synchronous close failure and remains terminal', () => {
    const { sounds, context, create } = fixture();
    sounds.cue('tick');
    context.close.mockImplementation(() => {
      throw new Error('close refused');
    });
    expect(() => sounds.dispose()).not.toThrow();
    expect(disconnected(context.nodes)).toBe(true);
    context.currentTime = 2;
    expect(sounds.cue('select')).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('owns a rejected context-close promise rather than leaving it unhandled', async () => {
    const { sounds, context } = fixture();
    sounds.cue('tick');
    const closing = Promise.reject(new Error('device close failed'));
    const handled = vi.spyOn(closing, 'catch');
    context.close.mockReturnValue(closing);
    try {
      sounds.dispose();
      expect(handled).toHaveBeenCalledTimes(1);
    } finally {
      await closing.catch(() => undefined);
    }
  });

  it('contains synchronous activation refusal and retries on a later cue', () => {
    const { sounds, context } = fixture();
    context.state = 'suspended';
    context.resume.mockImplementationOnce(() => {
      throw new Error('gesture refused');
    });
    expect(() => expect(sounds.cue('select')).toBe(false)).not.toThrow();
    expect(sounds.cue('confirm')).toBe(false);
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(sources(context)).toHaveLength(0);
    sounds.dispose();
  });

  it('rolls back a partial bus and can build a fresh context on the next cue', () => {
    const failed = new MenuContext(),
      next = new MenuContext();
    vi.spyOn(failed, 'createWaveShaper').mockImplementation(() => {
      throw new Error('allocation failed');
    });
    const { sounds, create } = fixture(failed);
    create
      .mockReturnValueOnce(failed as unknown as AudioContext)
      .mockReturnValue(next as unknown as AudioContext);
    expect(sounds.cue('tick')).toBe(false);
    expect(disconnected(failed.nodes)).toBe(true);
    expect(failed.close).toHaveBeenCalledTimes(1);
    expect(sounds.cue('tick')).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(sources(next)).toHaveLength(2);
    sounds.dispose();
  });

  it('rolls back every branch of a cue when a later voice allocation fails', () => {
    const { sounds, context } = fixture();
    vi.spyOn(context, 'createOscillator').mockImplementationOnce(() => {
      throw new Error('voice allocation failed');
    });
    expect(() => expect(sounds.cue('tick')).toBe(false)).not.toThrow();
    expect(sounds.played).toBe(0);
    expect(disconnected(context.nodes.slice(3))).toBe(true);
    expect(sources(context).every((node) => node.stopped.at(-1) === undefined)).toBe(true);
    context.currentTime = 1;
    expect(sounds.cue('tick')).toBe(true);
    expect(sounds.played).toBe(1);
    expect(context.close).not.toHaveBeenCalled();
    sounds.dispose();
  });

  it('releases a voice whose start throws and keeps the normal bus available', () => {
    const { sounds, context } = fixture();
    const create = context.createOscillator.bind(context);
    vi.spyOn(context, 'createOscillator').mockImplementationOnce(() => {
      const node = create();
      vi.spyOn(node, 'start').mockImplementation(() => {
        throw new Error('start failed');
      });
      return node;
    });
    expect(() => expect(sounds.cue('select')).toBe(false)).not.toThrow();
    expect(disconnected(context.nodes.slice(3))).toBe(true);
    context.currentTime = 1;
    expect(sounds.cue('confirm')).toBe(true);
    sounds.dispose();
  });

  it('does not install a context returned after reentrant disposal', () => {
    const { sounds, context, create } = fixture();
    create.mockImplementation(() => {
      sounds.dispose();
      return context as unknown as AudioContext;
    });
    expect(sounds.cue('tick')).toBe(false);
    expect(context.nodes).toHaveLength(0);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(sounds.played).toBe(0);
  });

  it('replaces an externally closed context without using its noise or repeat clock', () => {
    const old = new MenuContext(),
      next = new MenuContext();
    const { sounds, create } = fixture(old);
    old.currentTime = 30;
    expect(sounds.cue('tick')).toBe(true);
    const oldBuffer = sources(old).find((node) => node.kind === 'source')!.buffer;
    old.state = 'closed';
    create.mockReturnValue(next as unknown as AudioContext);
    expect(sounds.cue('tick')).toBe(true);
    expect(old.resume).not.toHaveBeenCalled();
    expect(disconnected(old.nodes)).toBe(true);
    const nextBuffer = sources(next).find((node) => node.kind === 'source')!.buffer;
    expect(nextBuffer).not.toBe(oldBuffer);
    sounds.dispose();
  });
});
