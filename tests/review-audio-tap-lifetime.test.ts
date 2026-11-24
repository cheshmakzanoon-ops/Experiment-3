import { describe, expect, it, vi } from 'vitest';
import { ReviewAudioTap } from '../src/audio/review-tap.ts';

function fixture() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  const destination = { stream: { getTracks: vi.fn(() => tracks) }, disconnect: vi.fn() };
  const ordinary = {};
  const connected = new Set<unknown>([ordinary]);
  const output = {
    connect: vi.fn((node: unknown) => {
      connected.add(node);
      return node;
    }),
    disconnect: vi.fn((node: unknown) => {
      connected.delete(node);
    }),
  };
  const context = { state: 'running', createMediaStreamDestination: vi.fn(() => destination) };
  const create = () =>
    new ReviewAudioTap(context as unknown as AudioContext, output as unknown as AudioNode);
  return { tracks, destination, ordinary, connected, output, context, create };
}

describe('review capture teardown ownership', () => {
  it('releases remaining tracks and its destination when one track refuses to stop', () => {
    const f = fixture(),
      tap = f.create(),
      failure = new Error('track refused');
    f.tracks[0].stop.mockImplementation(() => {
      throw failure;
    });
    expect(() => tap.release()).toThrow(failure);
    expect(f.tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(f.destination.disconnect).toHaveBeenCalledTimes(1);
    expect(f.connected).toEqual(new Set([f.ordinary]));
    expect(() => tap.release()).not.toThrow();
    expect(f.output.disconnect).toHaveBeenCalledExactlyOnceWith(f.destination);
  });

  it('preserves the first disconnect failure while completing later cleanup', () => {
    const f = fixture(),
      tap = f.create(),
      first = new Error('output refused');
    f.output.disconnect.mockImplementation(() => {
      throw first;
    });
    f.tracks[0].stop.mockImplementation(() => {
      throw new Error('track refused');
    });
    f.destination.disconnect.mockImplementation(() => {
      throw new Error('destination refused');
    });
    expect(() => tap.release()).toThrow(first);
    expect(f.tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(f.destination.disconnect).toHaveBeenCalledTimes(1);
    expect(f.output.disconnect).toHaveBeenCalledExactlyOnceWith(f.destination);
    expect(f.connected.has(f.ordinary)).toBe(true);
  });

  it('preserves an undefined first failure after attempting every cleanup', () => {
    const f = fixture(),
      tap = f.create();
    f.output.disconnect.mockImplementation(() => {
      throw undefined;
    });
    f.tracks[0].stop.mockImplementation(() => {
      throw new Error('later');
    });
    let caught = false,
      error: unknown = 'none';
    try {
      tap.release();
    } catch (failure) {
      caught = true;
      error = failure;
    }
    expect(caught).toBe(true);
    expect(error).toBeUndefined();
    expect(f.tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(f.destination.disconnect).toHaveBeenCalledTimes(1);
  });

  it('cleans a failed connection without masking its original error', () => {
    const f = fixture(),
      failure = new Error('connection refused');
    f.output.connect.mockImplementation((node) => {
      f.connected.add(node);
      throw failure;
    });
    f.tracks[0].stop.mockImplementation(() => {
      throw new Error('cleanup refused');
    });
    expect(f.create).toThrow(failure);
    expect(f.tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(f.destination.disconnect).toHaveBeenCalledTimes(1);
    expect(f.output.disconnect).toHaveBeenCalledExactlyOnceWith(f.destination);
    expect(f.connected).toEqual(new Set([f.ordinary]));
  });

  it('disconnects its destination even when obtaining the track list fails', () => {
    const f = fixture(),
      tap = f.create();
    f.destination.stream.getTracks.mockImplementation(() => {
      throw new Error('tracks unavailable');
    });
    expect(() => tap.release()).toThrow('tracks unavailable');
    expect(f.destination.disconnect).toHaveBeenCalledTimes(1);
    expect(f.connected).toEqual(new Set([f.ordinary]));
  });

  it('keeps reentrant release inert and never disconnects ordinary playback', () => {
    const f = fixture(),
      tap = f.create();
    f.tracks[0].stop.mockImplementation(() => tap.release());
    tap.release();
    tap.release();
    expect(f.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(f.destination.disconnect).toHaveBeenCalledTimes(1);
    expect(f.output.disconnect).toHaveBeenCalledExactlyOnceWith(f.destination);
    expect(f.connected).toEqual(new Set([f.ordinary]));
  });
});
