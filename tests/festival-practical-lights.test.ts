import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  FestivalPracticalLights,
  type FestivalPracticalSocket,
} from '../src/rendering/open-world/festival-practical-lights.ts';
import { HorizonDressing } from '../src/rendering/open-world/horizon-dressing.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { regionStructures } from '../src/simulation/open-world/placement.ts';
import { carvedGroundHeight } from '../src/simulation/open-world/ground-height.ts';
import { trackPoint } from '../src/simulation/track.ts';
import type { QualityPreset } from '../src/rendering/options.ts';

function socket(x: number, group: number, kind: FestivalPracticalSocket['kind'] = 'storefront') {
  return {
    position: new T.Vector3(x, kind === 'festoon' ? 8 : 3, 0),
    target: new T.Vector3(x, 0.08, kind === 'festoon' ? 0 : 4.8),
    color: group % 2 ? 0xffddb0 : 0xb4dbe3,
    kind,
    group,
  } satisfies FestivalPracticalSocket;
}
function lights(pools: FestivalPracticalLights) {
  return pools.root.children.filter((node): node is T.SpotLight => node instanceof T.SpotLight);
}
function settle(
  pools: FestivalPracticalLights,
  camera: T.Camera,
  quality: QualityPreset = 'medium',
  night = 1,
) {
  for (let i = 0; i < 70; i++) pools.update(camera, night, quality, 1 / 60);
}

