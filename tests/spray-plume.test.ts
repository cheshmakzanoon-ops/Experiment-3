import { expect, it } from 'vitest';
import { SPRAY_PLUME } from '../src/rendering/effects.ts';

it('throws a taller, longer-lived, wider rooster tail (TECH_WORLD_MAP 9.9)', () => {
  expect(SPRAY_PLUME.vy).toEqual([3.0, 4.5]);
  expect(SPRAY_PLUME.offset).toBe(-2.6);
  expect(SPRAY_PLUME.size).toEqual([0.55, 0.8]);
  expect(SPRAY_PLUME.growth).toBe(2.6);
  expect(SPRAY_PLUME.life).toEqual([1.6, 2.6]);
  expect(SPRAY_PLUME.alpha).toBe(0.5);
});
