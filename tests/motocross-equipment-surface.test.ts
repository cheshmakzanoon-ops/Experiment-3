import * as T from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BikeMaterials } from '../src/rendering/bike.ts';
import { DirtBikeModel } from '../src/rendering/offroad/dirt-bike-model.ts';
import {
  addMotocrossHelmet,
  motocrossHelmetShell,
} from '../src/rendering/offroad/motocross-gear.ts';
import {
  motocrossEquipmentGrain,
  motocrossGraphics,
  motocrossRadiatorShroud,
  motocrossTread,
} from '../src/rendering/offroad/motocross-detail.ts';
import { mxKitTexture } from '../src/rendering/offroad/motocross-graphics-kit.ts';
import { mudUniforms } from '../src/rendering/offroad/mud.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

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

describe('motocross equipment surface and ownership', () => {
  it('keeps each immutable print CPU-backed through grid resampling', () => {
    const colours = { primary: 0x353986, secondary: 0x171624, accent: 0xfff4df };
    for (const detail of ['high', 'mid', 'far'] as const) {
      const kit = mxKitTexture(colours, 'mx250', detail);
      const number = motocrossGraphics(colours, 'number', 5, 0.5);
      try {
        expect(kit.userData.cpuReadback).toBe(true);
        expect(number.userData.cpuReadback).toBe(true);
      } finally {
        kit.dispose();
        number.dispose();
      }
    }
  });
  it('keeps private samplers for an eight-rider field over six immutable equipment images', () => {
    const handles = Array.from({ length: 16 }, () =>
      (['weave', 'glove', 'boot'] as const).flatMap(part => {
        const { normalMap, roughnessMap } = motocrossEquipmentGrain(part);
        return [normalMap, roughnessMap];
      }),
    );
    try {
      const sources = new Set(handles.flat().map(map => map.source));
      expect(sources.size).toBe(6);
      expect(new Set(handles.flat()).size).toBe(96);
      const bytes = [...sources].reduce((sum, source) => sum + source.data.data.byteLength, 0);
      expect(bytes).toBe(294912);
      for (let i = 0; i < handles[0].length; i++) {
        const first = handles[0][i], next = handles[1][i];
        expect(first.source).toBe(next.source);
        first.repeat.set(0.5, 0.5);
        expect(next.repeat.x).toBeGreaterThan(1);
      }
    } finally {
      for (const map of handles.flat()) map.dispose();
    }
  });

  it.each(['high', 'mid'] as const)(
    '%s rear helmet exhausts have an open shell, recessed backings and solid adjacent crown',
    (detail) => {
      const head = new T.Group(),
        material = new T.MeshBasicMaterial();
      const shell = new T.Mesh(motocrossHelmetShell(detail), material);
      shell.position.set(0, 0.15, 0.02);
      head.add(shell);
      addMotocrossHelmet(head, detail, material, material, material, material);
      head.updateMatrixWorld(true);
      const cast = (u: number, target: T.Object3D) => {
        const phi = u * Math.PI * 2,
          radial = new T.Vector3(-Math.cos(phi), 0, Math.sin(phi));
        const origin = radial
          .clone()
          .multiplyScalar(0.45)
          .add(new T.Vector3(0, 0.23, 0.02));
        return new T.Raycaster(origin, radial.negate(), 0, 0.41).intersectObject(target, false);
      };
      try {
        const ducts = head.children.filter(
          (o) => o.name === 'Motocross recessed rear helmet exhaust',
        );
        expect(ducts).toHaveLength(2);
        for (const [i, u] of [10.5 / 16, 13.5 / 16].entries()) {
          expect(cast(u, shell)).toHaveLength(0);
          expect(cast(u, ducts[i]).length).toBeGreaterThan(0);
        }
        expect(cast(0.75, shell).length).toBeGreaterThan(0);
      } finally {
        head.traverse((o) => {
          if (o instanceof T.Mesh) o.geometry.dispose();
        });
        material.dispose();
      }
    },
  );
  it('fits the toric lens and folded film tab to the same clutch-side rim', () => {
    const head = new T.Group(),
      material = new T.MeshStandardMaterial();
    try {
      addMotocrossHelmet(head, 'high', material, material, material, material);
      const lens = head.getObjectByName('Motocross curved goggle lens') as T.Mesh;
      const tab = head.getObjectByName('Motocross folded tear-off pull tab') as T.Mesh;
      const p = lens.geometry.getAttribute('position');
      const rim = new T.Vector3().fromBufferAttribute(p, 2 * 25 + 24);
      const top = new T.Vector3().fromBufferAttribute(p, 5 * 25 + 12);
      const centre = new T.Vector3().fromBufferAttribute(p, 2 * 25 + 12);
      expect(centre.z - top.z).toBeGreaterThan(0.007);
      const bounds = new T.Box3().setFromObject(tab),
        size = bounds.getSize(new T.Vector3());
      expect(bounds.distanceToPoint(rim)).toBeLessThan(0.009);
      expect(size.x).toBeLessThan(0.025);
      expect(size.z).toBeGreaterThan(0.025);
      expect(bounds.min.x).toBeGreaterThan(0.1);
      expect(tab.geometry.index!.count / 3).toBe(36);
      // Both sides of the folded sheet have positive area and a finite unit normal.
      const n = tab.geometry.getAttribute('normal');
      for (let i = 0; i < n.count; i++)
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
    } finally {
      head.traverse((o) => {
        if (o instanceof T.Mesh) o.geometry.dispose();
      });
      material.dispose();
    }
  });

  it.each(['high', 'mid', 'far'] as const)(
    '%s helmet has a real open eye port, supported temples and a projected chin',
    (detail) => {
      const geometry = motocrossHelmetShell(detail),
        material = new T.MeshBasicMaterial({ side: T.DoubleSide }),
        shell = new T.Mesh(geometry, material),
        ray = new T.Raycaster();
      const firstSurface = (x: number, y: number) => {
        ray.set(new T.Vector3(x, y, 0.4), new T.Vector3(0, 0, -1));
        return ray.intersectObject(shell)[0]?.point.z;
      };
      try {
        // A ray through the front opening must reach the rear of the shell.
        // Painting a dark rectangle on a closed head cannot satisfy this.
        expect(firstSurface(0, 0.005)).toBeLessThan(-0.13);
        expect(firstSurface(0.13, 0.005)).toBeGreaterThan(0);
        expect(firstSurface(0, -0.089)).toBeGreaterThan(0.21);
        expect(firstSurface(0, 0.094)).toBeGreaterThan(0.12);
        expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBeLessThan(0.28);
        expect(geometry.index!.count / 3).toBeLessThan(4500);
        for (const attribute of Object.values(geometry.attributes))
          expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
        // The longer chin must stay inside the single helmet atlas, rather
        // than stretching its lowest texel over an out-of-range strip.
        const uv = geometry.getAttribute('uv');
        expect(Array.from(uv.array).every((value) => value >= 0 && value <= 1)).toBe(true);
      } finally {
        geometry.dispose();
        material.dispose();
      }
    },
  );

  it('bends shrouds into a crown while keeping physical thickness, mirrored envelopes and UVs', () => {
    const counts: number[] = [];
    for (const detail of ['high', 'mid', 'far'] as const) {
      const left = motocrossRadiatorShroud(-1, detail),
        right = motocrossRadiatorShroud(1, detail);
      try {
        counts.push(right.getAttribute('position').count / 3);
        expect(right.boundingBox!.max.x - right.boundingBox!.min.x).toBeGreaterThan(0.04);
        expect(left.boundingBox!.max.x).toBeCloseTo(-right.boundingBox!.min.x, 6);
        expect(left.boundingBox!.min.x).toBeCloseTo(-right.boundingBox!.max.x, 6);
        for (const geometry of [left, right]) {
          const p = geometry.getAttribute('position'),
            normal = geometry.getAttribute('normal'),
            uv = geometry.getAttribute('uv');
          for (let i = 0; i < p.count; i++) {
            expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
            expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-6);
            expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-6);
            expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-6);
            expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
          }
        }
      } finally {
        left.dispose();
        right.dispose();
      }
    }
    expect(counts[0]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[2]);
  });

  it.each([
    [0.352, 0.042, 44],
    [0.338, 0.06, 44],
    [0.352, 0.042, 24],
    [0.338, 0.06, 24],
    [0.352, 0.042, 20],
    [0.338, 0.06, 20],
  ])('the tread preserves the %f m physical tyre contact envelope', (radius, width, count) => {
    const distant = count === 20;
    const g = motocrossTread(
      radius,
      width,
      distant ? 0.009 : 0.016,
      count,
      width < 0.05 ? 'front' : 'rear',
      distant,
    );
    if (distant) expect(g.index!.count / 3).toBeLessThanOrEqual(600);
    try {
      const p = g.getAttribute('position');
      let outer = 0;
      for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getY(i), p.getZ(i));
        expect(r).toBeLessThanOrEqual(radius + 1e-7);
        expect(Number.isFinite(p.getX(i))).toBe(true);
        outer = Math.max(outer, r);
      }
      expect(outer).toBeGreaterThan(radius - 0.001);
      expect(p.count / 3).toBeLessThan(7000);
    } finally {
      g.dispose();
    }
  });

  it('disposing one MX LOD leaves the shared rubber textures usable by the other LOD', () => {
    const materials = new BikeMaterials(0),
      uniforms = mudUniforms(),
      high = new DirtBikeModel(VEHICLES.mx450, 0, 'high', materials, uniforms),
      mid = new DirtBikeModel(VEHICLES.mx450, 0, 'mid', materials, uniforms);
    let textureDisposals = 0;
    const grain = materials.rubber.normalMap!;
    grain.addEventListener('dispose', () => textureDisposals++);
    const rubber = (model: DirtBikeModel) => {
      const found = new Set<T.MeshStandardMaterial>();
      model.root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        for (const material of Array.isArray(o.material) ? o.material : [o.material])
          if (material.name === 'Motocross moulded knobby rubber') found.add(material);
      });
      return [...found];
    };
    try {
      expect(rubber(high)).toHaveLength(1);
      expect(rubber(mid)).toHaveLength(1);
      expect(rubber(high)[0]).not.toBe(rubber(mid)[0]);
      expect(rubber(high)[0]).not.toBe(materials.rubber);
      expect(rubber(mid)[0].normalMap).toBe(grain);
      high.dispose();
      expect(textureDisposals).toBe(0);
      expect(rubber(mid)[0].normalMap!.image).toBe(grain.image);
      mid.dispose();
      expect(textureDisposals).toBe(0);
    } finally {
      high.dispose();
      mid.dispose();
      materials.dispose();
    }
    expect(textureDisposals).toBe(1);
  });
});
