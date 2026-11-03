import type { VehicleDefinition } from '../simulation/vehicles.ts';

/** Motorcycle body sheets (WP34 presentation, catalogue growth): the visible
 * design of each bike as data, read by the procedural BikeModel. Chassis
 * geometry (wheelbase, CG, wheel radii, crown) comes from the definition;
 * the sheet decides what the solver does not know: fairing type, aero
 * furniture, lamps, exhaust layout, tail, bars, frame, wheels and shocks.
 * GP-R1 and SBK-1000 keep the original design through `DEFAULT_BIKE_SHEET`
 * (wings follow their downforce), so their presentation is unchanged. */
export interface BikeSheet {
  /** Full race fairing, none (naked roadster) or a 1970s round-nosed fairing. */
  fairing: 'full' | 'naked' | 'classic';
  /** Stacked winglets on the fairing flanks, a box (biplane) wing low on the
   * fairing, or none. */
  wings: 'none' | 'stacked' | 'box';
  headlamp: 'none' | 'twin-slit' | 'round';
  /** High titanium silencer, short low can, under-belly box, or three
   * two-stroke expansion chambers. */
  exhaust: 'side-high' | 'stubby' | 'underbelly' | 'expansion';
  tail: 'race' | 'stubby' | 'hump';
  /** Windscreen height scale (0: none). */
  screen: number;
  bars: 'clip-on' | 'upright';
  /** Twin aluminium spars, a steel trellis, or a tubular double cradle. */
  frame: 'spar' | 'trellis' | 'cradle';
  wheels: 'forged' | 'spoked';
  shocks: 'mono' | 'twin';
}
export const DEFAULT_BIKE_SHEET: Readonly<BikeSheet> = Object.freeze({
  fairing: 'full',
  wings: 'none',
  headlamp: 'none',
  exhaust: 'side-high',
  tail: 'race',
  screen: 1,
  bars: 'clip-on',
  frame: 'spar',
  wheels: 'forged',
  shocks: 'mono',
});
const sheet = (patch: Partial<BikeSheet>): BikeSheet =>
  Object.freeze({ ...DEFAULT_BIKE_SHEET, ...patch });
/** Sheets by vehicle id; GP-R1 and SBK-1000 use the default (below). */
export const BIKE_SHEETS: Readonly<Record<string, BikeSheet>> = Object.freeze({
  gpr2: sheet({ wings: 'box', exhaust: 'underbelly', screen: 0.85 }),
  ss600: sheet({ headlamp: 'twin-slit', exhaust: 'stubby', screen: 1.1 }),
  nr900: sheet({
    fairing: 'naked',
    headlamp: 'round',
    exhaust: 'stubby',
    tail: 'stubby',
    screen: 0,
    bars: 'upright',
    frame: 'trellis',
  }),
  cr750: sheet({
    fairing: 'classic',
    exhaust: 'expansion',
    tail: 'hump',
    screen: 0,
    frame: 'cradle',
    wheels: 'spoked',
    shocks: 'twin',
  }),
});
/** Team scheme (car-livery.ts, an index into the team palette) the race shell
 * of a full-fairing road bike wears for the player's entrant, so SS-600 and
 * SBK-1000 are not the GP prototypes' red: blue for the SS-600, white and
 * sky blue for the SBK-1000. Other entrants wear their own team scheme. */
export const SHELL_SCHEME: Readonly<Record<string, number>> = Object.freeze({
  ss600: 5,
  sbk1000: 4,
});
/** The sheet of a motorcycle definition: its own, or the original design
 * (stacked wings when the bike carries downforce). */
export function bikeSheetFor(def: Pick<VehicleDefinition, 'id' | 'bike'>): BikeSheet {
  const own = BIKE_SHEETS[def.id];
  if (own) return own;
  return (def.bike?.downforce ?? 0) > 0 ? sheet({ wings: 'stacked' }) : DEFAULT_BIKE_SHEET;
}
