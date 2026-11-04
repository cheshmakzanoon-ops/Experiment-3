// Frame-by-frame trace of every fall in a seeded bike race (QA Bikes, mixed passing). On a fall it
// prints the last <window> s of the fallen bike and, for the last 12 samples, of the rider it was
// following: lap distance, lateral position against the road, planned lane against the racing line,
// speed, lean against its limit, pedals, the traffic planner's speed cap and the rider's own free
// speed and target, the line's curvature and the distance to the next corner, the gap, lateral
// offset and closing speed to the rider ahead, the planner's decision, blocker and pass target, the
// rule that set the cap and the rider's front/rear tyre use.
//
//   node --no-warnings --experimental-transform-types scripts/studio/tools/bike-fall-trace.ts \
//        <circuit> <seed> [vehicles csv] [laps] [window s] [every s]
import { Bike } from '../../../src/simulation/bike.ts';
import type { BikeVehicle } from '../../../src/simulation/bike-vehicle.ts';
import { circuitDefinition } from '../../../src/simulation/circuits.ts';
import { DEFAULT_OPTIONS } from '../../../src/simulation/config.ts';
import { PHASE } from '../../../src/simulation/race.ts';
import { racingLineFor } from '../../../src/simulation/racing-line.ts';
import type { TrafficPlanner } from '../../../src/simulation/traffic.ts';
import { Simulation } from '../../../src/simulation/world.ts';

