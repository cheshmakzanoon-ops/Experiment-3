import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import { A61_MANIFESTS, type RivalLevels } from '../src/rendering/a61-rival.ts';
import { FormulaCar } from '../src/rendering/car.ts';
import { DriverAsset } from '../src/rendering/driver-asset.ts';
import { LIVERY_SCHEMES } from '../src/rendering/car-livery.ts';
import { LIVERIES } from '../src/simulation/config.ts';
import { DEFAULT_LIVERY, LIVERY_PRESETS, validateLivery } from '../src/storage/livery.ts';

/**
 * G15: in a product build the player's APX-01 is the ORIGINAL authored car, not the
 * owner-supplied real-brand model. It is the same Blender-authored assembly the opponents
 * use (apx01-shell + the A61 levels), with the player's own livery driving the body, the
 * painted wheel covers and the nose identity. This ports the coverage that
 * tests/supplied-player.test.ts gave the default car: that file still tests the owner-only
 * asset; this one pins what a player now sees.
 */
let levels: RivalLevels, legacy: HeroShells, driver: DriverAsset;
beforeAll(async () => {
  levels = (await Promise.all(
    (['near', 'mid', 'far'] as const).map((name, i) =>
      HeroShells.decode(
        new Uint8Array(readFileSync(`src/rendering/a61-rival-${name}.glb.gz`)),
        undefined,
        A61_MANIFESTS[i],
      ),
    ),
  )) as unknown as RivalLevels;
  legacy = await HeroShells.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-shell.glb.gz')),
  );
  driver = await DriverAsset.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-driver.glb.gz')),
  );
});
afterAll(() => {
  levels?.forEach((a) => a.dispose());
  legacy?.dispose();
  driver?.dispose();
});
afterEach(() => vi.unstubAllGlobals());

function canvasStub() {
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient')
        return () => ({ addColorStop() {} });
      return () => undefined;
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}
function dispose(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}

it('builds the player car from the original authored levels when no supplied model is loaded', () => {
  canvasStub();
  const player = new FormulaCar(0, legacy, driver, undefined, levels);
  const rival = new FormulaCar(1, legacy, driver, undefined, levels);
  try {
    expect(player.suppliedPlayer).toBeNull();
    expect(player.suppliedLookdev).toBeNull();
    expect(player.root.userData.suppliedPlayer).toBeUndefined();
    // Same authored bodywork as the opponents: three A61 levels, the 41-role assembly.
    expect(player.root.userData.a61).toHaveLength(3);
    expect(player.root.userData.a61).toEqual(rival.root.userData.a61);
    expect(player.root.userData.authoredBodywork).toBeTruthy();
    // The followed player always draws the near level (carLod); the A61 mid and far levels
    // exist for mirrors (showDetail) and are driven exactly like an opponent's.
    for (const distance of [0, 100, 250]) {
      player.setLod(distance, 'high', true);
      expect(player.lodLevel).toBe(0);
    }
    for (const [distance, level] of [
      [0, 0],
      [100, 1],
      [250, 2],
    ] as const) {
      rival.setLod(distance, 'high', false);
      expect(rival.lodLevel).toBe(level);
    }
    // Mirrors, steering wheel, driver and helmet exist on the procedural cockpit.
    expect(player.mirrors).toHaveLength(2);
    expect(player.driver.root.children.length).toBeGreaterThan(0);
    expect(player.steering.children.length).toBeGreaterThan(0);
  } finally {
    dispose(player.root);
    dispose(rival.root);
  }
});

it('keeps the owner-supplied path available for owner builds only', () => {
  // The asset parameter is still honoured: an owner build passes it (renderer.ts), a
  // product build never does. Without it the player must use the authored levels.
  const sourceCar = readFileSync('src/rendering/car.ts', 'utf8');
  expect(sourceCar).toContain('(id > 0 || !suppliedAsset) ? rivals : undefined');
  expect(sourceCar).toContain('OWNER_BUILD && this.suppliedPlayer');
});

it("the player's cockpit lens setting applies to the authored cockpit, not only to the owner-supplied one", () => {
  // Found by e2e/p0-cockpit-framing on the product build: the original car took the T-cam
  // lens (58 degrees) and ignored the Graphics "Cockpit field of view" setting, because the
  // lens was only selected when a supplied model was loaded.
  const renderer = readFileSync('src/rendering/renderer.ts', 'utf8');
  expect(renderer).not.toMatch(/cameraMode === 'cockpit' && car\.suppliedPlayer\s*\?\s*cockpitFov/);
  expect(renderer).toMatch(
    /: cameraMode === 'cockpit'\s*\?[^:]*?cockpitFov\(this\.graphics\.cockpitFov\)/s,
  );
});

it('the default livery is the hero scheme and drives the body, covers and identity together', () => {
  canvasStub();
  expect(DEFAULT_LIVERY.primary).toBe('#5b2bd6');
  expect(LIVERIES[0]).toBe(0x5b2bd6);
  expect(LIVERY_SCHEMES[0]).toMatchObject({
    primary: '#5b2bd6',
    accent: '#d8ff3c',
    title: 'VOLTEX',
    finish: 'metallic',
  });
  expect(LIVERY_PRESETS.voltage).toEqual(DEFAULT_LIVERY);
  expect(validateLivery(null)).toEqual(DEFAULT_LIVERY);
  const car = new FormulaCar(0, legacy, driver, undefined, levels);
  try {
    car.setLivery({ ...DEFAULT_LIVERY });
    expect(car.paint.color.getHexString()).toBe('5b2bd6');
    const cover = (
      car as unknown as {
        coverPaint: {
          material: T.MeshPhysicalMaterial;
          uniforms: Record<string, { value: T.Color }>;
        };
      }
    ).coverPaint;
    expect(cover.material.color.getHexString()).toBe('5b2bd6');
    expect(cover.uniforms.coverAccent.value.getHexString()).toBe('d8ff3c');
    // A player edit repaints the covers with the body (they used to keep the team-0 colour).
    car.setLivery({ ...DEFAULT_LIVERY, primary: '#134862', accent: '#efc89d' });
    expect(car.paint.color.getHexString()).toBe('134862');
    expect(cover.material.color.getHexString()).toBe('134862');
    expect(cover.uniforms.coverAccent.value.getHexString()).toBe('efc89d');
  } finally {
    dispose(car.root);
  }
});
