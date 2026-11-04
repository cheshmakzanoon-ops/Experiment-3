import type { CircuitSpec, Segment } from './builder.ts';
import { A, S, bends, compactPit, gpPit } from './dsl.ts';

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

/** Haut-Givre: a ski-resort access road. From the hotels of the village base
 * the road climbs 77 m on four stacked hairpins to the lift station (the
 * second leg is a roofed snow gallery), runs the ridge, and comes back down
 * through larch bends, a second gallery and two more hairpins. It is dressed
 * for snow: the galleries keep the road dry of falling snow, the rock cuttings
 * stand on the mountain side and the village frontage lines the start. */
const hautGivrePath: Segment[] = [
  S(330, { y: 0, drs: true, facades: 'both', stands: 'left' }),
  A(45, 90, { name: 'CHALET BEND', y: 1, facades: 'in', stands: 'out' }),
  S(250, { y: 12, rock: 'left', drop: 'right' }),
  A(18, -180, { name: 'FIRST LACET', y: 14, w: 6.4 }),
  S(150, { y: 21, rock: 'right', drop: 'left' }),
  A(18, 180, { name: 'SECOND LACET', y: 23, w: 6.4 }),
  S(250, { y: 34, tunnel: true }),
  A(18, -180, { name: 'THIRD LACET', y: 36, w: 6.4 }),
  S(150, { y: 43, rock: 'right', drop: 'left' }),
  A(18, 180, { name: 'FOURTH LACET', y: 45, w: 6.4 }),
  S(220, { y: 56, rock: 'left', drop: 'right' }),
  A(80, 90, { name: 'LIFT STATION', y: 59, facades: 'in', stands: 'out' }),
  // The ridge road, west along the top of the climb.
  S(700, { y: 60, drs: true, rock: 'right', drop: 'left' }),
  A(60, 90, { name: 'COL SWEEP', y: 59, rock: 'out' }),
  S(100, { y: 54, rock: 'right', drop: 'left' }),
  ...bends(180, 55, 26, 54, 44, ['LARCH ONE', 'LARCH TWO', 'LARCH THREE'], {
    rock: 'right',
    drop: 'left',
  }),
  S(100, { y: 38, tunnel: true }),
  A(18, 180, { name: 'CHAMOIS HAIRPIN', y: 36, w: 6.4 }),
  S(110, { y: 30, rock: 'left', drop: 'right' }),
  A(18, -180, { name: 'TORRENT HAIRPIN', y: 28, w: 6.4 }),
  S(175, { y: 17, rock: 'right', drop: 'left' }),
  A(40, 90, { name: 'LAST BEND', y: 9, facades: 'in' }),
  S(240, { y: 0, drs: true, facades: 'both' }),
];
const hautGivre: CircuitSpec = {
  id: 'haut-givre',
  name: 'HAUT-GIVRE / SKI RESORT ROAD',
  short: 'HAUT-GIVRE',
  group: 'unconventional',
  venue: 'haut-givre',
  venueName: 'Haut-Givre Ski Resort',
  layout: 'Resort Road',
  description:
    'A ski-resort road: hotels at the base, four hairpins and a snow gallery up to the lift station, a ridge run and the way down. Built for snow.',
  theme: 'alpine',
  signage: 'HAUT-GIVRE',
  suggested: { lighting: 'day', weather: 'snow' },
  heading: 0,
  winding: 1,
  halfWidth: 5.4,
  elevationSmoothing: 40,
  crossFall: 0.02,
  barrier: { kind: 'armco', offset: 2.6 },
  runoff: { straight: 'grass', outside: 'grass', inside: 'grass' },
  pit: compactPit(1),
  path: hautGivrePath,
};

/** Marram Field: an airport raced where the aircraft move. The start is on
 * the runway (1.6 km, flat out), a blast-pad turn leads onto the parallel
 * taxiway with two chicanes between the hangars, and a tight apron slalom
 * past the terminal gates feeds the runway again. Concrete everywhere, the
 * apron floodlight masts along the lap, nothing taller than the terminal. */
