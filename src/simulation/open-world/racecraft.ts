import { clamp } from '../../core/math.ts';
import { slipstreamOverlap } from '../aero.ts';
import type { RouteGraph } from '../route-graph.ts';
import type { Vehicle } from '../vehicle.ts';
import type { Participant } from './festival-events.ts';

/** Local race feedback; this never changes standings, stars or currency. */
export interface FestivalRacecraftStatus {
  phase: 'following' | 'ready' | 'passing' | 'complete';
  /** Stable entrant id, including after that entrant resets its vehicle. */
  car: number;
  target: string;
  /** Following: continuous tow preparation. Passing: clean lead hold. */
  progress: number;
  /** At most one completed manoeuvre per rival in this race. */
  passes: number;
  /** Increments only when a manoeuvre completes, for one-shot presentation. */
  sequence: number;
}

export const FESTIVAL_RACECRAFT = Object.freeze({
  minimumSpeed: 20,
  minimumTow: 0.06,
  showAfter: 0.25,
  preparation: 1.5,
  passWindow: 10,
  alongsideTime: 0.12,
  leadHold: 0.6,
  feedbackSeconds: 3,
});

/** A tow, a side-by-side pass, then a settled lead. Existing aero supplies
 * the tow; this only recognises actual motion after the contact solver.
 * Eight fixed observation slots and a seven-rival award mask bound memory.
 * A new instance belongs to each race; resets discard only pending work. */
export class FestivalRacecraft {
  private readonly offsets = new Map<string, number>();
  private readonly length: number;
  private readonly previousCars: (Vehicle | null)[] = Array(8).fill(null);
  private readonly positions = new Float64Array(24);
  private readonly previousStation = new Float64Array(8);
  private readonly station = new Float64Array(8);
  private readonly previousSpeed = new Float64Array(8);
  private readonly valid = new Uint8Array(8);
  private target = -1;
  private targetName = '';
  private targetId = -1;
  private phase: FestivalRacecraftStatus['phase'] = 'following';
  private preparation = 0;
  private window = 0;
  private alongside = 0;
  private lead = 0;
  private feedback = 0;
  private awarded = 0;
  private passes = 0;
  private sequence = 0;

  constructor(graph: RouteGraph) {
    let distance = 0;
    // Festival RoutePaths produce an ordered, directed chain of graph legs.
    // Arc station includes each car's grid location and completed laps;
    // distance travelled alone would erase the initial grid separation.
    for (const edge of graph.spec.edges) {
      this.offsets.set(edge.id, distance);
      distance += graph.length(edge.id);
    }
    this.length = distance;
  }

  reset() {
    this.clearPending();
    this.previousCars.fill(null);
    this.valid.fill(0);
  }

  private clearPending() {
    this.target = this.targetId = -1;
    this.targetName = '';
    this.preparation = this.window = this.alongside = this.lead = this.feedback = 0;
    this.phase = 'following';
  }

  private observe(p: Participant, index: number, dt: number, contacts: number) {
    const car = p.car,
      pos = car.body.position,
      speed = car.body.velocity.length(),
      horizontal = Math.hypot(car.forward.x, car.forward.z),
      station =
        (this.offsets.get(p.progress.edge) ?? NaN) + p.progress.s + p.progress.laps * this.length,
      at = index * 3,
      dx = pos.x - this.positions[at],
      dy = pos.y - this.positions[at + 1],
      dz = pos.z - this.positions[at + 2],
      moved = Math.hypot(dx, dy, dz),
      forwardMove = (dx * car.forward.x + dz * car.forward.z) / Math.max(horizontal, 1e-6),
      roadWidth = car.trackPosition.width;
    this.valid[index] =
      car.definition.dynamicsKind === 'four-wheel' &&
      !car.retired &&
      p.finishTime === null &&
      !p.progress.offRoute &&
      !(contacts & (1 << car.id)) &&
      car.impact < 0.02 &&
      car.up.y > 0.8 &&
      (car.tires[0].load > 20 || car.tires[1].load > 20) &&
      (car.tires[2].load > 20 || car.tires[3].load > 20) &&
      car.localVelocity.z >= FESTIVAL_RACECRAFT.minimumSpeed &&
      Math.abs(car.localVelocity.x) < car.localVelocity.z * 0.3 &&
      Math.abs(car.lateral) + car.definition.halfExtents[0] * 0.75 < roadWidth &&
      Number.isFinite(
        pos.x +
          pos.y +
          pos.z +
          speed +
          car.speed +
          car.forward.y +
          horizontal +
          station +
          roadWidth,
      ) &&
      horizontal > 0.8 &&
      this.previousCars[index] === car &&
      // Telemetry speed or spinning wheels at rest cannot fill a tow meter.
      forwardMove > FESTIVAL_RACECRAFT.minimumSpeed * dt * 0.4 &&
      moved <= 0.6 + (speed + this.previousSpeed[index]) * dt &&
      // Legal progress is sampled at 30 Hz in a 120 Hz physics session.
      station >= this.previousStation[index] - 0.5 &&
      station - this.previousStation[index] <= Math.max(5, speed * dt * 4 + 1)
        ? 1
        : 0;
    this.previousCars[index] = car;
    this.positions[at] = pos.x;
    this.positions[at + 1] = pos.y;
    this.positions[at + 2] = pos.z;
    this.previousSpeed[index] = speed;
    this.station[index] = this.previousStation[index] = station;
  }

