/**
 * STEAM DEMO EDITION (release engineering, wave 2; docs/studio/store/LAUNCH_PLAN.md "Demo").
 *
 * One data table says what the demo contains: `DEMO_SLICE`. Every gate in the game asks the
 * policy built from it (`demoPolicy()`), so there is no list of ids anywhere else, and the
 * full game, which has no policy, takes every `... || open` path unchanged.
 *
 * What the flag does and does not do (be honest about it): `__DEMO_BUILD__` (vite.config.ts,
 * `npm run build:demo`) selects the slice; the locked content is still in the bundle and its
 * data is still read, but nothing can START it: menus show it as a FULL GAME plate, the
 * session start refuses it (`src/release/demo-gates.ts`), the career registry is cut to the
 * slice (`liveRegistry`), and the festival ends on a clock. The demo is its own Steam app, so
 * it is not a secrets boundary; it is a content boundary for players.
 *
 * Pure data and predicates: no DOM, no imports from the game, so any module may import it
 * without creating a cycle.
 */

/** Module-level const so the bundler folds the literal (see build-flags.d.ts). */
export const DEMO_BUILD = typeof __DEMO_BUILD__ !== 'undefined' && __DEMO_BUILD__ === true;

export interface DemoSlice {
  /** Edition name written into BUILD_IDENTITY.json and the window title. */
  readonly edition: 'demo';
  /** Circuit and terrain-venue ids a player may enter from the paddock. */
  readonly circuits: readonly string[];
  /** Circuit, GP-bike and dirt machines (MACHINE dial values) a player may enter. */
  readonly machines: readonly string[];
  /** Wildcard Series events (career/wildcard-series.ts ids). An unlocked event loans its own
   * machine and venue for that event only, exactly as the full game does. */
  readonly wildcard: readonly string[];
  /** Licence tests (career/licences.ts ids) the career offers; the rest are FULL GAME. */
  readonly licences: readonly string[];
  /** The open-world coast: how long a visit lasts (active driving seconds) and which
   * machines it lends (the festival offers road cars; the circuit machines are for circuits). */
  readonly festival: { readonly seconds: number; readonly machines: readonly string[] };
}

/**
 * The slice. Chosen from the catalogues for the demo's job (a 30 to 45 minute first look, see
 * LAUNCH_PLAN.md): one of every discipline, the hook (Wildcard) and the weather.
 *
 * - circuits: Aurel (the original compact grand circuit) and Vellamar (the coast circuit) take
 *   cars and GP bikes (both bike-safe); Valley Ridge is the motocross course.
 * - machines: the hero formula car (APX-01) and a second formula (FX-26), the GP-R1 and the
 *   MX-450. Mixed-class grids stay in the full game.
 * - wildcard: five events that show the "only here" hook across the disciplines and the sky
 *   (fog, clear, snow): formula down a fogged mountain pass and on a speedbowl wall, a
 *   motocross bike on the banking, GP bikes in the docklands, trophy trucks on the iced col.
 * - licences: the first one (braking). The rest of the ladder is the full game.
 * - festival: 15 minutes on the Solvane coast in an electric hypercar or a roadster.
 */
export const DEMO_SLICE: DemoSlice = Object.freeze({
  edition: 'demo',
  circuits: Object.freeze(['aurel', 'vellamar', 'valley-ridge-mx']),
  machines: Object.freeze(['apx01', 'fx26', 'gpr1', 'mx450']),
  wildcard: Object.freeze([
    'descent-in-the-cloud',
    'formula-on-the-wall',
    'knobblies-on-the-banking',
    'prototypes-and-the-flyover',
    'desert-trucks-on-the-iced-col',
  ]),
  licences: Object.freeze(['braking']),
  festival: Object.freeze({ seconds: 900, machines: Object.freeze(['eh3', 'rd2']) }),
});

/** What every locked plate says. */
export const FULL_GAME = 'FULL GAME';

/** Where a machine is being chosen: festival machines are road cars lent by the coast. */
export type DemoContext = 'circuit' | 'gp' | 'dirt' | 'festival';

export interface DemoPolicy {
  readonly slice: DemoSlice;
  circuitOpen(id: string): boolean;
  /** `context` omitted: open anywhere in the demo (slice machines or festival loans). */
  machineOpen(id: string, context?: DemoContext): boolean;
  wildcardOpen(id: string): boolean;
  licenceOpen(id: string): boolean;
  readonly festivalSeconds: number;
}

export function createDemoPolicy(slice: DemoSlice = DEMO_SLICE): DemoPolicy {
  const circuits = new Set(slice.circuits);
  const machines = new Set(slice.machines);
  const loans = new Set(slice.festival.machines);
  const wildcard = new Set(slice.wildcard);
  const licences = new Set(slice.licences);
  return Object.freeze({
    slice,
    circuitOpen: (id: string) => circuits.has(id),
    machineOpen: (id: string, context?: DemoContext) =>
      context === 'festival'
        ? loans.has(id)
        : context
          ? machines.has(id)
          : machines.has(id) || loans.has(id),
    wildcardOpen: (id: string) => wildcard.has(id),
    licenceOpen: (id: string) => licences.has(id),
    festivalSeconds: slice.festival.seconds,
  });
}

let active: DemoPolicy | null = DEMO_BUILD ? createDemoPolicy() : null;
/** The demo policy, or null in the full game. */
export const demoPolicy = (): DemoPolicy | null => active;
/** Test seam: install a policy (or null) and get the function that restores the previous one. */
export function useDemoPolicy(policy: DemoPolicy | null): () => void {
  const before = active;
  active = policy;
  return () => {
    active = before;
  };
}

/** The gates, written once so call sites read as one line and the full game is untouched. */
export const circuitOpen = (id: string) => !active || active.circuitOpen(id);
export const machineOpen = (id: string, context?: DemoContext) =>
  !active || active.machineOpen(id, context);
export const wildcardOpen = (id: string) => !active || active.wildcardOpen(id);
export const licenceOpen = (id: string) => !active || active.licenceOpen(id);

/** Menu label for a locked entry: "Riviera Harbour Streets · FULL GAME". */
export const lockedLabel = (label: string) => `${label} · ${FULL_GAME}`;

/**
 * The festival visit clock. Counts only the seconds the player is actually driving (menus and
 * the pause do not spend the visit) and never goes backwards. Pure; the host feeds it.
 */
export interface FestivalClock {
  readonly limit: number;
  readonly elapsed: number;
  readonly remaining: number;
  readonly expired: boolean;
  /** Add `dt` seconds when `driving`; a frame longer than `maxStep` (a hitch, a tab in the
   * background) counts as `maxStep`. Returns true once the visit has run out. */
  tick(dt: number, driving: boolean): boolean;
}
export function festivalClock(limit: number, maxStep = 0.25): FestivalClock {
  let elapsed = 0;
  return {
    limit,
    get elapsed() {
      return elapsed;
    },
    get remaining() {
      return Math.max(0, limit - elapsed);
    },
    get expired() {
      return elapsed >= limit;
    },
    tick(dt, driving) {
      if (driving && Number.isFinite(dt) && dt > 0)
        elapsed = Math.min(limit, elapsed + Math.min(dt, maxStep));
      return elapsed >= limit;
    },
  };
}
/** "12:05" for the HUD chip. */
export function clockText(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
