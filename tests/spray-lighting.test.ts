import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { SprayClouds } from '../src/rendering/spray-clouds.ts';
import { Effects, EFFECT_CAPACITY } from '../src/rendering/effects.ts';
import { VenueLighting, VENUE_LIGHT_INTENSITY, venueLightWeight } from '../src/rendering/venue-lighting.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

function dispose(root: T.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof T.Mesh || object instanceof T.Points)) return;
    object.geometry.dispose();
    (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
  });
}

describe('lit spray and spatial floodlight continuity', () => {
  it('shares the existing contact pool, never rain or a second emitter', () => {
    const effects = new Effects();
    const points = effects.group.children[0] as T.Points;
    const spray = effects.group.getObjectByName('Lit wheel-water spray clouds') as T.Mesh<T.InstancedBufferGeometry, T.ShaderMaterial>;
    expect(spray.geometry.instanceCount).toBe(EFFECT_CAPACITY.contact);
    expect(spray.geometry.index!.count).toBe(6);
    for (const [target, source] of [['center', 'position'], ['size', 'size'], ['opacity', 'opacity'], ['kind', 'kind']]) {
      const a = spray.geometry.getAttribute(target).array, b = points.geometry.getAttribute(source).array;
      expect(a.buffer).toBe(b.buffer);
      expect(a.byteOffset).toBe(b.byteOffset);
      expect(a.length).toBe(EFFECT_CAPACITY.contact * (target === 'center' ? 3 : 1));
    }
    expect(spray.material.lights).toBe(true);
    expect(spray.material.depthWrite).toBe(false);
    const alpha = spray.geometry.getAttribute('opacity') as T.InstancedBufferAttribute;
    const before = alpha.version;
    effects.clear();
    expect(alpha.version).toBeGreaterThan(before);
    expect(Array.from(alpha.array).every((v) => v === 0)).toBe(true);
    expect(effects.diagnostics().capacity).toBe(1800);
    dispose(effects.group);
  });
  it('rejects inconsistent shared-array shapes', () => {
    expect(() => new SprayClouds(new Float32Array(3), new Float32Array(3),
      new Float32Array(2), new Float32Array(1), new Uint8Array(1))).toThrow();
    expect(() => new SprayClouds(new Float32Array(), new Float32Array(),
      new Float32Array(), new Float32Array(), new Uint8Array())).toThrow();
  });
  it('uses bounded continuous weights and exchanges tied lamps at zero energy', () => {
    expect(venueLightWeight(100, 100)).toBe(0);
    expect(venueLightWeight(101, 100)).toBe(0);
    expect(venueLightWeight(10, 100)).toBe(1);
    expect(venueLightWeight(NaN, 100)).toBe(0);
    let previous = 1;
    for (let i = 0; i <= 10000; i++) {
      const value = venueLightWeight(i / 100, 100);
      expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(previous);
      expect(Math.abs(value - previous)).toBeLessThan(0.001);
      previous = value;
    }
  });
  it('keeps four physical slots, deterministic seeks and a reversible daylight state', () => {
    const venue = new VenueLighting(new Track()), anchor = new T.Vector3(-355, 3, 200);
    const state = () => venue.lights.map((l) => ({ p: l.position.toArray(), intensity: l.intensity, visible: l.visible }));
    venue.update(true, anchor); const original = state();
    expect(venue.lights).toHaveLength(4);
    expect(venue.lights.every((l) => l.intensity >= 0 && l.intensity <= VENUE_LIGHT_INTENSITY && !l.castShadow)).toBe(true);
    venue.update(true, new T.Vector3(500, 5, 700)); venue.update(true, anchor);
    expect(state()).toEqual(original);
    venue.update(false, anchor);
    expect(venue.lights.every((l) => l.intensity === 0 && !l.visible)).toBe(true);
    venue.update(true, anchor); expect(state()).toEqual(original);
    dispose(venue.root);
  });
  it('leaves no dark gaps or discontinuous handoffs along the complete racing line', () => {
    const track = new Track(), venue = new VenueLighting(track), p = trackPoint(), anchor = new T.Vector3();
    let previous = 0;
    for (let i = 0; i <= 6000; i++) {
      track.at(i / 6000 * track.length, p); anchor.set(p.x, p.y + 1, p.z); venue.update(true, anchor);
      const irradiance = venue.lights.reduce((sum, l) => {
        const d = l.position.distanceTo(anchor), cutoff = Math.max(0, 1 - (d / l.distance) ** 4) ** 2;
        return sum + l.intensity * cutoff / Math.max(0.01, d ** l.decay);
      }, 0);
      expect(irradiance).toBeGreaterThan(0.8); expect(irradiance).toBeLessThan(4);
      if (i) expect(Math.abs(irradiance - previous)).toBeLessThan(0.05);
      previous = irradiance;
    }
    dispose(venue.root);
  });
});
