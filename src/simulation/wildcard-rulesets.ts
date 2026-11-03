import type { Compound } from './config.ts';
import type { RulesetDefinition } from './events.ts';
import { ALL_CLASSES } from './catalogue-events.ts';
import type { OffroadKind } from './offroad/types.ts';
import type { VehicleClass } from './vehicles.ts';

/** Rulesets of the WILDCARD SERIES (career/wildcard-series.ts): races that put
 * a machine on a venue it was never built for. They exist because the ordinary
 * rulesets encode the opposite rule (a class races where its discipline
 * lives: motorcycles only on bike-safe circuits, off-road machines only on
 * their terrain venues, one class per grid).
 *
 * A wildcard ruleset is deliberately NOT offered by the career's class lookup
 * (`rulesetsFor` ranks it after every ordinary ruleset of the class) and never
 * runs a generated invitational; an event names it explicitly and the
 * `docs/wildcard-races.json` evidence shows that pairing finishing a seeded
 * AI race (npm run test:wildcard). Type-only imports from events.ts keep the
 * module graph acyclic, as in catalogue-events.ts. */
const ALL: readonly Compound[] = Object.freeze(['soft', 'medium', 'hard', 'intermediate', 'wet']);
const BIKE_TYRES: readonly Compound[] = Object.freeze(['soft', 'medium', 'hard', 'wet']);
const POINTS = Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);
/** Motorcycle classes that race on tarmac (the road-racing and dirt families). */
export const WILDCARD_BIKE_CLASSES: readonly VehicleClass[] = Object.freeze([
  'gp-bike',
  'superbike',
  'supersport',
  'motocross',
  'supermoto',
] as const);
/** What a terrain venue admits beyond its own discipline under a wildcard
 * ruleset, by course kind: only pairings with a passing seeded AI race
 * (docs/wildcard-races.json). A class missing here is refused with "cannot
 * race at <venue>" exactly as under an ordinary ruleset. Probed and left out
 * (see docs/studio/reports/content.md): cars on motocross and supercross
 * courses (a GT car and a trophy truck averaged 25-30 km/h, jammed in the
 * berms and took 32-63 incidents in four-car races; a solo GT lap never
 * completed) and a GT car on the forest stage (cars parked 12-21 s). */
export const CROSSOVER_ADMITS: Readonly<Partial<Record<OffroadKind, readonly VehicleClass[]>>> =
  Object.freeze({
    rallycross: Object.freeze(['supermoto', 'gt'] as const),
    'rally-stage': Object.freeze(['supermoto'] as const),
  });
export const WILDCARD_RULESETS: Readonly<Record<string, RulesetDefinition>> = Object.freeze({
  /** A solo timed session for any machine of the series on any venue the
   * crossover table admits (the ordinary time-trial ruleset keeps terrain
   * venues to their own machines). */
  'wildcard-time-attack': Object.freeze({
    version: 1,
    id: 'wildcard-time-attack',
    name: 'WILDCARD · TIME ATTACK',
    sessions: Object.freeze(['time-trial'] as const),
    allowedClasses: Object.freeze([...ALL_CLASSES, ...WILDCARD_BIKE_CLASSES]),
    tires: Object.freeze({ allowed: ALL, mandatoryCompoundChange: false, penaltySeconds: 0 }),
    service: Object.freeze({ pitStops: false }),
    classification: 'laps' as const,
    points: Object.freeze([]),
    drs: false,
    assists: Object.freeze(['sport', 'raw'] as const),
    crossVenue: CROSSOVER_ADMITS,
  }),
  /** Cars of any racing class, on any venue the crossover table admits. */
  'wildcard-machines': Object.freeze({
    version: 1,
    id: 'wildcard-machines',
    name: 'WILDCARD · MISMATCHED MACHINES',
    sessions: Object.freeze(['race'] as const),
    allowedClasses: ALL_CLASSES,
    tires: Object.freeze({ allowed: ALL, mandatoryCompoundChange: false, penaltySeconds: 0 }),
    service: Object.freeze({ pitStops: false }),
    classification: 'laps' as const,
    points: POINTS,
    drs: false,
    assists: Object.freeze(['sport', 'raw'] as const),
    crossVenue: CROSSOVER_ADMITS,
  }),
  /** Road, dirt and supermoto motorcycles on any paved circuit (no bike-safe
   * gate) and, where the crossover table says so, on terrain venues. */
  'wildcard-riders': Object.freeze({
    version: 1,
    id: 'wildcard-riders',
    name: 'WILDCARD · MISMATCHED RIDERS',
    sessions: Object.freeze(['race'] as const),
    allowedClasses: WILDCARD_BIKE_CLASSES,
    tires: Object.freeze({
      allowed: BIKE_TYRES,
      mandatoryCompoundChange: false,
      penaltySeconds: 0,
    }),
    service: Object.freeze({ pitStops: false }),
    classification: 'laps' as const,
    points: Object.freeze([25, 20, 16, 13, 11, 10, 9, 8, 7, 6, 5, 4]),
    drs: false,
    assists: Object.freeze(['sport', 'raw'] as const),
    crossVenue: CROSSOVER_ADMITS,
  }),
});
