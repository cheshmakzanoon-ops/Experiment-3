import * as T from 'three';
import { SprayClouds } from '../../src/rendering/spray-clouds.ts';
import { VenueLighting } from '../../src/rendering/venue-lighting.ts';
import { Track, trackPoint } from '../../src/simulation/track.ts';
import { disposePhase27Scene } from './phase27c-resources.ts';

/** Small GPU contract fixture; full-race presentation is reviewed separately. */
export function captureWetLightingClosure() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const renderer = new T.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(320, 240); renderer.setPixelRatio(1);
  renderer.toneMapping = T.ACESFilmicToneMapping;
  const scene = new T.Scene(); scene.background = new T.Color(0x000000);
  const camera = new T.PerspectiveCamera(45, 4 / 3, 0.1, 200);
  camera.position.set(0, 1, 6); camera.lookAt(0, 1, 0);
  const positions = new Float32Array([0, 1, 0]), velocities = new Float32Array([4, 0, 0]);
  const sizes = new Float32Array([1]), opacity = new Float32Array([0.8]), kinds = new Uint8Array([0]);
  const spray = new SprayClouds(positions, velocities, sizes, opacity, kinds);
  const sun = new T.DirectionalLight(0xffffff, 4.2); sun.position.set(2, 6, 4);
  const fill = new T.HemisphereLight(0xffffff, 0x556677, 0.4);
  const lamp = new T.PointLight(0xd9e8ff, 0, 135, 2); lamp.position.set(0, 6, 0);
  scene.add(spray.mesh, sun, fill, lamp);
  const captures: { view: string; image: string; energy: number; pixels: number; width: number; height: number; draws: number }[] = [];
  const bytes = new Uint8Array(320 * 240 * 4);
  function capture(view: string) {
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 320, 240, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let energy = 0, pixels = 0, left = 320, right = -1, bottom = 240, top = -1;
    for (let i = 0; i < bytes.length; i += 4) {
      const value = bytes[i] + bytes[i + 1] + bytes[i + 2]; energy += value;
      if (value > 12) { const x = (i / 4) % 320, y = Math.floor(i / 4 / 320);
        pixels++; left = Math.min(left, x); right = Math.max(right, x);
        bottom = Math.min(bottom, y); top = Math.max(top, y); }
    }
    const result = { view, image: canvas.toDataURL('image/png'), energy, pixels,
      width: Math.max(0, right - left + 1), height: Math.max(0, top - bottom + 1),
      draws: renderer.info.render.calls };
    captures.push(result); return result;
  }
  capture('day-horizontal-wake');
  velocities.set([0, 4, 0]); spray.upload(); capture('day-vertical-wake');
  const held = capture('held'); const repeated = capture('held-repeat');
  velocities.set([0, 0, 0]); spray.upload(); capture('axial-zero');
  const axialPixels = bytes.slice(); let axialMaxDifference = 0;
  for (const [view, vx, vy] of [
    ['axial-positive', 0.002, 0], ['axial-negative', -0.002, 0],
    ['axial-diagonal-ne', 0.002, 0.002], ['axial-diagonal-sw', -0.002, -0.002],
    ['axial-diagonal-nw', -0.002, 0.002], ['axial-diagonal-se', 0.002, -0.002],
  ] as const) {
    velocities.set([vx, vy, 0]); spray.upload(); capture(view);
    for (let i = 0; i < bytes.length; i++)
      axialMaxDifference = Math.max(axialMaxDifference, Math.abs(bytes[i] - axialPixels[i]));
  }
  velocities.set([0, 4, 0]); spray.upload();
  scene.fog = new T.Fog(0x000000, 0, 2); capture('fogged'); scene.fog = null;
  const blocker = new T.Mesh(new T.PlaneGeometry(5, 5), new T.MeshBasicMaterial({ color: 0x000000 }));
  blocker.position.set(0, 1, 1); scene.add(blocker); capture('occluded');
  scene.remove(blocker); blocker.geometry.dispose(); blocker.material.dispose();
  sun.intensity = 0; fill.intensity = 0; lamp.intensity = 0; capture('unlit');
  lamp.intensity = 1800; capture('under-floodlight');
  kinds[0] = 1; spray.upload(); capture('non-spray-excluded');
  kinds[0] = 0; positions.set([0, 1, 5.95]); spray.upload(); capture('near-plane');
  positions.set([0, 1, 0]); velocities.set([0, 4, 0]);
  sun.intensity = 4.2; fill.intensity = 0.4; lamp.intensity = 0;
  spray.upload(); const restored = capture('restored');
  const before = { ...renderer.info.memory };
  for (let i = 0; i < 12; i++) { spray.upload(); renderer.render(scene, camera); }
  const after = { ...renderer.info.memory };
  opacity.fill(0); spray.clear(); capture('cleared');
  const glError = renderer.getContext().getError();
  disposePhase27Scene(scene); renderer.dispose(); canvas.remove();
  return { captures, glError, before, after, axialMaxDifference,
    pauseExact: held.image === repeated.image, restoreExact: held.image === restored.image };
}

export function surveyVenueLightCoverage() {
  const track = new Track(), venue = new VenueLighting(track), p = trackPoint();
  const anchor = new T.Vector3(); let min = Infinity, max = 0, maxStep = 0, previous = 0;
  for (let i = 0; i <= 6000; i++) {
    track.at(i / 6000 * track.length, p); anchor.set(p.x, p.y + 1, p.z);
    venue.update(true, anchor);
    let irradiance = 0;
    for (const light of venue.lights) {
      const distance = light.position.distanceTo(anchor);
      const cutoff = Math.max(0, 1 - (distance / light.distance) ** 4) ** 2;
      irradiance += light.intensity * cutoff / Math.max(0.01, distance ** light.decay);
    }
    min = Math.min(min, irradiance); max = Math.max(max, irradiance);
    if (i) maxStep = Math.max(maxStep, Math.abs(irradiance - previous));
    previous = irradiance;
  }
  disposePhase27Scene(venue.root);
  return { samples: 6001, min, max, maxStep };
}