const [
  circuit,
  seed,
  vcsv = 'gpr1,sbk1000,gpr1,sbk1000,gpr1,sbk1000',
  laps = '2',
  windowS = '8',
  every = '0.25',
] = process.argv.slice(2);
if (!circuit || !seed) {
  console.error(
    'usage: bike-fall-trace.ts <circuit> <seed> [vehicles] [laps] [window s] [every s]',
  );
  process.exit(2);
}
const field = vcsv.split(',');
const sim = new Simulation(
  {
    ...DEFAULT_OPTIONS,
    mode: 'race',
    circuit: circuit as never,
    laps: Number(laps),
    opponents: field.length - 1,
    seed: Number(seed),
    vehicles: field,
  },
  circuitDefinition(circuit as never),
);
sim.autoPlayer = true;
const line = racingLineFor(sim.track);
const L = sim.track.length;
const DT = 1 / 120;
const stride = Math.max(1, Math.round(Number(every) / DT));
const keep = Math.ceil(Number(windowS) / (stride * DT));
interface Ahead {
  id: number;
  gap: number;
  dlat: number;
  v: number;
}
interface Row {
  t: number;
  s: number;
  lat: number;
  half: number;
  v: number;
  lean: number;
  limit: number;
  brake: number;
  throttle: number;
  steer: number;
  lane: number;
  line: number;
  kappa: number;
  corner: string;
  cap: number;
  free: number;
  target: number;
  decision: string;
  blocker: number;
  passTarget: number;
  rule: string;
  frontUse: number;
  rearUse: number;
  ahead: Ahead | null;
}
const ring: Row[][] = field.map(() => []);
const falls: { idx: number; kind: string; t: number; lean: number }[] = [];
const raise = Bike.prototype.fall;
Bike.prototype.fall = function (this: Bike, kind: 'lowside' | 'highside') {
  if (this.state === 'riding') {
    const idx = (sim.cars as BikeVehicle[]).findIndex((c) => c.dynamics === this);
    falls.push({ idx, kind, t: sim.race.raceTime, lean: this.lean });
  }
  return raise.call(this, kind);
};
// The distance to the next stretch where the racing line's curvature passes a corner's.
const cornerAhead = (s: number) => {
  for (let d = 0; d < 900; d += 8) {
    const k = Math.abs(line.curvatureAt(s + d));
    if (k > 0.0028) return `${d}m k=${k.toFixed(4)}`;
  }
  return '-';
};
interface Driver {
  planner: TrafficPlanner;
  trafficSpeed: number;
  freeSpeed: number;
  decision: string;
}
const sample = (i: number): Row => {
  const c = sim.cars[i] as BikeVehicle,
    ai = sim.ai[i] as unknown as Driver,
    d = c.dynamics;
  let ahead: Ahead | null = null;
  for (const o of sim.cars) {
    if (o === c) continue;
    const gap = ((((o.s - c.s + L / 2) % L) + L) % L) - L / 2;
    if (gap > -10 && gap < 250 && (!ahead || gap < ahead.gap))
      ahead = { id: o.id, gap, dlat: o.lateral - c.lateral, v: o.speed };
  }
  return {
    t: sim.race.raceTime,
    s: c.s,
    lat: c.lateral,
    half: c.trackPosition.width,
    v: c.speed,
    lean: d.lean,
    limit: d.leanLimit,
    brake: c.input.brake,
    throttle: c.input.throttle,
    steer: c.input.steer,
    lane: c.aiOffset ?? 0,
    line: line.offsetAt(c.s),
    kappa: line.curvatureAt(c.s),
    corner: cornerAhead(c.s),
    cap: ai.trafficSpeed,
    free: ai.freeSpeed,
    target: c.aiTarget ?? 0,
    decision: String(ai.decision),
    blocker: ai.planner.blocker,
    passTarget: ai.planner.passTarget,
    rule: ai.planner.limitedBy,
    frontUse: d.frontUse,
    rearUse: d.rearUse,
    ahead,
  };
};
const kph = (v: number) => (v * 3.6).toFixed(0);
const fmt = (r: Row, i: number) =>
  `t=${r.t.toFixed(2)} #${i}${field[i][0]} s=${r.s.toFixed(0)} lat=${r.lat.toFixed(1)}/${r.half.toFixed(0)} lane=${r.lane.toFixed(1)} line=${r.line.toFixed(1)} ` +
  `v=${kph(r.v)} lean=${r.lean.toFixed(2)}/${r.limit.toFixed(2)} steer=${r.steer.toFixed(2)} brake=${r.brake.toFixed(2)} thr=${r.throttle.toFixed(2)} ` +
  `cap=${kph(r.cap)} free=${kph(r.free)} target=${kph(r.target)} k=${r.kappa.toFixed(4)} next=${r.corner} use=${r.frontUse.toFixed(2)}/${r.rearUse.toFixed(2)} | ` +
  (r.ahead
    ? `ahead #${r.ahead.id}${field[r.ahead.id][0]} gap=${r.ahead.gap.toFixed(0)} dlat=${r.ahead.dlat.toFixed(1)} closing=${kph(r.v - r.ahead.v)}kph`
    : 'clear') +
  ` | ${r.decision.slice(0, 22)} blocker=${r.blocker} target=${r.passTarget} rule=${r.rule}`;
for (let n = 0, tick = 0; n < 120 * 600 && sim.race.phase !== PHASE.FINISHED; n++) {
  sim.step(DT);
  if (sim.race.phase !== PHASE.RACING) continue;
  if (++tick % stride === 0)
    for (let i = 0; i < field.length; i++) {
      const r = ring[i];
      r.push(sample(i));
      if (r.length > keep) r.shift();
    }
  while (falls.length) {
    const f = falls.shift()!;
    const r = sample(f.idx);
    console.log(
      `=== FALL ${circuit} seed ${seed}: #${f.idx}${field[f.idx][0]} ${f.kind} at t=${f.t.toFixed(2)} s=${r.s.toFixed(0)} lat=${r.lat.toFixed(1)} v=${kph(r.v)}kph lean=${f.lean.toFixed(2)} track=${L.toFixed(0)} m`,
    );
    for (const row of ring[f.idx]) console.log('  ' + fmt(row, f.idx));
    console.log('  ' + fmt(r, f.idx) + '   <-- FALL');
    const lead = r.ahead?.id;
    if (lead !== undefined)
      for (const row of ring[lead].slice(-12)) console.log('   lead ' + fmt(row, lead));
  }
}
console.log(
  `END ${circuit} ${seed} finished=${sim.race.phase === PHASE.FINISHED} t=${sim.race.raceTime.toFixed(1)}`,
);
