import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { venueField, venueFieldReady } from '../src/rendering/venue-kit/plan.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { Track } from '../src/simulation/track.ts';

const boundary = {
  reached: vi.fn(),
  error: new Error('Reached WebGL construction boundary'),
};

const track = () => new Track('clear', false, undefined, circuitDefinition('valley-ridge-mx'));
// Run the actual asynchronous factory and constructor, stopping exactly at
// its native context request. Scene work after this boundary remains covered
// by the existing rendering tests and is not replaced by this order test.
const canvas = {
  getContext() {
    boundary.reached();
    throw boundary.error;
  },
} as unknown as HTMLCanvasElement;

beforeEach(() => {
  boundary.reached.mockReset();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(performance.now());
    return 1;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('production renderer catalogue preconstruction', () => {
  it('finishes the cold field before creating the renderer and reports real yielded work', async () => {
    const course = track(),
      progress = vi.fn();
    let yields = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      expect(boundary.reached).not.toHaveBeenCalled();
      yields++;
      callback(performance.now());
      return yields;
    });
    boundary.reached.mockImplementation(() => {
      expect(venueFieldReady(course)).toBe(true);
      expect(venueField(course).ready).toBe(true);
    });
    await expect(RacingRenderer.create(canvas, course, progress, () => false)).rejects.toBe(
      boundary.error,
    );
    expect(boundary.reached).toHaveBeenCalledOnce();
    expect(yields).toBeGreaterThan(0);
    const ground = progress.mock.calls.map(([value]) => value).filter((p) => p.total > 1);
    expect(ground[0]).toMatchObject({ completed: 0, fraction: 0, label: 'Preparing venue ground' });
    expect(ground.at(-1)).toMatchObject({ fraction: 1 });
  });

  it('cancels partway through the field before allocating a graphics context', async () => {
    const course = track();
    let cancelled = false,
      yields = 0,
      time = 0;
    // Deterministic scheduling boundary, independent of the host's CPU speed.
    vi.spyOn(performance, 'now').mockImplementation(() => (time += 2));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      if (++yields === 2) cancelled = true;
      callback(performance.now());
      return yields;
    });
    expect(await RacingRenderer.create(canvas, course, vi.fn(), () => cancelled)).toBeNull();
    expect(yields).toBe(2);
    expect(boundary.reached).not.toHaveBeenCalled();
    expect(venueFieldReady(course)).toBe(false);
  });

  it('does no field work for the showroom even when a catalogue venue is selected', async () => {
    const course = track(),
      progress = vi.fn(),
      raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    await expect(
      RacingRenderer.create(canvas, course, progress, () => false, undefined, true),
    ).rejects.toBe(boundary.error);
    expect(boundary.reached).toHaveBeenCalledOnce();
    expect(venueFieldReady(course)).toBe(false);
    expect(raf).not.toHaveBeenCalled();
    expect(progress.mock.calls.every(([value]) => value.total === 1)).toBe(true);
  });

  it('reuses a completed field without adding a frame or changing the cached owner', async () => {
    const course = track(),
      field = venueField(course),
      raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    await expect(RacingRenderer.create(canvas, course, vi.fn(), () => false)).rejects.toBe(
      boundary.error,
    );
    expect(boundary.reached).toHaveBeenCalledOnce();
    expect(raf).not.toHaveBeenCalled();
    expect(venueField(course)).toBe(field);
  });

  it('honours cancellation before any field or graphics construction', async () => {
    const course = track(),
      raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    expect(await RacingRenderer.create(canvas, course, vi.fn(), () => true)).toBeNull();
    expect(boundary.reached).not.toHaveBeenCalled();
    expect(venueFieldReady(course)).toBe(false);
    expect(raf).not.toHaveBeenCalled();
  });
});
