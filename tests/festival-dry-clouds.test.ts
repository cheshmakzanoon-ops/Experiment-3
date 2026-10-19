import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { Effects, EFFECT_CAPACITY, PARTICLE_KIND } from '../src/rendering/effects.ts';
import { EffectPlayback } from '../src/rendering/effect-playback.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  W,
  WHEEL_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';

function frame(time: number, kind: number) {
  const f = new Float32Array(HEADER + CAR_STRIDE),
    o = carBase(0);
  f[H.TIME] = time;
  f[H.CARS] = 1;
  f[H.WIND_X] = 3;
  f[o + F.QW] = 1;
  f[o + F.Y] = 1;
  f[o + F.Z] = time * 24;
  f[o + F.SPEED] = 24;
  f[o + F.VZ] = 24;
  for (let wheel = 0; wheel < 4; wheel++) {
    const p = o + WHEEL_BASE + wheel * WHEEL_STRIDE;
    f[p + W.LOAD] = 2500;
    f[p + W.WATER] = kind === PARTICLE_KIND.SPRAY ? 0.5 : 0;
    f[p + W.SURFACE] = kind === PARTICLE_KIND.DUST ? 3 : 0;
    f[p + W.SLIP] = 0.5;
    f[p + W.SLIP_POWER] = 14000;
  }
  return f;
}
function cloud(effects: Effects) {
  return effects.group.getObjectByName('Lit wheel-water spray clouds') as T.Mesh<
    T.InstancedBufferGeometry,
    T.ShaderMaterial
  >;
}
function dispose(effects: Effects) {
  effects.group.traverse((object) => {
    if (!(object instanceof T.Mesh || object instanceof T.Points)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      material.dispose();
  });
}

describe('Festival dry plume optics', () => {
  it('is opt-in per scene and changes no geometry, buffers or particle draw budget', () => {
    const effects = new Effects(),
      mesh = cloud(effects);
    try {
      const geometry = mesh.geometry,
        attributes = { ...geometry.attributes };
      expect(mesh.material.uniforms.dryCloudDetail.value).toBe(0);
      for (const enabled of [true, false, true]) {
        effects.setDryCloudDetail(enabled);
        expect(mesh.material.uniforms.dryCloudDetail.value).toBe(Number(enabled));
        expect(mesh.geometry).toBe(geometry);
        expect(mesh.geometry.attributes).toEqual(attributes);
      }
      expect(geometry.instanceCount).toBe(EFFECT_CAPACITY.contact);
      expect(geometry.index!.count).toBe(6);
      expect(effects.group.children).toHaveLength(3);
    } finally {
      dispose(effects);
    }
  });

  it.each([PARTICLE_KIND.SMOKE, PARTICLE_KIND.DUST, PARTICLE_KIND.SPRAY])(
    'keeps kind %i births, wind, lifetime, sizes and colors identical through playback, pause and reset',
    (kind) => {
      const original = new Effects(),
        detailed = new Effects();
      detailed.setDryCloudDetail(true);
      const a = new EffectPlayback(original),
        b = new EffectPlayback(detailed);
      try {
        for (let i = 0; i <= 120; i++) {
          const sample = frame(i / 60, kind);
          a.update(sample);
          b.update(sample);
        }
        expect(detailed.diagnostics().spawned[kind]).toBeGreaterThan(0);
        expect(detailed.diagnostics()).toEqual(original.diagnostics());
        for (const [name, attribute] of Object.entries(cloud(original).geometry.attributes))
          expect(cloud(detailed).geometry.getAttribute(name).array).toEqual(attribute.array);
        const before = detailed.diagnostics();
        for (let i = 0; i < 10; i++) b.update(frame(2, kind));
        expect(detailed.diagnostics()).toEqual(before);
        b.reset();
        expect(cloud(detailed).geometry.instanceCount).toBe(0);
        expect(detailed.diagnostics().active.every((n) => n === 0)).toBe(true);
        expect(cloud(detailed).material.uniforms.dryCloudDetail.value).toBe(1);
        // New circuit instances retain their original presentation even when
        // another scene has enabled Festival detail.
        expect(cloud(original).material.uniforms.dryCloudDetail.value).toBe(0);
      } finally {
        dispose(original);
        dispose(detailed);
      }
    },
  );
});