const marramPath: Segment[] = [
  S(1300, { y: 0, w: 14, drs: true, stands: 'left' }),
  A(55, 90, { name: 'EXIT BRAVO', w: 9 }),
  S(70, { w: 7 }),
  A(55, 90, { name: 'HOLDING POINT', w: 7 }),
  S(500, { w: 6.5, facades: 'right' }),
  A(60, -40, { name: 'ALPHA', w: 6.5, facades: 'right' }),
  S(30, { w: 6.5, facades: 'right' }),
  A(60, 40, { w: 6.5, facades: 'right' }),
  S(520, { w: 6.5, facades: 'right' }),
  A(60, 40, { name: 'JULIET', w: 6.5 }),
  S(30, { w: 6.5 }),
  A(60, -40, { w: 6.5 }),
  S(380, { w: 6.5, drs: true }),
  A(32, 90, {
    name: 'GATE ONE',
    w: 6,
    facades: 'in',
    barrier: { side: 'out', offset: 6, kind: 'tyre' },
  }),
  ...bends(116, 30, 30, 0, 0, ['STAND TWELVE', 'STAND FOURTEEN', 'STAND SIXTEEN'], {
    w: 6,
    facades: 'both',
  }),
  A(32, 90, { name: 'APRON', w: 7, barrier: { side: 'out', offset: 6, kind: 'tyre' } }),
  S(300, { w: 14, drs: true }),
];
const marramField: CircuitSpec = {
  id: 'marram-field',
  name: 'MARRAM FIELD / APRON AND RUNWAY',
  short: 'MARRAM FIELD',
  group: 'unconventional',
  venue: 'marram-field',
  venueName: 'Marram Field Airport',
  layout: 'Apron and Runway',
  description:
    'An airport raced where the aircraft move: a 1.6 km runway, a blast-pad turn, taxiway chicanes between the hangars and a tight apron slalom.',
  theme: 'airport',
  signage: 'MARRAM FIELD',
  suggested: { lighting: 'sunset', weather: 'fog' },
  heading: 0,
  winding: 1,
  halfWidth: 7,
  elevationSmoothing: 60,
  crossFall: 0.01,
  barrier: { kind: 'armco', offset: 14 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: gpPit(1, { offset: 26, boxLateral: 28.1 }),
  path: marramPath,
};

/** Kalder Dam: a concrete dam crest across a drowned valley. The crest road
 * runs 1.1 km between parapets with the reservoir on one hand and the
 * tailwater on the other, turns through the powerhouse at the east abutment
 * (a roofed spillway gallery), and returns along the north shore. Water
 * either side of the crest, concrete walls 12 m to 20 m down to it, and a
 * gale off the lake in a storm (the events take it in
 * one; in clear weather the water shows, in a storm it does not read). */
const kalderPath: Segment[] = [
  // The powerhouse yard on the east abutment: land, the paddock and the line.
  S(320, { y: 0, w: 6.2, drs: true, facades: 'right', stands: 'left' }),
  A(60, 90, { name: 'INTAKE TOWER', y: -2, rock: 'out' }),
  // The north shore road: the reservoir on the left, a cutting on the right.
  S(160, { y: -3, drop: 'left', rock: 'right' }),
  S(120, { y: -3, tunnel: true }),
  ...bends(560, 90, 18, -3, -3, ['SPILLWAY BEND', 'WEIR BEND', 'TURBINE BEND'], {
    drop: 'left',
    rock: 'right',
  }),
  S(150, { y: -2, drop: 'left', rock: 'right' }),
  A(60, 90, { name: 'WEST ABUTMENT', y: 0, rock: 'out' }),
  S(60, { y: 0, rock: 'right' }),
  ...bends(340, 70, 22, 0, 0, ['SWITCH YARD', 'TRANSFORMER', 'SURGE SHAFT'], { rock: 'right' }),
  S(60, { y: 0, rock: 'right' }),
  A(60, 90, { name: 'CREST CORNER', y: 0 }),
  // The crest: reservoir to the left, tailwater to the right, concrete both sides.
  S(1000, { y: 0, w: 6.2, drs: true, drop: 'both' }),
  A(60, 90, { name: 'POWERHOUSE', y: 0, facades: 'out' }),
  S(200, { y: 0, w: 6.2, drs: true, facades: 'right' }),
];
const kalderDam: CircuitSpec = {
  id: 'kalder-dam',
  name: 'KALDER DAM / CREST ROAD',
  short: 'KALDER DAM',
  group: 'unconventional',
  venue: 'kalder-dam',
  venueName: 'Kalder Dam',
  layout: 'Crest Road',
  description:
    'A hydro dam raced along its crest: 1.1 km of concrete between reservoir and tailwater, a powerhouse turn, a spillway gallery and the shore road home.',
  theme: 'dam',
  signage: 'KALDER DAM',
  suggested: { lighting: 'day', weather: 'clear' },
  seaLevel: -20,
  heading: 90,
  winding: 1,
  halfWidth: 6,
  elevationSmoothing: 50,
  crossFall: 0.012,
  barrier: { kind: 'concrete', offset: 1.4 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: compactPit(1),
  path: kalderPath,
};

/** Saffron Lane: a night market. Eight-metre lanes between stalls and
 * frontage, three covered halls, a dye-works hairpin and a spice-market
 * slalom, all under lamps. */
const saffronPath: Segment[] = [
  // Gate Street: the start straight, stalls both sides.
  S(300, { y: 0, facades: 'both', stands: 'left' }),
  A(26, 180, { name: 'SPICE HAIRPIN', facades: 'out' }),
  // The covered cloth hall, back west.
  S(300, { tunnel: true }),
  A(26, -180, { name: 'DYE WORKS', facades: 'out' }),
  S(300, { facades: 'both' }),
  A(26, 180, { name: 'BRASS HAIRPIN', facades: 'out' }),
  // The long lane home: a slalom between the spice rows, then a covered arcade.
  S(60, { facades: 'both' }),
  ...bends(300, 38, 24, 0, 0, ['BRASS ROW', 'TEA ROW', 'FRUIT ROW'], { facades: 'both' }),
  S(140, { tunnel: true }),
  A(16, 90, { name: 'WEIGHBRIDGE', facades: 'both' }),
  S(110, { facades: 'both' }),
  A(16, 90, { name: 'GATE OF LAMPS', facades: 'both' }),
  S(200, { facades: 'both' }),
];
const saffronLane: CircuitSpec = {
  id: 'saffron-lane',
  name: 'SAFFRON LANE / NIGHT MARKET',
  short: 'SAFFRON LANE',
  group: 'unconventional',
  venue: 'saffron-lane',
  venueName: 'Saffron Lane Night Market',
  layout: 'Market Loop',
  description:
    'A night market raced end to end: eight-metre lanes between stalls, three covered halls, a dye-works hairpin and a spice-row slalom under lamps.',
  theme: 'market',
  night: true,
  signage: 'SAFFRON LANE',
  suggested: { lighting: 'night', weather: 'clear' },
  heading: 0,
  winding: 1,
  halfWidth: 4.4,
  elevationSmoothing: 30,
  crossFall: 0.01,
  barrier: { kind: 'concrete', offset: 1.2 },
  runoff: { straight: 'asphalt', outside: 'asphalt', inside: 'asphalt' },
  pit: compactPit(1),
  path: saffronPath,
};

export const WILDCARD_VENUE_SPECS: readonly CircuitSpec[] = [
  levelNine,
  hautGivre,
  marramField,
  kalderDam,
  saffronLane,
];
