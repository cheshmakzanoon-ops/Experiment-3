import { it, expect } from 'vitest';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
it('renders active driving and only invalidated paused views', () => {
  const schedule = new PresentationSchedule();
  expect(schedule.shouldRender(true)).toBe(true);
  for (let i = 0; i < 100; i++) expect(schedule.shouldRender(true)).toBe(false);
  schedule.request();
  expect(schedule.shouldRender(true)).toBe(true);
  expect(schedule.shouldRender(true)).toBe(false);
  for (let i = 0; i < 100; i++) expect(schedule.shouldRender(false)).toBe(true);
  schedule.request(); // Enter pause with one final current pose.
  expect(schedule.shouldRender(true)).toBe(true);
  expect(schedule.shouldRender(true)).toBe(false);
});
it('keeps material preparation rendering and prevents stale completion from cancelling a new scene', () => {
  const schedule = new PresentationSchedule();
  const finishOld = schedule.prepare();
  for (let i = 0; i < 5; i++) expect(schedule.shouldRender(true)).toBe(true);
  schedule.reset();
  const finishNew = schedule.prepare();
  finishOld();
  finishOld();
  for (let i = 0; i < 5; i++) expect(schedule.shouldRender(true)).toBe(true);
  finishNew();
  finishNew();
  expect(schedule.shouldRender(true)).toBe(false);
  const finishA = schedule.prepare(),
    finishB = schedule.prepare();
  finishA();
  expect(schedule.shouldRender(true)).toBe(true);
  finishB();
  expect(schedule.shouldRender(true)).toBe(false);
});

it('continues paused draws while initial or restored resources remain unready', () => {
  const schedule = new PresentationSchedule();
  for (let i = 0; i < 5; i++) {
    expect(schedule.shouldRender(true)).toBe(true);
    schedule.rendered(false, false);
  }
  expect(schedule.shouldRender(true)).toBe(true);
  schedule.rendered(true, true);
  expect(schedule.shouldRender(true)).toBe(false);
  schedule.request();
  expect(schedule.shouldRender(true)).toBe(true);
  schedule.rendered(false, true); // Compilation finished after a mesh was skipped.
  expect(schedule.shouldRender(true)).toBe(true);
  schedule.rendered(true, true);
  expect(schedule.shouldRender(true)).toBe(false);
  schedule.request(); // Context restoration invalidates the retained surface.
  expect(schedule.shouldRender(true)).toBe(true);
  schedule.rendered(false, false);
  expect(schedule.shouldRender(true)).toBe(true);
  schedule.rendered(true, true);
  expect(schedule.shouldRender(true)).toBe(false);
});

it('reports pending demand without consuming invalidations or active preparations', () => {
  const schedule = new PresentationSchedule();
  expect(schedule.pending).toBe(true);
  expect(schedule.pending).toBe(true);
  expect(schedule.shouldRender(true)).toBe(true);
  expect(schedule.pending).toBe(false);
  const finish = schedule.prepare();
  expect(schedule.pending).toBe(true);
  finish();
  expect(schedule.pending).toBe(false);
  schedule.request();
  expect(schedule.pending).toBe(true);
});
