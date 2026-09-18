import { expect, it } from 'vitest';
import { Vector3 } from 'three';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { TracksideDirector } from '../src/rendering/trackside.ts';
const track = new Track();
it('covers a complete lap with fixed platforms and finite camera directions', () => {
  const director = new TracksideDirector(track),
    p = trackPoint();
  const position = new Vector3(),
    velocity = new Vector3();
  for (let s = 0; s < track.length; s += 2) {
    track.at(s, p);
    director.update(
      s,
      position.set(p.x, p.y + 0.5, p.z),
      velocity.set(p.tx * 80, 0, p.tz * 80),
      1 / 60,
    );
    expect(director.position.equals(director.rigs[director.activeId].position)).toBe(true);
    expect(director.gaze.distanceTo(director.position)).toBeGreaterThan(1);
    expect(director.fov).toBeGreaterThanOrEqual(24);
    expect(director.fov).toBeLessThanOrEqual(55);
  }
  expect(director.cuts).toBeLessThanOrEqual(director.rigs.length + 2);
});
it('pans without translating its rig and resists shot boundary jitter', () => {
  const d = new TracksideDirector(track),
    spacing = track.length / d.rigs.length;
  const target = new Vector3(20, 1, 30),
    velocity = new Vector3(0, 0, 50);
  d.update(0, target, velocity, 1 / 60);
  const first = d.position.clone();
  const gaze = d.gaze.clone();
  for (const s of [spacing / 2 + 2, spacing / 2 - 2, spacing / 2 + 1])
    d.update(s, target.addScaledVector(velocity, 0.05), velocity, 1 / 60);
  expect(d.activeId).toBe(0);
  expect(d.position.equals(first)).toBe(true);
  expect(d.gaze.equals(gaze)).toBe(false);
});
it('replay seeks and lap seam select correct coverage without a long stale pan', () => {
  const d = new TracksideDirector(track),
    target = new Vector3(3, 2, 1),
    velocity = new Vector3();
  d.update(0, target, velocity, 1 / 60);
  d.update(track.length * 0.5, target.set(300, 5, -400), velocity, 1 / 60);
  expect(d.activeId).toBe(10);
  expect(d.gaze.equals(target)).toBe(true);
  d.update(track.length - 1, target, velocity, 1 / 60);
  d.update(1, target, velocity, 1 / 60);
  expect(d.activeId).toBe(0);
  expect(() => d.update(NaN, target, velocity, 1 / 60)).toThrow();
});
