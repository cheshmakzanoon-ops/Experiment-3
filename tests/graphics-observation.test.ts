import { afterEach, expect, it, vi } from 'vitest';
import {
  installGraphicsObservation,
  newGraphicsObservation,
} from '../src/core/graphics-observation.ts';
afterEach(() => vi.unstubAllGlobals());
it('keeps bounded document history and fails closed on corruption or overflow', () => {
  let state = newGraphicsObservation(null, '0', 'game');
  state.documents[0].losses = 1;
  state.documents[0].ended = true;
  state = newGraphicsObservation(JSON.stringify(state), '1', 'game2');
  expect(state.documents[0]).toMatchObject({ id: '0', losses: 1, ended: true });
  for (let i = 2; i <= 32; i++)
    state = newGraphicsObservation(JSON.stringify(state), String(i), 'game');
  expect(state.documents).toHaveLength(32);
  expect(state.observationErrors).toContain('Graphics document history overflow');
  expect(newGraphicsObservation('{', 'new', 'game').observationErrors).not.toEqual([]);
});
it('records losses before engine initialization and carries them through pagehide/navigation', () => {
  let stored: string | null = null;
  vi.stubGlobal('sessionStorage', {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  vi.stubGlobal('location', { href: 'motobound://game/babylon.html' });
  const first = new EventTarget() as EventTarget & {
    motoboundGraphicsObservation: NonNullable<Window['motoboundGraphicsObservation']>;
  };
  vi.stubGlobal('window', first);
  installGraphicsObservation();
  installGraphicsObservation();
  first.dispatchEvent(new Event('webglcontextlost'));
  first.dispatchEvent(new Event('pagehide'));
  const snapshot = first.motoboundGraphicsObservation();
  expect(snapshot.documents[0]).toMatchObject({ losses: 1, ended: true });
  snapshot.documents[0].losses = 0;
  expect(first.motoboundGraphicsObservation().documents[0].losses).toBe(1);
  const next = new EventTarget() as typeof first;
  vi.stubGlobal('window', next);
  installGraphicsObservation();
  expect(next.motoboundGraphicsObservation().documents).toHaveLength(2);
  expect(next.motoboundGraphicsObservation().documents[0].losses).toBe(1);
  expect(next.motoboundGraphicsObservation().observationErrors).toEqual([]);
});
it('fails closed if persistent browser storage is unavailable', () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('location', { href: 'game' });
  vi.stubGlobal('sessionStorage', {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  });
  installGraphicsObservation();
  expect(window.motoboundGraphicsObservation?.().observationErrors).toContain(
    'Graphics history storage unavailable',
  );
});
