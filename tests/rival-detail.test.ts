import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { ReducedCar } from '../src/rendering/lod.ts';
import { HeroShells } from '../src/rendering/hero-shells.ts';
import { addMirrorHousing } from '../src/rendering/cockpit.ts';

afterEach(() => vi.unstubAllGlobals());

it('paints the reduced rival wheels and halo in the team colour, draw-neutral', async () => {
  const hero = await HeroShells.decode(
    new Uint8Array(readFileSync('src/rendering/apx01-shell.glb.gz')),
  );
  try {
    const paint = new T.MeshStandardMaterial({ name: 'paint' }),
      carbon = new T.MeshStandardMaterial({ name: 'carbon' }),
      rubber = new T.MeshStandardMaterial({ name: 'rubber' });
    for (const level of [1, 2] as const) {
      const car = new ReducedCar(level, paint, carbon, rubber, [paint, paint], hero);
      for (const spin of car.spins) {
        const rigid = spin.children.filter(
          (c): c is T.Mesh => c instanceof T.Mesh && c.material !== rubber,
        );
        // One merged rigid wheel mesh, in paint (it was carbon).
        expect(rigid).toHaveLength(1);
        expect(rigid[0].material).toBe(paint);
      }
    }
  } finally {
    hero.dispose();
  }
});

it('gives rival mirrors reflective glass', () => {
  const parent = new T.Group();
  const paint = new T.MeshStandardMaterial(),
    carbon = new T.MeshStandardMaterial();
  addMirrorHousing(parent, paint, carbon, -1);
  let glass: T.Mesh | undefined;
  parent.traverse((o) => {
    if (o instanceof T.Mesh && o.name === 'Right rear-view mirror') glass = o;
  });
  const material = glass!.material as T.MeshStandardMaterial;
  expect(material).toBeInstanceOf(T.MeshStandardMaterial);
  expect(material.metalness).toBe(1);
  expect(material.roughness).toBeLessThan(0.1);
});
