import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { A61_MANIFESTS, type RivalLevels } from '../src/rendering/a61-rival.ts';
import { FormulaCar } from '../src/rendering/car.ts';
import { DriverAsset } from '../src/rendering/driver-asset.ts';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import {
  HERO_DECAL_ATLAS,
  HERO_DECAL_FRAMES,
  HERO_DECAL_RECTS,
  HERO_LIVERY_GLSL,
  HERO_LIVERY_KEY,
  HeroLivery,
} from '../src/rendering/apx01-livery.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { DEFAULT_LIVERY } from '../src/storage/livery.ts';

/** Vehicle art 3: the player's APX-01 aero livery (indigo endplates, volt rail, sponsor decals)
 * is planar-projected in car space, so its frames must sit on the REAL authored plates and wing. */
let levels: RivalLevels, driver: DriverAsset, legacy: HeroShells;
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
function compile(material: T.Material) {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
function dispose(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
}
const colours = {
  secondary: '#0d0b24',
  accent: '#d8ff3c',
  title: 'VOLTEX',
  partners: ['KESTREL TIME', 'AUREL BANK'],
} as const;

describe('APX-01 hero livery layer', () => {
  it('keeps every decal inside the atlas and the shader inside its own region tests', () => {
    for (const r of Object.values(HERO_DECAL_RECTS)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(HERO_DECAL_ATLAS.width);
      expect(r.y + r.h).toBeLessThanOrEqual(HERO_DECAL_ATLAS.height);
    }
    // A decal is drawn only on an OUTWARD face (the inner face of a plate is mirrored text).
    expect(HERO_LIVERY_GLSL).toContain('vHeroN.x * (hp.x >= 0.0 ? 1.0 : -1.0)');
    expect(HERO_LIVERY_GLSL).toContain('step(0.5, vHeroN.y)');
    // No time, no random, no light: a pure object-space function.
    expect(HERO_LIVERY_GLSL).not.toMatch(/time|rand|cameraPosition/i);
  });
  it('chains once, after the base livery, and carries its own uniforms and normal varying', () => {
    canvasStub();
    const livery = new HeroLivery(colours);
    const material = new T.MeshPhysicalMaterial();
    expect(livery.install(material)).toBe(true);
    expect(livery.install(material)).toBe(false);
    expect(studioHookKeys(material)).toEqual([HERO_LIVERY_KEY]);
    const shader = compile(material);
    expect(Object.keys(shader.uniforms).sort()).toEqual([
      'heroAccent',
      'heroDecals',
      'heroSecondary',
    ]);
    expect(shader.vertexShader).toContain('vHeroN = normal;');
    expect(shader.fragmentShader).toContain('uniform sampler2D heroDecals;');
    expect(shader.fragmentShader.indexOf('heroPaint')).toBeGreaterThan(
      shader.fragmentShader.indexOf('#include <color_fragment>'),
    );
    // A livery edit repaints the same texture object, recolours in place and flags the upload.
    const texture = livery.texture;
    const version = texture.version;
    livery.repaint({ ...colours, accent: '#ff8800', title: 'KESTREL TIME' });
    expect(livery.texture).toBe(texture);
    expect(texture.version).toBeGreaterThan(version);
    expect(livery.uniforms.heroAccent.value.getHexString()).toBe(
      new T.Color('#ff8800').getHexString(),
    );
    livery.dispose();
    material.dispose();
  });
  it('lies on the real plates and the real wing of the authored near level', () => {
    const near = levels[0];
    const box = (
      part: 'front_paint' | 'rear_paint',
      accept: (p: T.Vector3, n: T.Vector3) => boolean,
    ) => {
      const g = near.copy(part, -1);
      const p = g.getAttribute('position'),
        n = g.getAttribute('normal');
      const b = new T.Box3();
      const v = new T.Vector3(),
        w = new T.Vector3();
      let count = 0;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        w.fromBufferAttribute(n, i);
        if (!accept(v, w)) continue;
        b.expandByPoint(v);
        count++;
      }
      g.dispose();
      return { b, count };
    };
    const F = HERO_DECAL_FRAMES;
    // Front endplate: outward faces at |x| above the decal threshold.
    const front = box(
      'front_paint',
      (p, n) => Math.abs(p.x) >= F.front.xOuter && n.x * Math.sign(p.x) > 0.7,
    );
    expect(front.count).toBeGreaterThan(50);
    expect(front.b.min.z).toBeGreaterThanOrEqual(F.front.z0 - 0.05);
    expect(front.b.max.z).toBeLessThanOrEqual(F.front.z1 + 0.05);
    expect(front.b.min.y).toBeGreaterThanOrEqual(F.front.y0 - 0.04);
    expect(front.b.max.y).toBeLessThanOrEqual(F.front.y1 + 0.1);
    // The frame is mostly plate, not mostly air: at least half of it is spanned by the plate.
    const spanZ = Math.min(front.b.max.z, F.front.z1) - Math.max(front.b.min.z, F.front.z0);
    expect(spanZ / (F.front.z1 - F.front.z0)).toBeGreaterThan(0.6);
    // Rear endplate.
    const rear = box(
      'rear_paint',
      (p, n) => Math.abs(p.x) >= F.rear.xOuter && n.x * Math.sign(p.x) > 0.7,
    );
    expect(rear.count).toBeGreaterThan(20);
    expect(rear.b.min.z).toBeGreaterThanOrEqual(F.rear.z0 - 0.05);
    expect(rear.b.max.z).toBeLessThanOrEqual(F.rear.z1 + 0.05);
    expect(rear.b.min.y).toBeLessThanOrEqual(F.rear.y0 + 0.02);
    expect(rear.b.max.y).toBeGreaterThanOrEqual(F.rear.y1);
    // Rear wing upper element: its top surface spans the strip in x, z and y.
    const wing = box(
      'rear_paint',
      (p, n) => Math.abs(p.x) <= F.wing.x1 && n.y > 0.7 && p.y > F.wing.y0,
    );
    expect(wing.count).toBeGreaterThan(100);
    expect(wing.b.min.z).toBeLessThanOrEqual(F.wing.z0 + 0.03);
    expect(wing.b.max.z).toBeGreaterThanOrEqual(F.wing.z1 - 0.03);
    expect(wing.b.min.y).toBeGreaterThanOrEqual(F.wing.y0 - 0.02);
    expect(wing.b.max.y).toBeLessThanOrEqual(F.wing.y1 + 0.02);
    expect(wing.b.min.x).toBeLessThanOrEqual(-F.wing.x1 + 0.05);
    expect(wing.b.max.x).toBeGreaterThanOrEqual(F.wing.x1 - 0.05);
  });
  it("is the player's alone, follows a livery edit, and leaves the wings' alloy role in carbon", () => {
    canvasStub();
    const player = new FormulaCar(0, legacy, driver, undefined, levels);
    const rival = new FormulaCar(1, legacy, driver, undefined, levels);
    try {
      // Later installers (race grime, paint observation) wrap the hook without its key list, so
      // check the compiled program: the player's body paint carries the layer, a rival's does not,
      // and it follows the base livery pattern in the same shader.
      const hero = compile(player.paint).fragmentShader;
      expect(hero).toContain('uniform sampler2D heroDecals;');
      expect(hero.indexOf('heroPaint')).toBeGreaterThan(
        hero.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, liverySecondary'),
      );
      expect(compile(rival.paint).fragmentShader).not.toContain('heroDecals');
      // A saved livery edit reaches the decal atlas (the sponsor text) without throwing.
      player.setLivery({ ...DEFAULT_LIVERY, sponsor: 'HALCYON AIR', accent: '#ffaa00' });
      // The wings no longer use the turned-alloy material: front/rear 'alloy' meshes are carbon.
      const wingMaterials = new Set<T.Material>();
      for (const wing of [player.frontWing, player.rearWing])
        wing.traverse((o) => {
          if (o instanceof T.Mesh) wingMaterials.add(o.material as T.Material);
        });
      for (const m of wingMaterials)
        expect((m as T.MeshStandardMaterial).userData.aurelManufacturingFinish ?? '').not.toBe(
          'turned-alloy',
        );
    } finally {
      dispose(player.root);
      dispose(rival.root);
    }
  });
});
