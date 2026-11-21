import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials, BikeModel, staticSag, type BikePoseValues } from '../src/rendering/bike.ts';
import { gpDiscGlow, gpSteelDiscGlow } from '../src/rendering/gp-disc-glow.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'measureText'
          ? () => ({ width: 12 })
          : String(key).includes('Gradient')
            ? () => ({ addColorStop() {} })
            : () => {},
      set: () => true,
    },
  );
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
});
afterAll(() => vi.unstubAllGlobals());

describe('swept GP brake tracks', () => {
  it.each(['gpr1', 'gpr2'] as const)(
    '%s has independently heated front and rear faces in every production wheel batch',
    (id) => {
      const spec = VEHICLES[id],
        m = new BikeMaterials(0);
      for (const detail of ['far', 'mid', 'high'] as const) {
        const model = new BikeModel(spec, 0, detail, m, true);
        for (const [spin, rear] of [
          [model.frontSpin, false],
          [model.rearSpin, true],
        ] as const) {
          let vertices = 0;
          spin.traverse((o) => {
            if (!(o instanceof T.Mesh) || o.material !== m.disc) return;
            const uv = o.geometry.getAttribute('uv');
            for (let i = 0; i < uv.count; i++) {
              const r = Math.hypot(uv.getX(i) - Number(rear), uv.getY(i));
              expect(r).toBeLessThanOrEqual(rear ? 0.111 : 0.171);
              if (!rear) expect(r).toBeGreaterThan(0.114);
            }
            vertices += uv.count;
          });
          expect(vertices).toBeGreaterThan(50);
        }
        const sag = staticSag(spec);
        const pose: BikePoseValues = {
          fork: sag.fork,
          shock: sag.shock,
          steer: 0,
          frontRotation: 0,
          rearRotation: 0,
          chassisLean: 0,
          riderOffset: 0,
          tuck: 0.6,
          brake: 0.8,
          rearBrake: 0,
          discTemp: 920,
          rearDiscTemp: 85,
          compoundColour: 0xffffff,
          riding: true,
        };
        model.pose(pose);
        expect(m.disc.emissiveIntensity).toBe(gpDiscGlow(920));
        expect(m.gpRearRotorGlow.value).toBe(0);
        model.pose({ ...pose, discTemp: 100, rearDiscTemp: 800 });
        expect(m.disc.emissiveIntensity).toBe(0);
        expect(m.gpRearRotorGlow.value).toBe(gpSteelDiscGlow(800));
        expect(m.gpRearRotorGlow.value).toBeGreaterThan(0);
        model.pose({ ...pose, rearDiscTemp: undefined });
        expect(m.gpRearRotorGlow.value).toBe(0);
        model.dispose();
      }
      expect(studioHookKeys(m.disc)).toContain('gp-swept-brake-tracks-v1');
      expect(studioHookKeys(m.steel)).not.toContain('gp-swept-brake-tracks-v1');
      m.dispose();
    },
  );
});
