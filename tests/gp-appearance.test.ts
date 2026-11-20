import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  BikeMaterials,
  BikeModel,
  exhaustGeometry,
  GP_TITANIUM_OXIDE,
} from '../src/rendering/bike.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import {
  bindGpBareMetal,
  calibrateGpMaterials,
  gpFrontFender,
  gpScreenAlpha,
  gpSilencer,
  gpSilencerHeatSoak,
  GP_METAL_ANISOTROPY,
  GP_SCREEN_ALPHA,
  GP_TAIL_LED,
  installGpTitaniumOxideGloss,
  setGpMetalAnisotropy,
} from '../src/rendering/gp-appearance.ts';
import { gpRainLenses } from '../src/rendering/gp-rear-chassis.ts';
import { gpReservoirBody, gpReservoirCap } from '../src/rendering/gp-brake-reservoir.ts';
import { studioHookKeys } from '../src/rendering/studio/shader-hooks.ts';
import { SSR_MASK_HOOK, ssrMaskUniforms } from '../src/rendering/ultra/ssr-mask.ts';
import { gpLiveryMaterial, gpWingPaint } from '../src/rendering/gp-race-bodywork.ts';

beforeAll(() => {
  const ctx = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
});
afterAll(() => vi.unstubAllGlobals());

const release = (group: T.Object3D) =>
  group.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });

