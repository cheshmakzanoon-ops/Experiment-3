import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { Buildings } from '../src/rendering/open-world/buildings.ts';
import { FacadeAtlas } from '../src/rendering/open-world/facade-atlas.ts';
import { FACADE_RECESS, facadeLayout } from '../src/rendering/open-world/facade-layout.ts';

describe('Festival building distance geometry', () => {
  it('retains room identity and wall coverage, and restores recessed glazing when zoomed in', () => {
    const buildings = new Buildings([
      {
        kind: 'shop',
        x: 0,
        z: 0,
        heading: 0,
        hx: 8,
        hz: 5,
        height: 10.2,
        base: 0,
        floors: 3,
        style: 41711,
      },
    ]);
    const camera = new T.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
    const mesh = buildings.root.children.find((node) =>
      node.name.startsWith('Buildings '),
    ) as T.Mesh;
    const g = mesh.geometry,
      index = g.index!,
      vertices = g.getAttribute('position');
    const normals = g.getAttribute('normal'),
      albedos = g.getAttribute('color');
    expect(normals.array).toBeInstanceOf(Int16Array);
    expect(albedos.array).toBeInstanceOf(Uint16Array);
    for (let i = 0; i < normals.count; i++) {
      expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 4);
    }
    const tags = g.getAttribute('facade');
    const surfaces = () => {
      const panes: number[][] = [],
        base: number[] = [],
        reveals: number[] = [],
        hardware: number[] = [];
      for (let j = g.drawRange.start; j < g.drawRange.start + g.drawRange.count; j += 6) {
        const i = index.getX(j),
          tag = tags.getZ(i);
        if (tag === -4)
          panes.push([
            tags.getX(i),
            tags.getW(i),
            vertices.getX(i),
            vertices.getY(i),
            vertices.getZ(i),
          ]);
        else if (tag === -5) reveals.push(i);
        else if (tag === -6) hardware.push(i);
        else base.push(i);
      }
      return { panes, base, reveals, hardware, count: g.drawRange.count };
    };
    const view = (distance: number, zoom = 1) => {
      camera.position.set(0, 3, distance);
      camera.lookAt(0, 3, 0);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      buildings.update(camera, 'high', 720);
      return surfaces();
    };
    try {
      const near = view(10),
        far = view(400),
        skyline = view(1500);
      const cards = new Map<number, number>();
      for (let j = g.drawRange.start; j < g.drawRange.start + g.drawRange.count; j += 3) {
        const i = index.getX(j),
          tag = tags.getZ(i);
        if (tag <= -8) cards.set(tag, (cards.get(tag) ?? 0) + 1);
      }
      expect(cards.size).toBe(4);
      expect([...cards.values()]).toEqual([2, 2, 2, 2]);
      expect(skyline.count).toBeLessThan(far.count * 0.45);
      expect(skyline.panes).toHaveLength(0);
      expect(near.reveals.length).toBe(near.panes.length * 4);
      expect(far.reveals).toHaveLength(0);
      expect(near.hardware.length).toBeGreaterThan(30);
      expect(far.hardware).toHaveLength(0);
      expect(near.panes.filter((p) => p[1] > 2)).toHaveLength(1);
      expect(far.base).toEqual(near.base);
      expect(far.panes.length).toBeGreaterThan(25);
      expect(far.panes.length).toBe(near.panes.length);
      expect(far.count).toBeLessThan(near.count);
      for (let i = 0; i < near.panes.length; i++) {
        const [room, shop, x, y, z] = near.panes[i],
          projected = far.panes[i];
        expect(projected.slice(0, 2)).toEqual([room, shop]);
        expect(projected[3]).toBe(y);
        expect(Math.hypot(projected[2] - x, projected[4] - z)).toBeCloseTo(FACADE_RECESS, 5);
      }
      expect(view(1500, 4)).toEqual(far);
      expect(view(400, 4)).toEqual(near);
      expect(view(400)).toEqual(far);
      expect(view(10)).toEqual(near);
    } finally {
      buildings.dispose();
    }
  });

  it('addresses the same occupied rooms, shops, and blank wall bays across texture rows', () => {
    const atlas = new FacadeAtlas();
    const fixture = {
      x: 0,
      z: 0,
      heading: 0,
      hx: 14,
      hz: 8,
      base: 0,
      height: 36,
      floors: 10,
      style: 41711,
    };
    const walls = Array.from({ length: 16 }, (_, i) => {
      const layout = facadeLayout({ ...fixture, kind: i % 2 ? 'shop' : 'house' }, 32, i % 4, true)!;
      return { layout, id: atlas.add(layout) };
    });
    const texture = atlas.texture();
    try {
      expect(texture.image.height).toBeGreaterThan(1);
      expect(texture.generateMipmaps).toBe(false);
      let empty = 0,
        shops = 0;
      const data = texture.image.data as Float32Array;
      for (const { layout, id } of walls) {
        const { bayWidth, floorHeight, bays, floors } = layout;
        expect(Array.from(data.slice(id * 4, id * 4 + 4))).toEqual(
          Array.from(new Float32Array([bayWidth, floorHeight, bays, floors])),
        );
        for (let y = 0; y < floors; y++)
          for (let x = 0; x < bays; x++) {
            const at = (id + 1 + y * bays + x) * 4;
            const hole = layout.openings.find(
              (h) => Math.round(h.cell0 / bayWidth) === x && Math.round(h.row0 / floorHeight) === y,
            );
            if (!hole) {
              expect(data[at]).toBe(-1);
              empty++;
              continue;
            }
            const shop = hole.kind === 'shop';
            expect(data[at] - (hole.entrance ? 4 : shop ? 2 : 0)).toBeCloseTo(hole.room, 6);
            expect(data[at + 1]).toBeCloseTo((hole.u1 - hole.u0) / 2, 5);
            expect(data[at + 2]).toBeCloseTo(hole.v0 - hole.row0, 5);
            expect(data[at + 3]).toBeCloseTo(hole.v1 - hole.row0, 5);
            if (shop) shops++;
          }
      }
      expect(empty).toBeGreaterThan(25);
      expect(shops).toBeGreaterThan(25);
    } finally {
      texture.dispose();
    }
  });
});

