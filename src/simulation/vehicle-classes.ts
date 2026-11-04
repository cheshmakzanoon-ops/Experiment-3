import { N_ } from '../i18n/mark.ts';
import type { VehicleClass, VehicleDefinition } from './vehicles.ts';

/** Racing classes and the catalogue family each belongs to (masterplan §10.1,
 * CONTENT_PIPELINE.md §1.4). A class decides event eligibility (rulesets list
 * classes); a family groups classes for presentation and for the procedural
 * body generator. Unknown classes (added by another vehicle programme) fall
 * back to a generic entry instead of failing. */
export type VehicleFamily =
  | 'formula'
  | 'historic'
  | 'prototype'
  | 'gt'
  | 'touring'
  | 'club'
  | 'rally'
  | 'rallycross'
  | 'offroad'
  | 'kart'
  | 'road'
  | 'motorcycle'
  | 'experimental'
  | 'other';
export interface VehicleClassInfo {
  name: string;
  family: VehicleFamily;
  /** Menu order (lower first). */
  order: number;
  /** Ruleset a single-class race of this class runs under by default. */
  raceRuleset?: string;
}
export const VEHICLE_CLASSES: Readonly<Partial<Record<VehicleClass, VehicleClassInfo>>> =
  Object.freeze({
    formula: { name: N_('Formula'), family: 'formula', order: 0, raceRuleset: 'formula-grand-prix' },
    'formula-junior': {
      name: N_('Junior formula'),
      family: 'formula',
      order: 1,
      raceRuleset: 'junior-formula-sprint',
    },
    historic: {
      name: N_('Historic formula'),
      family: 'historic',
      order: 2,
      raceRuleset: 'historic-formula',
    },
    hypercar: { name: N_('Hypercar'), family: 'prototype', order: 3, raceRuleset: 'prototype-sprint' },
    prototype: {
      name: N_('Prototype'),
      family: 'prototype',
      order: 4,
      raceRuleset: 'prototype-sprint',
    },
    gt: { name: N_('GT'), family: 'gt', order: 5, raceRuleset: 'gt-sprint' },
    'gt-sport': { name: N_('GT Sport'), family: 'gt', order: 6, raceRuleset: 'gt-sprint' },
    touring: { name: N_('Touring'), family: 'touring', order: 7, raceRuleset: 'touring-sprint' },
    club: { name: N_('Club'), family: 'club', order: 8, raceRuleset: 'club-sprint' },
    rally: { name: N_('Rally'), family: 'rally', order: 9, raceRuleset: 'rallycross-heat' },
    rallycross: {
      name: N_('Rallycross'),
      family: 'rallycross',
      order: 10,
      raceRuleset: 'rallycross-heat',
    },
    offroad: { name: N_('Off-road'), family: 'offroad', order: 11, raceRuleset: 'rallycross-heat' },
    kart: { name: N_('Kart'), family: 'kart', order: 12, raceRuleset: 'kart-sprint' },
    road: { name: N_('Road (open-world)'), family: 'road', order: 13 },
    'gp-bike': {
      name: N_('GP motorcycle'),
      family: 'motorcycle',
      order: 14,
      raceRuleset: 'gp-motorcycle',
    },
    superbike: { name: N_('Superbike'), family: 'motorcycle', order: 15, raceRuleset: 'gp-motorcycle' },
    // Catalogue growth: fractional orders slot each new class beside its
    // family without renumbering the classes above.
    'formula-feeder': {
      name: N_('Feeder formula'),
      family: 'formula',
      order: 1.3,
      raceRuleset: 'feeder-formula-sprint',
    },
    'formula-entry': {
      name: N_('Entry formula'),
      family: 'formula',
      order: 1.6,
      raceRuleset: 'feeder-formula-sprint',
    },
    'historic-aero': {
      name: N_('Historic formula · 1970s'),
      family: 'historic',
      order: 2.3,
      raceRuleset: 'heritage-sprint',
    },
    'historic-turbo': {
      name: N_('Historic formula · 1980s turbo'),
      family: 'historic',
      order: 2.6,
      raceRuleset: 'heritage-sprint',
    },
    'historic-prototype': {
      name: N_('Historic sports prototype'),
      family: 'historic',
      order: 4.5,
      raceRuleset: 'heritage-sprint',
    },
    vintage: { name: N_('Vintage club'), family: 'club', order: 8.5, raceRuleset: 'heritage-sprint' },
    'historic-rally': {
      name: N_('Historic rally'),
      family: 'rally',
      order: 9.5,
      raceRuleset: 'historic-rally-heat',
    },
    experimental: {
      name: N_('Experimental'),
      family: 'experimental',
      order: 12.5,
      raceRuleset: 'unlimited-showcase',
    },
    supersport: {
      name: N_('Supersport'),
      family: 'motorcycle',
      order: 15.3,
      raceRuleset: 'motorcycle-class-sprint',
    },
    'classic-bike': {
      name: N_('Classic motorcycle'),
      family: 'motorcycle',
      order: 15.6,
      raceRuleset: 'motorcycle-class-sprint',
    },
    'road-bike': { name: N_('Road motorcycle (open-world)'), family: 'motorcycle', order: 15.8 },
    motocross: {
      name: N_('Motocross'),
      family: 'motorcycle',
      order: 16,
      raceRuleset: 'motocross-moto',
    },
    supermoto: {
      name: N_('Supermoto'),
      family: 'motorcycle',
      order: 17,
      raceRuleset: 'supermoto-moto',
    },
  });
const OTHER: VehicleClassInfo = Object.freeze({ name: N_('Other'), family: 'other', order: 99 });
export function classInfo(classId: string): VehicleClassInfo {
  return (VEHICLE_CLASSES as Record<string, VehicleClassInfo | undefined>)[classId] ?? OTHER;
}
/** Definitions grouped by class in menu order (registry order inside a class). */
export function vehiclesByClass(definitions: readonly VehicleDefinition[]) {
  const groups = new Map<string, VehicleDefinition[]>();
  for (const def of definitions) {
    const list = groups.get(def.classId);
    if (list) list.push(def);
    else groups.set(def.classId, [def]);
  }
  return [...groups.entries()]
    .map(([classId, vehicles]) => ({ classId, info: classInfo(classId), vehicles }))
    .sort((a, b) => a.info.order - b.info.order);
}
