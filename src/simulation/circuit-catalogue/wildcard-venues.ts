import type { CircuitSpec, Segment } from './builder.ts';
import { A, S, bends, compactPit } from './dsl.ts';

/** Original venues for the Wildcard series (career/wildcard-series.ts): places
 * no one would build a race for. */

/** Level Nine: a multi-storey car park raced end to end. The whole lap is
 * roofed (the venue kit's tunnel: concrete walls, a slab ceiling, strip
 * lights, and the plaza block above) and runs between concrete walls 1.4 m
 * off the asphalt. From the ground-floor straight a ramp climbs 8 m to the
 * roof deck, a pillar slalom and a hairpin turn the field round the top, a
 * second slalom leads to the down ramp, and a ground hairpin returns to the
 * line. The ramps climb 8 m in 200 m (4%) and are crested gently enough for a
 * flat-out formula car to stay on the road. Rain never falls here. */
const levelNinePath: Segment[] = [
  // Ground-floor straight, 260 m past the line.
  S(260, { y: 0, tunnel: true, stands: 'left' }),
  // The up ramp.
  S(200, { y: 8, tunnel: true }),
  A(20, 180, { name: 'TOP DECK', y: 8, tunnel: true, w: 5.8 }),
  // Back along the roof: a pillar slalom, then the down ramp.
  S(40, { y: 8, tunnel: true }),
  ...bends(200, 32, 22, 8, 8, ['PILLAR ONE', 'PILLAR TWO', 'PILLAR THREE'], { tunnel: true }),
  S(60, { y: 8, tunnel: true }),
  S(200, { y: 0, tunnel: true }),
  // Ground floor again: a second slalom into the last hairpin.
  ...bends(150, 30, 22, 0, 0, ['PILLAR FOUR', 'PILLAR FIVE', 'PILLAR SIX'], { tunnel: true }),
  A(20, 180, { name: 'GROUND LEVEL', y: 0, tunnel: true, w: 5.8 }),
  // Ground-floor straight before the line (the paddock needs 150 m of it).
  S(190, { y: 0, tunnel: true }),
];
const levelNine: CircuitSpec = {
  id: 'level-nine',
  name: 'LEVEL NINE / MULTI-STOREY',
  short: 'LEVEL NINE',
  group: 'unconventional',
  venue: 'level-nine',
  venueName: 'Level Nine Multi-Storey',
  layout: 'Roof Deck',
  description:
    'A car park raced end to end: roofed ground-floor straights, a ramp to the roof deck, pillar slaloms and two tight hairpins. It never rains inside.',
  theme: 'neon-city',
  signage: 'LEVEL NINE',
  heading: 0,
  winding: 1,
  halfWidth: 5.2,
  elevationSmoothing: 45,
  crossFall: 0.01,
  barrier: { kind: 'concrete', offset: 1.4 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: compactPit(1),
  path: levelNinePath,
};

export const WILDCARD_VENUE_SPECS: readonly CircuitSpec[] = [levelNine];
