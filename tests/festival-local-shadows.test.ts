import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { FestivalShadows } from '../src/rendering/open-world/festival-shadows.ts';
import {
  STREET_SHADOWS,
  StreetLightPools,
  type StreetLightSocket,
} from '../src/rendering/open-world/street-light-pools.ts';
import type { QualityPreset } from '../src/rendering/options.ts';

const sockets: StreetLightSocket[] = Array.from({ length: 24 }, (_, i) => ({
  position: new T.Vector3(i * 12, 6.82, 0),
  target: new T.Vector3(i * 12 + 1.05, 0.08, 0),
}));

/** Real pool/far-shadow owners and Three lights/targets. Only GPU submission
 * is substituted, following both of WebGLShadowMap's global/per-light gates.
 * This observes which pass consumes requests, not shader or pixel quality. */
function host() {
  const pools = new StreetLightPools(sockets),
    scene = new T.Scene(),
    camera = new T.PerspectiveCamera(),
    moving = new T.Group();
  camera.position.set(36, 4, 0);
  scene.add(pools.root, moving);
  const lights = pools.root.children.filter(
    (object): object is T.SpotLight => object instanceof T.SpotLight,
  );
  const captures: { light: T.SpotLight; moversVisible: boolean; position: number[] }[] = [];
  let target: T.WebGLRenderTarget | null = null;
  const backend = {
    shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false },
    capabilities: { maxTextureSize: 4096 },
    getRenderTarget: () => target,
    setRenderTarget: (next: T.WebGLRenderTarget | null) => {
      target = next;
    },
    render: vi.fn((_scene: T.Scene, _camera: T.Camera) => {
      if (
        !backend.shadowMap.enabled ||
        (!backend.shadowMap.autoUpdate && !backend.shadowMap.needsUpdate)
      )
        return;
      scene.updateMatrixWorld(true);
      scene.traverseVisible((object) => {
        if (
          !(object instanceof T.SpotLight || object instanceof T.DirectionalLight) ||
          !object.castShadow
        )
          return;
        const shadow = object.shadow;
        if (!shadow.autoUpdate && !shadow.needsUpdate) return;
        shadow.map ??= new T.WebGLRenderTarget(shadow.mapSize.x, shadow.mapSize.y);
        shadow.updateMatrices(object);
        if (object instanceof T.SpotLight) {
          captures.push({
            light: object,
            moversVisible: moving.visible,
            position: object.position.toArray(),
          });
          shadow.map.texture.userData.capturePosition = object.position.toArray();
        }
        shadow.needsUpdate = false;
      });
      backend.shadowMap.needsUpdate = false;
    }),
  };
  const renderer = backend as unknown as T.WebGLRenderer;
  const settle = (quality: QualityPreset = 'ultra', night = 1) => {
    for (let i = 0; i < 70; i++) pools.update(camera, night, quality, 1 / 60);
  };
  const draw = (time = 10, revision = 1) =>
    pools.renderWithShadows(renderer, time, revision, () => renderer.render(scene, camera));
  return { pools, scene, camera, moving, lights, captures, renderer, backend, settle, draw };
}

