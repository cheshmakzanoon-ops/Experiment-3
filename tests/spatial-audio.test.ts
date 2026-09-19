import { expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  AudioViewTracker,
  SpatialAudioScene,
  locateSource,
  spatialVoice,
} from '../src/audio/spatial.ts';
import { CAR_STRIDE, F, H, HEADER, carBase } from '../src/simulation/protocol.ts';
function frame(cars = 1) {
  const f = new Float32Array(HEADER + CAR_STRIDE * cars);
  f[H.CARS] = cars;
  for (let i = 0; i < cars; i++) {
    f[carBase(i) + F.QW] = 1;
    f[carBase(i) + F.RPM] = 8000;
  }
  return f;
}
it('uses actual camera-right, including the car +X-left convention and free look', () => {
  const camera = new PerspectiveCamera(),
    tracker = new AudioViewTracker(),
    f = frame();
  camera.lookAt(new Vector3(0, 0, 1));
  const view = tracker.update(camera, 0, 0, false);
  f[carBase(0)] = 10;
  expect(locateSource(f, 0, view, spatialVoice()).pan).toBe(-1);
  f[carBase(0)] = -10;
  expect(locateSource(f, 0, view, spatialVoice()).pan).toBe(1);
  camera.lookAt(new Vector3(0, 0, -1));
  tracker.update(camera, 0, 0, false);
  expect(locateSource(f, 0, view, spatialVoice()).pan).toBe(-1);
});
it('computes source and listener Doppler with the correct approach/recession signs', () => {
  const f = frame(),
    view = new AudioViewTracker().value,
    o = carBase(0);
  f[o + F.Z] = 100;
  f[o + F.VZ] = -60;
  expect(locateSource(f, 0, view, spatialVoice()).doppler).toBeCloseTo(343 / 283);
  f[o + F.VZ] = 60;
  expect(locateSource(f, 0, view, spatialVoice()).doppler).toBeCloseTo(343 / 403);
  view.vz = 60;
  expect(locateSource(f, 0, view, spatialVoice()).doppler).toBe(1);
  f[o + F.VZ] = 0;
  expect(locateSource(f, 0, view, spatialVoice()).doppler).toBeCloseTo(403 / 343);
});
it('keeps the seated engine centered without self-Doppler, but external views obey distance', () => {
  const f = frame(),
    view = new AudioViewTracker().value,
    o = carBase(0);
  f[o] = 20;
  f[o + F.VX] = 80;
  view.interior = true;
  const seated = locateSource(f, 0, view, spatialVoice());
  expect(seated.pan).toBe(0);
  expect(seated.doppler).toBe(1);
  expect(seated.gain).toBe(0.82);
  view.interior = false;
  expect(locateSource(f, 0, view, spatialVoice()).gain).toBeLessThan(seated.gain);
  f[o] = 300;
  expect(locateSource(f, 0, view, spatialVoice()).gain).toBe(0);
});
it('rejects non-finite sources and keeps coincident/sonic inputs bounded', () => {
  const f = frame(),
    view = new AudioViewTracker().value,
    o = carBase(0);
  expect(locateSource(f, 0, view, spatialVoice()).doppler).toBe(1);
  f[o] = 50;
  f[o + F.VX] = -343;
  expect(locateSource(f, 0, view, spatialVoice()).doppler).toBeLessThanOrEqual(2);
  f[o + F.VY] = NaN;
  expect(() => locateSource(f, 0, view, spatialVoice())).toThrow();
});
it('computes view velocity from recorded time and rejects cuts, pauses and rewinds', () => {
  const camera = new PerspectiveCamera(),
    tracker = new AudioViewTracker();
  tracker.update(camera, 0, 0, false);
  camera.position.z = 6;
  expect(tracker.update(camera, 0.1, 0, false).vz).toBeCloseTo(60);
  camera.position.z = 1000;
  expect(tracker.update(camera, 0.2, 1, false).vz).toBe(0);
  camera.position.z = 1002;
  expect(tracker.update(camera, 0.2, 1, false).vz).toBe(0);
  expect(tracker.update(camera, 0.1, 1, false).vz).toBe(0);
  tracker.reset();
  camera.position.z = 0;
  expect(tracker.update(camera, 0.2, 1, false).vz).toBe(0);
});
it('selects audible cars relative to a trackside camera rather than pinning the player voice', () => {
  const f = frame(6),
    view = new AudioViewTracker().value,
    scene = new SpatialAudioScene();
  f[carBase(0)] = 1000;
  for (let id = 1; id < 6; id++) f[carBase(id)] = id * 10;
  scene.update(f, view);
  expect(scene.voices.map((s) => s.id).sort()).toEqual([1, 2, 3, 4]);
  expect(scene.player.gain).toBe(0);
  view.interior = true;
  scene.update(f, view);
  expect(scene.voices.some((s) => s.id === 0)).toBe(true);
});
it('retains oscillator identity across distance swaps and rejects boundary chatter', () => {
  const f = frame(5),
    view = new AudioViewTracker().value,
    scene = new SpatialAudioScene();
  for (let id = 0; id < 5; id++) f[carBase(id)] = 10 + id;
  scene.update(f, view);
  const ids = scene.voices.map((s) => s.id);
  f[carBase(0)] = 11;
  f[carBase(1)] = 10;
  f[carBase(4)] = 12.9;
  scene.update(f, view);
  expect(scene.voices.map((s) => s.id)).toEqual(ids);
  f[carBase(4)] = 1;
  scene.update(f, view);
  expect(scene.voices.some((s) => s.id === 4)).toBe(true);
  expect(scene.voices[ids.indexOf(0)].id).toBe(0);
});
it('reuses all spatial output objects and releases invalid IDs when the grid shrinks', () => {
  const scene = new SpatialAudioScene(),
    view = new AudioViewTracker().value;
  scene.update(frame(6), view);
  const outputs = [...scene.voices];
  scene.update(frame(1), view);
  expect(scene.voices.filter((v) => v.id >= 0)).toHaveLength(1);
  scene.voices.forEach((v, i) => expect(v).toBe(outputs[i]));
  const f = frame(1);
  f[H.CARS] = NaN;
  expect(() => scene.update(f, view)).toThrow();
});
