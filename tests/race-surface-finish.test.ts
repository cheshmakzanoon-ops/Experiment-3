import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { periodicCoverage } from '../src/rendering/periodic-coverage.ts';
import { bindTireSurface, tireWetAppearance, treadMaterial } from '../src/rendering/tire-finish.ts';
import { FormulaCar } from '../src/rendering/car.ts';
import { TireCarcass } from '../src/rendering/tire-carcass.ts';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import { installVenueFinish } from '../src/rendering/venue-materials.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';
import { F, H, W, HEADER, CAR_STRIDE, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../src/simulation/protocol.ts';
import { disposePhase27Scene } from '../e2e/fixtures/phase27c-resources.ts';

afterEach(() => vi.unstubAllGlobals());
describe('race surface continuity', () => {
  it('integrates stripe coverage at negative phases, seams and minified footprints', () => {
    for (const half of [.004, .014, .05, .25])
      for (const footprint of [.005, .04, .3, 1, 3, 7])
        for (const centre of [-5.28, -.5, -.01, 0, .37, 1.01]) {
          let sum = 0;
          const samples = 20000;
          for (let i = 0; i < samples; i++) {
            const p = centre + footprint * ((i + .5) / samples - .5), f = p - Math.floor(p);
            if (f <= half || f >= 1 - half) sum++;
          }
          expect(Math.abs(periodicCoverage(centre, footprint, half) - sum / samples)).toBeLessThan(.001);
          expect(periodicCoverage(centre + 4, footprint, half)).toBeCloseTo(
            periodicCoverage(centre, footprint, half), 8);
        }
  });
  it('retains distant mean coverage rather than erasing all joints', () => {
    for (const phase of [-100, -.1, 0, .25, 40.37])
      for (const half of [0, .014, .1, .5]) {
        expect(periodicCoverage(phase, 32, half)).toBe(2 * half);
        expect(periodicCoverage(phase, 1000, half)).toBe(2 * half);
        expect(periodicCoverage(phase, 31.9999, half)).toBeCloseTo(2 * half, 8);
      }
    for (const args of [[NaN, 1, .1], [0, 0, .1], [0, -1, .1], [0, 1, -.1], [0, 1, .6]])
      expect(() => periodicCoverage(args[0], args[1], args[2])).toThrow();
  });
  it('separates airborne contact water, rainfall and retained road water', () => {
    expect(tireWetAppearance(0, 1, 0, 50)).toBe(0);
    expect(tireWetAppearance(14, 0, 0, 0)).toBe(1);
    expect(tireWetAppearance(0, .25, 3000, 25)).toBe(.25);
    expect(tireWetAppearance(0, .25, 3000, -25)).toBe(.25);
    expect(tireWetAppearance(0, 0, 3000, 25)).toBe(0);
    expect(tireWetAppearance(-1, -1, 3000, 25)).toBe(0);
    expect(tireWetAppearance(NaN, 1, 3000, 25)).toBe(0);
  });
  it('keeps bind coordinates, topology and UVs independent of live authored carcasses', async () => {
    const hero = await HeroShells.decode(new Uint8Array(readFileSync(
      new URL('../src/rendering/apx01-shell.glb.gz', import.meta.url))));
    try {
      for (const [role, half] of [['tire_front', .155], ['tire_rear', .19]] as const) {
        const geometry = hero.copy(role), before = geometry.getAttribute('position').array.slice();
        const index = geometry.index!.array.slice(), uv = geometry.getAttribute('uv').array.slice();
        const surface = treadMaterial(half), marking = new T.MeshStandardMaterial();
        const tire = new TireCarcass(half, surface.material, marking, geometry);
        try {
          const bind = geometry.getAttribute('tireBind'), values = bind.array.slice();
          expect(bind.count).toBe(geometry.getAttribute('position').count);
          expect(values).toEqual(before);
          expect(bindTireSurface(geometry)).toBe(geometry);
          expect(geometry.getAttribute('tireBind')).toBe(bind);
          for (let i = 0; i < 20; i++) tire.update(i * .1, .322, 5000, 155, .1);
          expect(bind.array).toEqual(values);
          expect(geometry.index!.array).toEqual(index);
          expect(geometry.getAttribute('uv').array).toEqual(uv);
          expect(geometry.getAttribute('position').array).not.toEqual(before);
        } finally { disposePhase27Scene(tire.root); }
      }
    } finally { hero.dispose(); }
  });
  it('maps reduced Y axles to the same material convention without changing geometry', () => {
    const g = new T.BoxGeometry(.6, .3, .6), original = g.getAttribute('position').array.slice();
    try {
      bindTireSurface(g, 'y');
      const bind = g.getAttribute('tireBind'), p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        expect(bind.getX(i)).toBe(-p.getY(i));
        expect(bind.getY(i)).toBe(p.getX(i));
        expect(bind.getZ(i)).toBe(p.getZ(i));
      }
      expect(p.array).toEqual(original);
      expect(() => treadMaterial(NaN)).toThrow();
      expect(() => bindTireSurface(new T.BufferGeometry())).toThrow();
    } finally { g.dispose(); }
  });
  it('observes all four live tyre states before LOD returns and restores an exact rewind', () => {
    // Geometry/state test only: this stub does not produce visual evidence.
    const context = new Proxy({} as Record<string, unknown>, {
      get(target, key: string) {
        if (key in target) return target[key];
        if (key === 'measureText') return (text: string) => ({ width: text.length * 8 });
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        return () => undefined;
      },
    });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
    const car = new FormulaCar(1), o = carBase(0);
    const clean = new Float32Array(HEADER + CAR_STRIDE);
    clean[H.CARS] = 1; clean[o + F.QW] = 1; clean[o + F.GEAR] = 1;
    clean[o + F.FRONT_HEALTH] = clean[o + F.REAR_HEALTH] = 1;
    for (let i = 0; i < 4; i++) {
      const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
      clean[p + W.LENGTH] = .3; clean[p + W.RADIUS] = .335; clean[p + W.PRESSURE] = 155;
    }
    const worn = clean.slice(); worn[H.RAIN] = 14; worn[o + F.COMPOUND] = 4;
    const geometries = new Set<T.BufferGeometry>();
    car.root.traverse((object) => { if (object instanceof T.Mesh) geometries.add(object.geometry); });
    const binds = [...geometries].filter((g) => g.hasAttribute('tireBind')).map((g) => g.getAttribute('tireBind'));
    try {
      for (const [distance, lod] of [[0, 0], [90, 1], [220, 2], [0, 0]]) {
        for (let i = 0; i < 4; i++) {
          const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
          worn[p + W.DIRT] = (i + 1) / 10; worn[p + W.WEAR] = .6;
        }
        const immutable = worn.slice(); car.setLod(distance, 'high', false);
        car.update(clean, worn, o, 1, 0, 0, false);
        expect(car.lodLevel).toBe(lod); expect(worn).toEqual(immutable);
        let rubber = 0;
        car.root.traverseVisible((object) => {
          if (object instanceof T.Mesh && car.treads.some((t) => t.material === object.material)) {
            rubber++; expect(object.geometry.hasAttribute('tireBind')).toBe(true);
          }
        });
        expect(rubber).toBe(4);
        for (let i = 0; i < 4; i++) {
          expect(car.treads[i].condition.value.x).toBe(worn[o + WHEEL_BASE + i * WHEEL_STRIDE + W.DIRT]);
          expect(car.treads[i].surface.value.x).toBe(1);
          expect(car.treads[i].surface.value.y).toBe(2);
          expect(car.rings[i]).toBeInstanceOf(T.MeshStandardMaterial);
          expect(car.rings[i].emissiveIntensity).toBe(1);
          expect(car.rings[i].emissive.getHex()).toBe(0);
        }
        expect(car.rearSignal.parent).toBe(car.root);
      }
      car.setLod(220, 'high', false); car.update(clean, clean, o, 1, 0, 0, false);
      for (const tread of car.treads) {
        expect(tread.condition.value.lengthSq()).toBe(0);
        expect(tread.surface.value.x).toBe(0); expect(tread.surface.value.y).toBe(0);
      }
      expect([...geometries].filter((g) => g.hasAttribute('tireBind')).map((g) => g.getAttribute('tireBind'))).toEqual(binds);
    } finally { disposePhase27Scene(car.root); }
  });
  it.each(['stone', 'timber', 'metal', 'paving', 'asphalt', 'kerb'] as const)(
    'composes %s coverage with the existing shader and lighting', (kind) => {
      const material = new T.MeshStandardMaterial();
      material.customProgramCacheKey = () => 'retained-hook';
      material.onBeforeCompile = (s) => { s.vertexShader = '// retained\n' + s.vertexShader; };
      if (kind === 'asphalt' || kind === 'kerb') installCircuitFinish(material, kind);
      else installVenueFinish(material, kind);
      const shader = { uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader,
        fragmentShader: T.ShaderLib.standard.fragmentShader } as T.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as T.WebGLRenderer);
      expect(shader.vertexShader.startsWith('// retained')).toBe(true);
      expect(shader.fragmentShader).toContain('apexStripeCoverage');
      expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>');
      expect(material.customProgramCacheKey()).toContain('retained-hook');
      expect(material.map).toBeNull(); material.dispose();
    });
});
