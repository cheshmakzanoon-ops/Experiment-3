import { classInfo } from '../simulation/vehicle-classes.ts';
import { VEHICLES, type VehicleDefinition } from '../simulation/vehicles.ts';
import { peakPowerKw } from './machine-power.ts';

/** One-line character of every machine: what it is good at and what it is like to drive.
 *
 * Written from the numbers in docs/studio/reports/machine-benchmark.json and the handling
 * balance tests of scripts/studio/tools/machine-benchmark.ts (understeer gradient, lift-off and
 * full-throttle rotation, braking, aero grip), then kept free of figures on purpose: the
 * mass, power and drive that go beside each line are derived from the definition at run time
 * (machineFacts), so a recalibration cannot leave a stale number on screen. Each line says
 * what the machine does well and what it punishes, and no two share a sentence.
 * tests/machine-character.test.ts holds the coverage, uniqueness and brand rules. */
export const MACHINE_CHARACTER: Readonly<Record<string, string>> = Object.freeze({
  // Formula
  apx01:
    'The reference formula car: huge downforce and brutal brakes, near neutral on the nose, and it spins if you floor it mid-corner.',
  fx26: 'Electrified top-tier formula: more power and a quarter less downforce than the APX-01, so it launches harder and lifts earlier in fast sweeps.',
  jf2: "Feeder-series single-seater: two-thirds of the top cars' aero grip, firm brakes, and a rear that steps out when you floor it.",
  fr3: 'Third-rung spec formula: honest balance, little speed lost weaving, and tow-heavy pack racing on modest power.',
  fe4: 'First rung of the ladder: light, nearly neutral and planted under power, with a sharp turn-in on a lift and little power to cover mistakes.',
  // Historic
  hf67: 'Sixties cigar-tube: light and quick in a straight line but short of grip on narrow tyres, so it pushes, then spins when you add power.',
  hf76: 'Seventies winged formula: wide slicks and a big wing give real fast-corner grip and drag; a lift swings the tail round quickly.',
  hf86: 'Turbo-era brute: huge power for its weight, and the boost arrives late, so it comes in a rush out of slow corners.',
  vc62: 'Vintage club roadster: slow and soft with a long brake lead, forgiving until the tail swings out under power.',
  // Prototypes and hypercars
  hy9: 'Hybrid endurance prototype: low drag, a front motor that only joins in at speed, strong stable braking, and a rear that steps out on full throttle.',
  hy11: 'Hybrid prototype with more downforce and less top speed than the HY-9, its torque helped by a small crankshaft motor.',
  pr2: 'Closed spec prototype: near neutral and strong in fast corners, short of straight-line speed against the hypercars.',
  pr3: 'Open-cockpit prototype: turbo torque and low-speed downforce, draggy on the straights and laggy at corner exit.',
  sp71: 'Long-tail seventies prototype: very high top speed on little grip, so it pushes in corners and takes a long stop, but stays planted on power.',
  // GT and GT sport
  gt8f: 'Front-mid V8 GT: stable under braking with torque out of slow corners; it pushes on turn-in and spins up on full throttle.',
  gt10m:
    'Mid-engine V10 GT: the most power of the four GTs, neutral-ish balance, and it spins less than the V8 under full throttle.',
  gt6r: 'Rear-engine flat-six GT: the weight over the rear tyres gives traction and braking, staying planted on power while the light nose pushes.',
  gt6s: 'Long front-engine straight-six GT: the stable, understeering heavyweight, with turbo torque that gets it up to speed quickly.',
  gs4: 'Entry GT: easy-to-read turbo six with plenty of torque, the heaviest GT, and it lets go on full throttle at the limit.',
  gs6m: 'Mid-engine entry GT: planted under power and neutral-ish, with about a quarter less torque than the GS-4 and a lighter nose.',
  // Touring, club and vintage road
  tc1: 'Front-drive touring saloon: stable on a lift and under braking, but it pushes wide as soon as you ask for power.',
  tc2: 'Rear-drive touring saloon: rotates well on entry, then goes loose if you are early on the power.',
  tc3: 'All-wheel-drive touring saloon: the best launch of the touring cars and planted on throttle, though it pushes on turn-in.',
  cr1: 'Lightweight club roadster: low inertia and quick to rotate, with a tail that comes round fast on throttle or a lift; short of top speed.',
  hh2: 'Front-drive hot-hatch racer: braking-stable and torquey, but the front tyres are overloaded on power and it pushes wide.',
  rh3: 'Road hot hatch: usable torque and a soft front end that saturates on power out of slow corners.',
  // Rally, rallycross, off-road
  rl2: 'Rally car on gravel tyres: traction on any surface and short gearing, but very understeery and tall on asphalt.',
  rl7: 'Seventies rear-drive rally saloon: light and tail-happy on throttle, very stable on a lift, short of grip and top speed.',
  gb4: 'Group-supercar rally monster: violent acceleration and planted traction everywhere, understeering on asphalt.',
  rcx6: 'Rallycross supercar: brutal sprint acceleration and abrupt power with short gearing; built for loose surface, very understeery on tarmac.',
  rxe: 'Electric rallycross car: instant torque and no gear changes, but heavy and understeery in direction changes.',
  dx8: 'Desert trophy truck: huge power in a heavy, tall body that rolls, brakes long and spins up on throttle; a loose-surface specialist.',
  bg2: 'Desert buggy: lighter than the truck and quick to turn, but the tail swings on a lift and under power, and it brakes long.',
  // Karts
  sk125:
    'Shifter kart: enormous grip for its weight and very short stops for its speed, but a low top speed makes it slow on a big circuit.',
  dk100:
    'Direct-drive sprint kart: momentum and line discipline, slow off the line, with rear-only brakes that make it stop long.',
  // Experimental
  xf2: 'Fan-assisted prototype: grip and braking that do not wait for speed, the highest in the game, until a crest or kerb breaks the seal.',
  xe1: 'Electric time-attack prototype: the quickest launch here and strong downforce in medium and fast corners, drag-capped on the straights.',
  xh3: 'Hydrogen prototype: efficient low drag and four-wheel traction, but a single reduction gives up acceleration at the top.',
  xt1: 'Track-only V12 hypercar: power everywhere, the highest top speed of any car, and a rear that spins up on full throttle.',
  // Road
  eh3: 'Electric road hypercar: instant torque and four-wheel traction launch it hard, but its mass pushes wide in every corner.',
  sc7: 'Mid-engine road supercar: acceleration and top speed first, planted on power, with strong road-tyre braking.',
  rs5: 'Four-door sports sedan: launch, torque and all-weather traction, with a heavy, understeery nose and mass in the braking zones.',
  rm8: 'Front-engine muscle coupe: torque and a long top gear, planted under throttle until the tail snaps at the limit.',
  rg63: 'Sixties grand tourer: a sweet high-revving V12 and a long top speed on narrow tyres, long to stop and rolling in corners.',
  rp6: 'Performance pickup: goes anywhere with torque to spare, but mass and height give it the longest stop of any road machine.',
  rr4: 'Rally-bred road car: traction on any surface, with turbo lag and understeer on power.',
  lx12: 'Luxury grand tourer: effortless torque, top speed and great stability, the most understeery machine here and heavy in every corner.',
  rd2: 'Light road roadster: balanced and easy to slide, a lift rotates it readily, short of power and top speed.',
  // Motorcycles
  gpr1: 'Prototype GP bike: wings, the highest top speed of any bike and the strongest lean grip; braking is stoppie-limited.',
  gpr2: 'Second GP prototype: inline-four with more wing and drag, stops shorter but tops out and launches slower than the GP-R1.',
  sbk1000:
    'Production-based superbike: quick, but a step down from the prototypes in lean, braking and top speed, with kind electronics.',
  ss600:
    'Supersport: light and agile, revs hard to make its speed, with less power to correct a late line.',
  nr900:
    'Naked roadster: upright and draggy on road tyres, quick off the line, out of breath at high speed and long to stop.',
  cr750:
    'Seventies two-stroke racer: narrow tyres, the weakest brakes of any bike and a lean limit you can feel; delicate to ride.',
  mx450:
    'Four-stroke motocross bike: torque everywhere and a tall fifth for the straights; built for jumps, with long stops on asphalt.',
  mx250:
    'Two-stroke motocross bike: light and revvy, quicker off the line than the four-stroke but out of breath at the top end.',
  sm450:
    'Supermoto: the motocross chassis on road wheels, with the best tarmac grip and top speed of the dirt bikes, still long to stop.',
});

/** Mass, power and drive of a machine, taken from its definition. */
export function machineFacts(def: VehicleDefinition) {
  const kw = Math.round(peakPowerKw(def));
  return {
    massKg: Math.round(def.spec.dryMass),
    powerKw: kw,
    kwPerTonne: Math.round((kw / def.spec.dryMass) * 1000),
    drive: def.dynamicsKind === 'bike' ? 'BIKE' : def.drivetrain.toUpperCase(),
    className: classInfo(def.classId).name,
  };
}
/** "1290 kg · 430 kW · RWD" for the line under the MACHINE dial. */
export function machineSpecLine(def: VehicleDefinition): string {
  const f = machineFacts(def);
  return `${f.massKg} kg · ${f.powerKw} kW · ${f.drive}`;
}
/** The line under the MACHINE dial: facts from the definition, then the character. Empty for
 * the mixed-grid choices, which name no single machine. */
export function machineBlurb(id: string): string {
  if (!Object.hasOwn(VEHICLES, id) || !Object.hasOwn(MACHINE_CHARACTER, id)) return '';
  return `${machineSpecLine(VEHICLES[id])} — ${MACHINE_CHARACTER[id]}`;
}