it('draws the same roof and wall silhouette in a coarse sun map and restores the view range', () => {
  const buildings = new Buildings([
    {
      kind: 'shop',
      x: 0,
      z: 0,
      heading: 0.4,
      hx: 8,
      hz: 5,
      height: 10.2,
      base: 0,
      floors: 3,
      style: 41711,
    },
  ]);
  const mesh = buildings.root.children.find((object) =>
    object.name.startsWith('Buildings '),
  ) as T.Mesh;
  const scene = new T.Scene(),
    view = new T.PerspectiveCamera(),
    sun = new T.OrthographicCamera(-640, 640, 640, -640, 0.1, 3000);
  const renderer = {
    getCurrentViewport: (out: T.Vector4) => out.set(0, 0, 1024, 1024),
  } as T.WebGLRenderer;
  const geometry = mesh.geometry,
    depth = new T.MeshDepthMaterial(),
    initial = { ...geometry.drawRange };
  const shadow = () => mesh.onBeforeShadow(renderer, scene, view, sun, geometry, depth, null!);
  try {
    shadow();
    expect(geometry.drawRange.count).toBeLessThan(initial.count * 0.25);
    mesh.onAfterShadow(renderer, scene, view, sun, geometry, depth, null!);
    expect(geometry.drawRange).toEqual(initial);
    sun.top = 32;
    sun.bottom = -32;
    sun.updateProjectionMatrix();
    shadow();
    expect(geometry.drawRange).toEqual(initial);
    // Recover at the next colour draw if an auxiliary draw was interrupted.
    sun.top = 640;
    sun.bottom = -640;
    sun.updateProjectionMatrix();
    shadow();
    mesh.onBeforeRender(renderer, scene, view, geometry, depth, null!);
    expect(geometry.drawRange).toEqual(initial);
  } finally {
    depth.dispose();
    buildings.dispose();
  }
});
