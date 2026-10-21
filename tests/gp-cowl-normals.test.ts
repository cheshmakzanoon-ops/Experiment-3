import { afterAll, describe, expect, it } from 'vitest';
import * as T from 'three';
import type { BikeMaterials } from '../src/rendering/bike.ts';
import { gpUpperCowl } from '../src/rendering/gp-bodywork.ts';
import source from '../src/rendering/assets/gp-bodywork.mesh.json';

const material = new T.MeshStandardMaterial();
const materials = Object.fromEntries(
  ['paint', 'secondary', 'accent', 'carbon', 'dark', 'seat', 'aluminium'].map((name) => [
    name,
    material,
  ]),
) as unknown as BikeMaterials;
afterAll(() => material.dispose());
const release = (group: T.Group) =>
  group.traverse((o) => {
    if (o instanceof T.Mesh) o.geometry.dispose();
  });

describe('Catalogue instrument cowl', () => {
  it('preserves the independent catalogue cowl at both LODs', () => {
    for (const detail of ['high', 'mid'] as const) {
      const group = gpUpperCowl(materials, detail);
      try {
        const mesh = group.children[0] as T.Mesh;
        expect(mesh.geometry.getAttribute('normal').array).toEqual(
          new Float32Array((detail === 'high' ? source.upperHigh : source.upperMid)[0].normal),
        );
      } finally {
        release(group);
      }
    }
  });
});