describe('bounded Festival local shadow maps', () => {
  it('allocates only the quality budget in short finite cones and obeys device texture limits', () => {
    const h = host();
    for (const [quality, count, size] of [
      ['low', 0, 0],
      ['medium', 0, 0],
      ['high', 1, 512],
      ['ultra', 2, 1024],
    ] as const) {
      h.settle(quality);
      // Light selection itself never allocates a render target.
      expect(h.pools.diagnostics().allocatedMaps).toBe(0);
      h.draw();
      expect(h.pools.diagnostics()).toMatchObject({
        shadowBudget: count,
        shadowMapSize: size,
        readyShadows: count,
        allocatedMaps: count,
        allocatedTexels: count * size * size,
      });
      for (const light of h.lights.filter((light) => light.castShadow)) {
        expect(light.position.distanceTo(h.camera.position)).toBeLessThanOrEqual(
          STREET_SHADOWS.reach,
        );
        expect(light.shadow.camera.near).toBe(STREET_SHADOWS.near);
        expect(light.shadow.camera.far).toBe(STREET_SHADOWS.far);
        expect(light.shadow.autoUpdate).toBe(false);
        expect(light.shadow.needsUpdate).toBe(false);
      }
    }
    h.pools.configureShadows('ultra', true, 256);
    h.settle('ultra');
    h.draw();
    expect(h.pools.diagnostics()).toMatchObject({
      allocatedMaps: 2,
      shadowMapSize: 256,
      allocatedTexels: 2 * 256 * 256,
    });
    h.pools.dispose();
  });

  it('captures with movers restored after a real far bake, even when global automatic updates are off', () => {
    const h = host();
    h.settle();
    const sun = new T.DirectionalLight();
    sun.castShadow = true;
    h.scene.add(sun, sun.target);
    const far = new FestivalShadows(h.renderer, h.scene, sun);
    far.configure(1024);
    const terrain = new T.Group();
    h.scene.add(terrain);
    expect(
      far.update({
        subject: new T.Vector3(),
        lighting: 'night',
        terrainRevision: 1,
        dt: 1 / 60,
        terrain,
        planting: [],
        hidden: [h.moving],
      }),
    ).toBe(true);
    expect(h.captures).toHaveLength(0);
    expect(h.pools.diagnostics().allocatedMaps).toBe(0);
    expect(h.moving.visible).toBe(true);
    expect(h.renderer.shadowMap.autoUpdate).toBe(false);
    h.draw();
    expect(h.captures).toHaveLength(2);
    expect(h.captures.every((capture) => capture.moversVisible)).toBe(true);
    expect(h.renderer.shadowMap.autoUpdate).toBe(false);
    expect(h.renderer.shadowMap.needsUpdate).toBe(false);
    // An auxiliary render cannot spend these same requests again.
    h.renderer.shadowMap.autoUpdate = true;
    h.renderer.render(h.scene, h.camera);
    expect(h.captures).toHaveLength(2);
    h.pools.dispose();
    far.dispose();
    sun.shadow.dispose();
  });

  it('reuses held maps and refreshes actual motion, terrain, authored scenery, photo movement and seeks', () => {
    const h = host();
    h.settle();
    h.draw();
    const maps = h.lights.filter((light) => light.shadow.map).map((light) => light.shadow.map!);
    const disposed = maps.map((map) => vi.spyOn(map, 'dispose'));
    for (let i = 0; i < 120; i++) {
      h.pools.update(h.camera, 1, 'ultra', 1 / 60);
      h.draw();
    }
    expect(h.captures).toHaveLength(2);
    expect(h.pools.diagnostics().requestedUpdates).toBe(0);
    h.draw(10 + 1 / 120);
    expect(h.captures).toHaveLength(4);
    h.draw(10 + 1 / 120, 2);
    expect(h.captures).toHaveLength(6);
    h.pools.invalidate();
    h.draw(10 + 1 / 120, 2);
    expect(h.captures).toHaveLength(8);
    h.camera.position.z += 0.25;
    h.pools.update(h.camera, 1, 'ultra', 0);
    h.draw(10 + 1 / 120, 2);
    expect(h.captures).toHaveLength(10);
    h.draw(3, 2);
    expect(h.captures).toHaveLength(12);
    disposed.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    h.pools.dispose();
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('keeps a shadow socket around the selection boundary and never reuses its map after a lamp moves', () => {
    const h = host();
    h.settle('high');
    h.draw();
    const selected = h.pools.diagnostics().shadowSockets;
    const initial = h.lights.find((light) => light.castShadow)!.shadow.map!;
    const release = vi.spyOn(initial, 'dispose');
    for (let i = 0; i < 40; i++) {
      h.camera.position.x = 42 + (i % 2 ? 0.04 : -0.04);
      h.pools.update(h.camera, 1, 'high', 1 / 60);
      h.draw();
      expect(h.pools.diagnostics().shadowSockets).toEqual(selected);
    }
    expect(release).not.toHaveBeenCalled();
    h.camera.position.x = 220;
    let moved = 0;
    for (let i = 0; i < 100; i++) {
      const before = h.lights.map((light) => light.position.clone());
      h.pools.update(h.camera, 1, 'high', 1 / 60);
      h.lights.forEach((light, index) => {
        if (!light.position.equals(before[index])) {
          moved++;
          expect(light.intensity).toBe(0);
          expect(light.shadow.map).toBeNull();
          expect(light.shadow.intensity).toBe(0);
        }
      });
      h.draw(20 + i / 60);
      for (const light of h.lights.filter((light) => light.castShadow)) {
        if (light.shadow.map)
          expect(light.shadow.map.texture.userData.capturePosition).toEqual(
            light.position.toArray(),
          );
        else expect(light.shadow.intensity).toBe(0);
      }
      expect(h.pools.diagnostics().allocatedMaps).toBeLessThanOrEqual(1);
    }
    expect(moved).toBeGreaterThan(0);
    expect(release).toHaveBeenCalledTimes(1);
    expect(h.pools.diagnostics().shadowSockets.every((index) => index >= 15)).toBe(true);
    h.pools.dispose();
  });

  it('releases maps immediately on downgrade, custom shadows-off, daylight and teardown', () => {
    const h = host();
    h.settle();
    h.draw();
    const targets = h.lights.filter((light) => light.shadow.map).map((light) => light.shadow.map!);
    const disposers = targets.map((map) => vi.spyOn(map, 'dispose'));
    h.pools.configureShadows('medium');
    expect(h.pools.diagnostics().allocatedMaps).toBe(0);
    expect(h.lights.every((light) => !light.castShadow)).toBe(true);
    disposers.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    h.settle('high');
    h.draw();
    expect(h.pools.diagnostics().allocatedMaps).toBe(1);
    h.pools.configureShadows('high', false);
    h.settle('high');
    h.draw();
    expect(h.pools.diagnostics().allocatedMaps).toBe(0);
    h.pools.configureShadows('ultra', true);
    h.settle();
    h.draw();
    h.settle('ultra', 0);
    expect(h.pools.diagnostics().allocatedMaps).toBe(0);
    h.settle();
    h.draw();
    const maps = h.lights
      .filter((light) => light.shadow.map)
      .map((light) => vi.spyOn(light.shadow.map!, 'dispose'));
    const lightDisposers = h.lights.map((light) => vi.spyOn(light, 'dispose'));
    h.pools.dispose();
    h.pools.dispose();
    h.pools.configureShadows('ultra');
    h.settle();
    h.draw(30);
    maps.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    lightDisposers.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(h.pools.root.children).toHaveLength(0);
    expect(h.pools.diagnostics().allocatedMaps).toBe(0);
  });

  it('does not publish a partially drawn shadow and retries without reallocating valid target storage', () => {
    const h = host();
    h.settle();
    expect(() =>
      h.pools.renderWithShadows(h.renderer, 10, 1, () => {
        h.renderer.render(h.scene, h.camera);
        throw new Error('Interrupted scene draw');
      }),
    ).toThrow('Interrupted scene draw');
    expect(h.pools.diagnostics().readyShadows).toBe(0);
    expect(h.lights.every((light) => !light.shadow.needsUpdate)).toBe(true);
    expect(h.lights.every((light) => light.shadow.intensity === 0)).toBe(true);
    expect(h.renderer.shadowMap.needsUpdate).toBe(false);
    const maps = h.lights.map((light) => light.shadow.map);
    h.draw();
    expect(h.pools.diagnostics().readyShadows).toBe(2);
    expect(h.lights.map((light) => light.shadow.map)).toEqual(maps);
    h.renderer.shadowMap.enabled = false;
    h.draw(11);
    expect(h.pools.diagnostics().allocatedMaps).toBe(0);
    h.pools.dispose();
  });

  it('withdraws an unconsumed request instead of leaking it into an auxiliary pass', () => {
    const h = host();
    h.settle('high');
    h.pools.renderWithShadows(h.renderer, 10, 1, () => {});
    expect(h.renderer.shadowMap.needsUpdate).toBe(false);
    expect(h.lights.every((light) => !light.shadow.needsUpdate)).toBe(true);
    expect(h.pools.diagnostics().readyShadows).toBe(0);
    h.renderer.render(h.scene, h.camera);
    expect(h.captures).toHaveLength(0);
    h.draw();
    expect(h.pools.diagnostics().readyShadows).toBe(1);
    h.pools.dispose();
  });

  it('keeps night shadow shader counts fixed in empty countryside without retaining or rendering maps', () => {
    const h = host();
    h.settle();
    h.draw();
    h.camera.position.set(10000, 4, 10000);
    h.settle();
    const captured = h.captures.length;
    h.draw(11);
    expect(h.pools.diagnostics()).toMatchObject({
      shaderShadowLights: 2,
      allocatedMaps: 0,
      requestedUpdates: 0,
      readyShadows: 0,
    });
    expect(h.pools.diagnostics().shadowSockets).toEqual([]);
    expect(h.captures).toHaveLength(captured);
    expect(
      h.lights.filter((light) => light.castShadow).every((light) => light.shadow.intensity === 0),
    ).toBe(true);
    h.pools.dispose();
  });
});