  private tow(player: Vehicle, other: Vehicle) {
    return (
      slipstreamOverlap(
        player.body.position,
        other.body.position,
        other.forward,
        other.speed,
        player.forward,
      ) * other.physics.aero.towStrength
    );
  }

  /** Call after route progress and both physics/contact substeps. `enabled`
   * excludes countdown, finish, passive zones and every assisted race. */
  update(participants: readonly Participant[], dt: number, enabled: boolean, contacts = 0) {
    if (!enabled || !Number.isFinite(dt) || dt <= 0 || dt > 0.25) {
      this.reset();
      return;
    }
    const count = Math.min(8, participants.length);
    for (let i = 0; i < count; i++) this.observe(participants[i], i, dt, contacts);
    if (!count || !this.valid[0]) {
      this.clearPending();
      return;
    }
    if (this.feedback > 0) {
      this.feedback = Math.max(0, this.feedback - dt);
      if (this.feedback > 0) return;
      this.clearPending();
    }
    const player = participants[0].car,
      forwardLength = Math.hypot(player.forward.x, player.forward.z),
      fx = player.forward.x / forwardLength,
      fz = player.forward.z / forwardLength;
    if (this.target < 0) {
      let strongest: number = FESTIVAL_RACECRAFT.minimumTow;
      for (let i = 1; i < count; i++) {
        const other = participants[i].car;
        if (!this.valid[i] || this.awarded & (1 << other.id)) continue;
        const ahead = this.station[i] - this.station[0],
          lengths = player.definition.halfExtents[2] + other.definition.halfExtents[2];
        if (ahead <= lengths + 4 || ahead > 45) continue;
        const tow = this.tow(player, other);
        if (tow > strongest) {
          this.target = i;
          strongest = tow;
        }
      }
      if (this.target < 0) return;
      this.targetName = participants[this.target].name;
      this.targetId = participants[this.target].car.id;
    }
    const other = participants[this.target]?.car;
    if (!other || !this.valid[this.target] || other.id !== this.targetId) {
      this.clearPending();
      return;
    }
    const dx = other.body.position.x - player.body.position.x,
      dy = other.body.position.y - player.body.position.y,
      dz = other.body.position.z - player.body.position.z,
      ahead = dx * fx + dz * fz,
      side = Math.abs(dx * fz - dz * fx),
      otherHorizontal = Math.hypot(other.forward.x, other.forward.z),
      alignment = (fx * other.forward.x + fz * other.forward.z) / otherHorizontal,
      crossing = Math.sqrt(Math.max(0, 1 - alignment * alignment)),
      length =
        player.definition.halfExtents[2] +
        Math.abs(alignment) * other.definition.halfExtents[2] +
        crossing * other.definition.halfExtents[0],
      clearance =
        side -
        player.definition.halfExtents[0] -
        Math.abs(alignment) * other.definition.halfExtents[0] -
        crossing * other.definition.halfExtents[2],
      vertical = Math.abs(dy - (ahead * other.forward.y) / otherHorizontal),
      legalGap = this.station[this.target] - this.station[0];
    if (
      alignment < 0.93 ||
      vertical > 1.65 ||
      Math.abs(legalGap - ahead) > 12 ||
      ahead > 65 ||
      side > 8 ||
      (Math.abs(ahead) < length + 0.5 && clearance < 0.25)
    ) {
      this.clearPending();
      return;
    }
    if (this.phase === 'following') {
      if (
        ahead <= length + 4 ||
        ahead > 45 ||
        this.tow(player, other) < FESTIVAL_RACECRAFT.minimumTow
      ) {
        this.clearPending();
        return;
      }
      this.preparation = Math.min(FESTIVAL_RACECRAFT.preparation, this.preparation + dt);
      if (this.preparation + 1e-8 >= FESTIVAL_RACECRAFT.preparation) {
        this.phase = 'ready';
        this.window = FESTIVAL_RACECRAFT.passWindow;
      }
      return;
    }
    this.window -= dt;
    if (this.window <= 0) {
      this.clearPending();
      return;
    }
    if (Math.abs(ahead) <= length + 0.5 && clearance >= 0.25 && clearance <= 4) {
      this.phase = 'passing';
      this.alongside += dt;
    }
    const clear =
      this.phase === 'passing' &&
      this.alongside + 1e-8 >= FESTIVAL_RACECRAFT.alongsideTime &&
      ahead < -length - 2.5 &&
      legalGap < -length - 0.5;
    this.lead = clear ? this.lead + dt : 0;
    if (this.lead + 1e-8 >= FESTIVAL_RACECRAFT.leadHold) {
      this.awarded |= 1 << other.id;
      this.passes++;
      this.sequence++;
      this.phase = 'complete';
      this.feedback = FESTIVAL_RACECRAFT.feedbackSeconds;
    }
  }

  status(): FestivalRacecraftStatus | null {
    if (
      this.target < 0 ||
      (this.phase === 'following' && this.preparation + 1e-8 < FESTIVAL_RACECRAFT.showAfter)
    )
      return null;
    return {
      phase: this.phase,
      car: this.targetId,
      target: this.targetName,
      progress:
        this.phase === 'following'
          ? clamp(this.preparation / FESTIVAL_RACECRAFT.preparation, 0, 1)
          : this.phase === 'passing'
            ? clamp(this.lead / FESTIVAL_RACECRAFT.leadHold, 0, 1)
            : 1,
      passes: this.passes,
      sequence: this.sequence,
    };
  }
}
