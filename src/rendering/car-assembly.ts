import * as T from 'three';
import { mesh } from './geometry.ts';
import type { HeroPart, HeroShells } from './hero-shells.ts';

export interface AssemblyMaterials {
  paint: T.Material;
  carbon: T.Material;
  metal: T.Material;
  dark: T.Material;
}
/** Static subassemblies are batched only AFTER attachment to their proper
 * damage or carrier group. Never flatten a whole car or its moving pivots. */
export function mountAuthoredWing(
  parent: T.Group,
  hero: HeroShells,
  end: 'front' | 'rear',
  materials: AssemblyMaterials,
) {
  for (const [suffix, material] of [
    ['paint', materials.paint],
    ['carbon', materials.carbon],
    ['alloy', materials.metal],
  ] as const)
    mesh(parent, hero.copy(`${end}_${suffix}`), material).name = `APX ${end} ${suffix}`;
}
/** Positive-X prototypes are reflected with winding correction, not rotated
 * 180 degrees (which would incorrectly turn brake scoops towards the rear). */
export function mountAuthoredWheel(
  carrier: T.Group,
  spin: T.Group,
  hero: HeroShells,
  end: 'front' | 'rear',
  side: -1 | 1,
  materials: AssemblyMaterials,
) {
  for (const [suffix, parent, material] of [
    ['rim', spin, materials.metal],
    ['cover', spin, materials.carbon],
    ['hub', spin, materials.metal],
    ['duct', carrier, materials.carbon],
    ['upright', carrier, materials.metal],
    ['caliper', carrier, materials.dark],
  ] as const) {
    const role: HeroPart = `${end}_${suffix}`;
    mesh(parent, hero.copy(role, side), material).name = `APX ${role} ${side}`;
  }
}
/** Local carrier socket, shared by load/camber/steering and both LOD paths. */
export function uprightSocketX(front: boolean, side: -1 | 1) {
  if (side !== -1 && side !== 1) throw new Error('Invalid upright side');
  return -side * ((front ? 0.155 : 0.19) + 0.028);
}