describe('Festival physical storefront and festoon lighting', () => {
  it('reuses four light resources and exact emitter transforms across every quality preset', () => {
    const sources = Array.from({ length: 16 }, (_, i) =>
      socket(i * 6, i, i % 4 ? 'storefront' : 'festoon'),
    );
    const pools = new FestivalPracticalLights(sources),
      camera = new T.PerspectiveCamera();
    camera.position.set(30, 2, 7);
    const resources = lights(pools);
    expect(resources).toHaveLength(4);
    for (const [quality, count] of [
      ['medium', 2],
      ['high', 3],
      ['ultra', 4],
      ['low', 0],
      ['medium', 2],
    ] as const) {
      settle(pools, camera, quality);
      expect(lights(pools)).toEqual(resources);
      expect(resources.filter((light) => light.visible)).toHaveLength(count);
      expect(pools.state.visible).toBe(count);
      expect(pools.state.active).toBe(count);
      const groups = new Set<number>();
      for (const light of resources) {
        expect(light.castShadow).toBe(false);
        expect(light.shadow.map).toBeNull();
        expect(light.intensity).toBeGreaterThanOrEqual(0);
        expect(light.intensity).toBeLessThanOrEqual(200);
        if (!light.visible || light.intensity === 0) continue;
        const source = sources.find((s) => s.position.equals(light.position))!;
        expect(source).toBeDefined();
        expect(light.target.position.equals(source.target)).toBe(true);
        expect(light.color.getHex()).toBe(source.color);
        expect(light.distance).toBeLessThanOrEqual(17);
        groups.add(source.group);
      }
      expect(groups.size).toBe(count);
    }
    pools.dispose();
  });

  it('gives a frontage only one slot and fades completely before a slot moves or changes hue', () => {
    const sources = Array.from({ length: 24 }, (_, i) => socket(i * 3, Math.floor(i / 3)));
    const pools = new FestivalPracticalLights(sources),
      camera = new T.PerspectiveCamera();
    camera.position.set(5, 2, 5);
    settle(pools, camera, 'ultra');
    const resources = lights(pools);
    let moved = 0;
    for (let frame = 0; frame < 240; frame++) {
      // Reversals while previous slots are still fading exercise group reuse.
      camera.position.x = frame < 70 ? 60 : frame < 140 ? 21 : 68;
      const prior = resources.map((light) => ({
        position: light.position.clone(),
        color: light.color.getHex(),
      }));
      pools.update(camera, 1, frame < 115 ? 'ultra' : 'medium', 1 / 60);
      const groups = new Set<number>();
      for (let i = 0; i < resources.length; i++) {
        const light = resources[i];
        if (!light.position.equals(prior[i].position) || light.color.getHex() !== prior[i].color) {
          expect(light.intensity).toBe(0);
          moved++;
        }
        if (!light.visible || light.intensity === 0) continue;
        const group = sources.find((source) => source.position.equals(light.position))!.group;
        expect(groups.has(group)).toBe(false);
        groups.add(group);
      }
    }
    expect(moved).toBeGreaterThan(4);
    expect(
      resources
        .filter((light) => light.visible && light.intensity > 0)
        .every((light) => light.position.x > 40),
    ).toBe(true);
    pools.dispose();
  });

  it('keeps cones outside source facades and disables them behind walls, far away, by day and after reset', () => {
    const sources = [socket(0, 0), socket(6, 1)],
      pools = new FestivalPracticalLights(sources),
      camera = new T.PerspectiveCamera();
    camera.position.set(3, 2, 5);
    settle(pools, camera);
    for (const light of lights(pools).filter((l) => l.intensity > 0)) {
      const direction = light.target.position.clone().sub(light.position).normalize();
      // This cone/plane bound covers every emitted ray, not just its axis.
      expect(direction.z).toBeGreaterThan(Math.sin(light.angle));
    }
    camera.position.z = -5;
    settle(pools, camera);
    expect(pools.state.active).toBe(0);
    camera.position.set(1000, 2, 1000);
    settle(pools, camera, 'high');
    expect(pools.state.active).toBe(0);
    expect(pools.state.visible).toBe(3);
    camera.position.set(3, 2, 5);
    settle(pools, camera);
    expect(pools.state.active).toBe(2);
    const full = lights(pools).map((l) => l.intensity);
    settle(pools, camera, 'medium', 0.25);
    lights(pools).forEach((light, i) => expect(light.intensity).toBeCloseTo(full[i] * 0.25, 8));
    pools.update(camera, 0, 'ultra', 1 / 60);
    expect(pools.state.active).toBe(0);
    expect(pools.state.visible).toBe(0);
    settle(pools, camera);
    pools.reset();
    expect(lights(pools).every((l) => !l.visible && l.intensity === 0)).toBe(true);
    pools.update(camera, 1, 'medium', 0);
    expect(pools.state.active).toBe(0);
    pools.dispose();
  });

  it('rejects invalid or upward emitters and does not let non-finite inputs light the scene', () => {
    const source = socket(0, 0);
    const pools = new FestivalPracticalLights([
      { ...source, position: new T.Vector3(NaN, 3, 0) },
      { ...source, target: new T.Vector3(0, 4, 4.8) },
      { ...source, target: new T.Vector3(0, 0.08, 0.1) },
      { ...source, color: NaN },
      source,
    ]);
    expect(pools.state.sockets).toBe(1);
    const camera = new T.PerspectiveCamera();
    camera.position.set(0, 1, 4);
    settle(pools, camera);
    expect(pools.state.active).toBe(1);
    for (const night of [NaN, Infinity, -1]) {
      pools.update(camera, night, 'medium', NaN);
      expect(pools.state.active).toBe(0);
      expect(lights(pools).every((l) => Number.isFinite(l.intensity) && l.intensity === 0)).toBe(
        true,
      );
    }
    camera.position.x = NaN;
    pools.update(camera, 1, 'ultra', 1 / 60);
    expect(pools.state.active).toBe(0);
    pools.dispose();
  });

  it('releases its owned light resources once and remains inert after disposal', () => {
    const pools = new FestivalPracticalLights([socket(0, 0)]),
      scene = new T.Scene(),
      camera = new T.PerspectiveCamera();
    camera.position.set(0, 2, 5);
    scene.add(pools.root);
    settle(pools, camera);
    const spies = lights(pools).map((light) => vi.spyOn(light, 'dispose'));
    pools.dispose();
    pools.dispose();
    pools.update(camera, 1, 'ultra', 1);
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(scene.children).toHaveLength(0);
    expect(pools.root.children).toHaveLength(0);
    expect(pools.state.active).toBe(0);
  });

  it('anchors real regional shop sockets to rotated front signs and festoons to actual suspended bulbs', () => {
    const world = openWorld(),
      structures = regionStructures(world),
      dressing = new HorizonDressing(world, structures),
      shops = structures.filter(
        (s) => s.kind === 'shop' || s.kind === 'block' || s.kind === 'terminal',
      );
    const point = trackPoint();
    const shopSockets = dressing.lightSockets.filter((source) => source.kind === 'storefront');
    expect(shopSockets).toHaveLength(dressing.stats.shopSigns);
    expect(shopSockets.length).toBeGreaterThan(500);
    for (let i = 0; i < shops.length; i++) {
      const s = shops[i],
        source = shopSockets[i],
        c = Math.cos(s.heading),
        n = Math.sin(s.heading),
        dx = source.position.x - s.x,
        dz = source.position.z - s.z;
      world.network.nearest(s.x, s.z, point);
      const side = (point.x - s.x) * -n + (point.z - s.z) * c >= 0 ? 1 : -1;
      expect(dx * c + dz * n).toBeCloseTo(0, 8);
      expect(-dx * n + dz * c).toBeCloseTo(side * (s.hz + 0.12), 8);
      expect(source.position.y).toBeCloseTo(s.base + 3, 8);
      expect(source.target.y).toBeCloseTo(
        carvedGroundHeight(world.carver, source.target.x, source.target.z) + 0.08,
        8,
      );
      const beamX = source.target.x - source.position.x,
        beamZ = source.target.z - source.position.z;
      expect(beamX * (-n * side) + beamZ * (c * side)).toBeGreaterThan(4.7);
    }
    const festoons = dressing.lightSockets.filter((source) => source.kind === 'festoon');
    expect(festoons.length).toBeGreaterThan(0);
    for (const source of festoons) {
      expect(source.target.x).toBe(source.position.x);
      expect(source.target.z).toBe(source.position.z);
      expect(source.position.y - source.target.y).toBeGreaterThan(7);
      expect(source.position.y - source.target.y).toBeLessThan(10);
    }
    const pools = new FestivalPracticalLights(dressing.lightSockets);
    expect(pools.state.sockets).toBeGreaterThan(500);
    pools.dispose();
    dressing.dispose();
  });
});