describe('GP refined surface and mechanical contracts', () => {
  it('calibrates shared GP LOD materials once without compounding their colour', () => {
    const m = new BikeMaterials(0);
    try {
      expect(calibrateGpMaterials(m, 'gpr1')).toBe(true);
      const colour = m.paint.color.clone();
      for (let i = 0; i < 12; i++) calibrateGpMaterials(m, 'gpr1');
      expect(m.paint.color.equals(colour)).toBe(true);
      // Smoked Fresnel glass: no transmission render pass.
      expect(m.screen.transmission).toBe(0);
      // Clear sightline, printed rim and base border (REF 017/088).
      expect(m.screen.opacity).toBe(1);
      expect(m.screen.alphaMap?.colorSpace).toBe(T.NoColorSpace);
      expect(gpScreenAlpha(0.5, 0.5)).toBe(GP_SCREEN_ALPHA.clear);
      expect(gpScreenAlpha(0.5, 0)).toBe(GP_SCREEN_ALPHA.rim);
      expect(gpScreenAlpha(0, 0.5)).toBe(GP_SCREEN_ALPHA.base);
      expect(GP_SCREEN_ALPHA.clear).toBeLessThan(0.1);
      // Fork: graphite outer tubes, gold stanchions; smoked fluid pot.
      expect(m.forkUpper.color.getHex()).toBe(0x232427);
      expect(m.reservoir.color.getHex()).toBe(0x4a3a24);
      expect(m.screen.transparent).toBe(true);
      expect(m.screen.depthWrite).toBe(false);
      expect(m.paint.metalness).toBe(0);
      expect(m.paint.roughness).toBe(0.3);
      // The tail rain light is a diode array: only the LEDs are emissive.
      const led = m.lamp.emissiveMap!.image as { data: Uint8Array; width: number };
      const values = Array.from({ length: led.width * 32 }, (_, i) => led.data[i * 4]);
      expect(Math.max(...values)).toBe(255);
      expect(Math.min(...values)).toBe(Math.round(255 * GP_TAIL_LED.floor));
      expect(m.paint.clearcoatRoughness).toBe(0.04);
    } finally {
      m.dispose();
    }
  });
  it.each([false, true])('registers one emitting texel region to each rain lens (R2=%s)', (r2) => {
    const materials = new BikeMaterials(0);
    calibrateGpMaterials(materials, r2 ? 'gpr2' : 'gpr1');
    const geometry = gpRainLenses(r2, 'high'),
      mesh = new T.Mesh(geometry, materials.lamp);
    try {
      const position = geometry.getAttribute('position'),
        normals = geometry.getAttribute('normal'),
        uv = geometry.getAttribute('uv'),
        map = materials.lamp.emissiveMap!.image as {
          data: Uint8Array;
          width: number;
          height: number;
        };
      const count = r2 ? 6 : 7,
        stride = position.count / count;
      const seen = new Set<number>();
      for (let i = 0; i < count; i++) {
        const cap = (i + 1) * stride - 1,
          u = uv.getX(cap),
          v = uv.getY(cap);
        expect(normals.getZ(cap)).toBeLessThan(-0.99);
        expect(u * GP_TAIL_LED.columns).toBeCloseTo(i + 0.5);
        seen.add(Math.floor(u * GP_TAIL_LED.columns));
        const px = Math.floor(u * map.width),
          py = Math.floor(v * map.height);
        expect(map.data[4 * (px + py * map.width)]).toBe(255);
        for (let vertex = i * stride; vertex <= cap; vertex++) {
          expect(Math.floor(uv.getX(vertex) * GP_TAIL_LED.columns)).toBe(i);
          expect(Math.floor(uv.getY(vertex) * GP_TAIL_LED.rows)).toBe(0);
        }
        const at = new T.Vector3(position.getX(cap), position.getY(cap), -0.05),
          ray = new T.Raycaster(at, new T.Vector3(0, 0, 1));
        expect(ray.intersectObject(mesh).length).toBeGreaterThan(0);
        if (i + 1 < count) {
          const next = cap + stride;
          ray.ray.origin.x = (at.x + position.getX(next)) / 2;
          expect(ray.intersectObject(mesh)).toHaveLength(0);
        }
      }
      expect(seen.size).toBe(count);
    } finally {
      geometry.dispose();
      materials.dispose();
    }
  });
  it.each(['high', 'mid'] as const)(
    '%s reservoir retains a fluid line and a sixteen-flute cap',
    (detail) => {
      const base = new T.Color(0x4a3a24),
        body = gpReservoirBody(detail, base),
        cap = gpReservoirCap(detail);
      try {
        const pos = body.getAttribute('position'),
          col = body.getAttribute('color');
        const bands = new Map<number, T.Color>();
        for (let i = 0; i < pos.count; i++)
          bands.set(
            Math.round(pos.getY(i) * 10000),
            new T.Color(col.getX(i), col.getY(i), col.getZ(i)).multiply(base),
          );
        expect(bands.get(50)!.getHex()).toBe(0x4e351f);
        expect(bands.get(59)!.getHex()).toBe(0x95815c);
        const wall = cap.getAttribute('position'),
          middle: number[] = [];
        for (let i = 0; i < wall.count; i++) {
          if (Math.abs(wall.getY(i) + 0.0035) < 1e-6)
            middle.push(Math.hypot(wall.getX(i), wall.getZ(i)));
        }
        middle.pop(); // Duplicated vertex on the closed UV seam.
        expect(
          middle.filter(
            (r, i) =>
              r > middle[(i + 1) % middle.length] &&
              r > middle[(i + middle.length - 1) % middle.length],
          ),
        ).toHaveLength(16);
        expect(Math.min(...middle)).toBeGreaterThan(0.021);
        expect(Math.max(...middle)).toBeCloseTo(0.0241, 4);
        expect(wall.getY(wall.count - 1)).toBeLessThan(0.0045);
      } finally {
        body.dispose();
        cap.dispose();
      }
    },
  );
  it.each(['mx250', 'mx450', 'sbk1000', 'road600'])(
    'leaves the %s material values untouched',
    (id) => {
      const m = new BikeMaterials(0);
      try {
        const original = [
          m.paint.color.getHex(),
          m.paint.roughness,
          m.paint.clearcoat,
          m.screen.transmission,
          m.screen.opacity,
        ];
        expect(calibrateGpMaterials(m, id)).toBe(false);
        expect([
          m.paint.color.getHex(),
          m.paint.roughness,
          m.paint.clearcoat,
          m.screen.transmission,
          m.screen.opacity,
        ]).toEqual(original);
        expect(m.titanium.userData.gpBareTitanium).toBeUndefined();
      } finally {
        m.dispose();
      }
    },
  );
  it('fills only the missing GP titanium colour attribute and preserves heat-painted headers', () => {
    const g = new T.CylinderGeometry(0.05, 0.05, 0.3, 12);
    const m = new T.MeshStandardMaterial({ vertexColors: true });
    try {
      bindGpBareMetal(g, m);
      expect(g.hasAttribute('color')).toBe(false);
      m.userData.gpBareTitanium = true;
      bindGpBareMetal(g, m);
      const c = g.getAttribute('color');
      expect(Array.from(c.array).every((value) => value === 1)).toBe(true);
      c.setXYZ(0, 0.2, 0.4, 0.7);
      bindGpBareMetal(g, m);
      expect(g.getAttribute('color')).toBe(c);
      expect(c.getX(0)).toBeCloseTo(0.2);
    } finally {
      g.dispose();
      m.dispose();
    }
  });
  it.each(['high', 'mid', 'far'] as const)(
    '%s fender is a closed thin shell with outward outer normals',
    (detail) => {
      const radius = 0.31,
        g = gpFrontFender(radius, detail);
      try {
        const p = g.getAttribute('position'),
          idx = g.index!;
        const edges = new Map<string, { count: number; direction: number }>();
        const a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3();
        for (let i = 0; i < idx.count; i += 3) {
          const ids = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
          a.fromBufferAttribute(p, ids[0]);
          b.fromBufferAttribute(p, ids[1]);
          c.fromBufferAttribute(p, ids[2]);
          expect(
            new T.Vector3().subVectors(b, a).cross(new T.Vector3().subVectors(c, a)).lengthSq(),
          ).toBeGreaterThan(1e-17);
          for (let e = 0; e < 3; e++) {
            const u = ids[e],
              v = ids[(e + 1) % 3],
              key = [Math.min(u, v), Math.max(u, v)].join(':');
            const value = edges.get(key) ?? { count: 0, direction: 0 };
            value.count++;
            value.direction += u < v ? 1 : -1;
            edges.set(key, value);
          }
        }
        for (const edge of edges.values()) expect(edge).toEqual({ count: 2, direction: 0 });
        a.fromBufferAttribute(p, idx.getX(0));
        b.fromBufferAttribute(p, idx.getX(1));
        c.fromBufferAttribute(p, idx.getX(2));
        const normal = b.sub(a).cross(c.sub(a)).normalize();
        expect(normal.dot(new T.Vector3(0, a.y, a.z).normalize())).toBeGreaterThan(0.1);
        expect(idx.count / 3).toBeLessThan(900);
        expect(Array.from(g.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
      } finally {
        g.dispose();
      }
    },
  );
  it('rejects malformed fender radii', () => {
    for (const r of [NaN, Infinity, 0, -1, 0.7]) expect(() => gpFrontFender(r, 'high')).toThrow();
  });
  it('keeps the silencer bore behind its outlet and reuses owned entrant materials', () => {
    const m = new BikeMaterials(0);
    calibrateGpMaterials(m, 'gpr1');
    const root = gpSilencer('high', m);
    try {
      expect(root.children).toHaveLength(4);
      const baffle = root.getObjectByName('Recessed exhaust baffle')!;
      expect(baffle.position.y).toBeGreaterThan(-0.153);
      const shell = root.getObjectByName('Rolled titanium shell and open outlet') as T.Mesh;
      expect(shell.material).toBe(m.titanium);
      expect(shell.geometry.hasAttribute('color')).toBe(true);
    } finally {
      release(root);
      m.dispose();
    }
  });
  it.each(['gpr1', 'gpr2'])(
    '%s integrates the fender and silencer without exceeding the original complete-model gate',
    (id) => {
      const m = new BikeMaterials(0),
        model = new BikeModel(VEHICLES[id], 0, 'high', m, true);
      try {
        // Static batching legitimately removes individual mesh names. Locate
        // the separate returned-edge carbon material and its actual geometry.
        const fenders: T.Mesh[] = [];
        model.root.traverse((o) => {
          if (
            o instanceof T.Mesh &&
            o.material instanceof T.Material &&
            o.material !== m.carbon &&
            o.material.name === m.carbon.name &&
            o.material.side === T.DoubleSide &&
            o.geometry.getAttribute('position').count === 406
          )
            fenders.push(o);
        });
        expect(fenders).toHaveLength(1);
        if (id === 'gpr1')
          expect(model.root.getObjectByName('GP formed titanium silencer')).toBeDefined();
        else expect(model.root.getObjectByName('GP formed titanium silencer')).toBeUndefined();
        let triangles = 0;
        model.root.traverse((o) => {
          if (o instanceof T.Mesh)
            triangles +=
              ((o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3) *
              (o instanceof T.InstancedMesh ? o.count : 1);
        });
        expect(triangles).toBeLessThan(110000);
      } finally {
        model.dispose();
        m.dispose();
      }
    },
  );
  it('bands GP headers through the titanium temper sequence; classic stays unchanged', () => {
    const pipe: [number, number, number][] = [
      [0, 0, 0],
      [0, -0.3, 0.1],
      [0, -0.4, -0.3],
      [0, -0.2, -0.7],
    ];
    const classic = exhaustGeometry(pipe, 0.03, 40, 10);
    const oxide = exhaustGeometry(pipe, 0.03, 40, 10, 'gp-oxide');
    try {
      const first = new T.Color().fromBufferAttribute(
        classic.getAttribute('color') as T.BufferAttribute,
        0,
      );
      expect(first.getHex()).toBe(0x3c4a8a);
      const c = oxide.getAttribute('color') as T.BufferAttribute;
      expect(c.count).toBe(classic.getAttribute('color').count);
      const ring = (row: number) => new T.Color().fromBufferAttribute(c, row * 11);
      // Port: burned grey-blue exactly; a deep-blue band, then a gold band,
      // then bare metal at the tail.
      expect(ring(0).getHex()).toBe(GP_TITANIUM_OXIDE[0][1]);
      const rows = Array.from({ length: 41 }, (_, i) => ring(i));
      expect(rows.some((k) => k.b > k.r * 1.8)).toBe(true);
      expect(rows.some((k) => k.r > k.b * 1.8 && k.g > k.b * 1.3)).toBe(true);
      expect(ring(40).getHex()).toBe(0xc8c6c2);
      for (const value of c.array) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of c.array) expect(value).toBeLessThanOrEqual(1);
      // Band boundaries undulate around the tube rather than forming rings.
      const row = 9,
        around = Array.from({ length: 11 }, (_, j) =>
          new T.Color().fromBufferAttribute(c, row * 11 + j).getHex(),
        );
      expect(new Set(around).size).toBeGreaterThan(1);
    } finally {
      classic.dispose();
      oxide.dispose();
    }
  });
  it('heat-soaks the silencer inlet and outlet lip but leaves its body bare', () => {
    const g = gpSilencerHeatSoak(
      new T.LatheGeometry(
        [
          [0.03, -0.153],
          [0.037, -0.157],
          [0.056, 0],
          [0.034, 0.15],
        ].map(([r, y]) => new T.Vector2(r, y)),
        12,
      ),
    );
    try {
      const p = g.getAttribute('position'),
        c = g.getAttribute('color') as T.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const k = new T.Color().fromBufferAttribute(c, i);
        if (Math.abs(p.getY(i)) < 0.01) expect(k.getHex()).toBe(0xffffff);
        else expect(k.r).toBeGreaterThan(k.b);
      }
      // Authored colour survives the bare-metal binder.
      const m = new T.MeshStandardMaterial();
      m.userData.gpBareTitanium = true;
      bindGpBareMetal(g, m);
      expect(g.getAttribute('color')).toBe(c);
      m.dispose();
    } finally {
      g.dispose();
    }
  });
  it('glosses only the GP titanium oxide film, once, through the house hook chain', () => {
    const m = new BikeMaterials(0);
    try {
      expect(studioHookKeys(m.titanium)).not.toContain('gp-titanium-oxide-v1');
      calibrateGpMaterials(m, 'gpr1');
      expect(studioHookKeys(m.titanium)).toContain('gp-titanium-oxide-v1');
      expect(installGpTitaniumOxideGloss(m.titanium)).toBe(false);
      const shader = {
        vertexShader: '#include <begin_vertex>',
        fragmentShader: '#include <roughnessmap_fragment>\n',
        uniforms: {},
      } as unknown as T.WebGLProgramParametersWithUniforms;
      m.titanium.onBeforeCompile(shader, {} as T.WebGLRenderer);
      expect(shader.fragmentShader).toContain('gpTiFilm');
      expect(shader.fragmentShader.indexOf('gpTiFilm')).toBeGreaterThan(
        shader.fragmentShader.indexOf('#include <roughnessmap_fragment>'),
      );
      const road = new BikeMaterials(1);
      calibrateGpMaterials(road, 'sbk1000');
      expect(studioHookKeys(road.titanium)).not.toContain('gp-titanium-oxide-v1');
      road.dispose();
    } finally {
      m.dispose();
    }
  });

  it('stretches GP brushed and turned metal highlights across the tool marks on High/ULTRA only', () => {
    const m = new BikeMaterials(0);
    try {
      // Physical materials so three.js can compile the anisotropic lobe.
      for (const metal of [m.aluminium, m.forkUpper, m.forkLower])
        expect(metal).toBeInstanceOf(T.MeshPhysicalMaterial);
      setGpMetalAnisotropy(m, true);
      expect(m.aluminium.anisotropy).toBe(0);
      calibrateGpMaterials(m, 'gpr1');
      expect(m.aluminium.anisotropy).toBe(0);
      setGpMetalAnisotropy(m, true);
      expect(m.aluminium.anisotropy).toBe(GP_METAL_ANISOTROPY.brushed);
      expect(m.forkUpper.anisotropy).toBe(GP_METAL_ANISOTROPY.turned);
      expect(m.forkLower.anisotropy).toBe(GP_METAL_ANISOTROPY.polished);
      // Marks run along U; the highlight stretches along V.
      for (const metal of [m.aluminium, m.forkUpper, m.forkLower])
        expect(metal.anisotropyRotation).toBeCloseTo(Math.PI / 2, 6);
      setGpMetalAnisotropy(m, false);
      expect([m.aluminium, m.forkUpper, m.forkLower].map((x) => x.anisotropy)).toEqual([0, 0, 0]);
      // Road and motocross families keep isotropic metal.
      const road = new BikeMaterials(1);
      calibrateGpMaterials(road, 'sbk1000');
      setGpMetalAnisotropy(road, true);
      expect(road.aluminium.anisotropy).toBe(0);
      road.dispose();
    } finally {
      m.dispose();
    }
  });

  it('opts the GP lacquer and carbon into the ULTRA reflection mask, and leaves other families alone', () => {
    const m = new BikeMaterials(0);
    const road = new BikeMaterials(1);
    try {
      for (const lacquer of [m.paint, m.carbon])
        expect(studioHookKeys(lacquer)).not.toContain(SSR_MASK_HOOK);
      calibrateGpMaterials(m, 'gpr1');
      for (const lacquer of [m.paint, m.secondary, m.accent, m.carbon])
        expect(studioHookKeys(lacquer)).toContain(SSR_MASK_HOOK);
      expect(studioHookKeys(gpLiveryMaterial(m, 0, 'gpr1'))).toContain(SSR_MASK_HOOK);
      expect(studioHookKeys(gpWingPaint(m, 0))).toContain(SSR_MASK_HOOK);
      calibrateGpMaterials(road, 'sbk1000');
      expect(studioHookKeys(road.paint)).not.toContain(SSR_MASK_HOOK);
      // The hook only writes the mask while the SSR stage drives its uniform: off by default.
      expect(ssrMaskUniforms.apexSsrEncode.value).toBe(0);
    } finally {
      m.dispose();
      road.dispose();
    }
  });
});
