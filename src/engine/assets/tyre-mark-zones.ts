import { envelopeCornerSpeed } from '../../simulation/ai.ts';
import { GP_R1 } from '../../simulation/bike-definitions.ts';
import { racingLineFor } from '../../simulation/racing-line.ts';
import type { Track } from '../../simulation/track.ts';

/** Rubber laid by locking and spinning tyres where cars brake hard, turn in
 * and power out of slow corners. Placed from a speed profile along the solved
 * racing line (the AI's own corner envelope, a braking and a traction limit),
 * so the marks sit where the simulated cars actually brake. Original
 * procedural decals; they are presentation only and never change grip. */
export const TYRE_MARKS = Object.freeze({
  /** Metres between profile samples. */
  step: 2,
  /** Deceleration and acceleration limits of the profile, m/s^2. */
  braking: 42,
  traction: 11,
  /** A braking zone loses at least this much speed (m/s). */
  minimumDrop: 12,
  /** Slow-corner exits (wheelspin marks) start below this speed (m/s). */
  slowExit: 32,
  /** Wheel centres either side of the car's centreline, metres. */
  halfTrack: 0.8,
  /** Width of one mark, metres. */
  width: 0.3,
  /** Height above the asphalt, metres. */
  lift: 0.006,
  /** Track length per merged mesh, metres (culling granularity). */
  chunk: 400,
  /** Braking streak length range, metres: they end at (or just short of) the apex. */
  brakingLength: [20, 60] as const,
  /** Standing water (mm, the physics track state) over which the marks fade
   * out, and the share of their opacity the film hides. */
  waterCover: [0.15, 1.1] as const,
  waterHidden: 0.85,
});

export interface TyreMarkZone {
  kind: 'braking' | 'exit';
  start: number;
  end: number;
  /** Speed lost (braking) or gained (exit) across the zone, m/s. */
  strength: number;
}

/** Braking and slow-exit zones from a speed profile along the racing line. */
export function tyreMarkZones(track: Track, motorcycle = false): TyreMarkZone[] {
  const line = racingLineFor(track);
  // Use the existing prototype's no-downforce capability envelope. Formula
  // braking zones otherwise begin much too late for the bike scene.
  const envelope = motorcycle ? GP_R1.ai : undefined,
    braking = envelope ? envelope.brakingBase * envelope.brakingMargin : TYRE_MARKS.braking,
    traction = motorcycle ? 7.8 : TYRE_MARKS.traction;
  const n = Math.round(track.length / TYRE_MARKS.step),
    step = track.length / n;
  const corner = new Float64Array(n),
    speed = new Float64Array(n);
  for (let i = 0; i < n; i++)
    corner[i] = Math.min(
      envelope?.topSpeed ?? 92,
      envelopeCornerSpeed(line.curvatureAt(i * step), 1, 1, envelope),
    );
  // Closed-lap profile: forward (traction) and backward (braking) passes,
  // repeated so the start/finish wrap settles.
  speed.set(corner);
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 1; k <= n; k++) {
      const i = k % n,
        prev = (k - 1) % n;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[prev] ** 2 + 2 * traction * step));
    }
    for (let k = n - 1; k >= 0; k--) {
      const i = k % n,
        next = (k + 1) % n;
      speed[i] = Math.min(speed[i], Math.sqrt(speed[next] ** 2 + 2 * braking * step));
    }
  }
  const zones: TyreMarkZone[] = [];
  // Braking: maximal runs where speed falls; keep the heavy ones.
  let i = 0;
  const start = speed.indexOf(Math.max(...speed));
  for (let visited = 0; visited < n; ) {
    const a = (start + i) % n;
    const b = (a + 1) % n;
    if (speed[b] < speed[a] - 1e-6) {
      let j = i;
      while (j - i < n && speed[(start + j + 1) % n] < speed[(start + j) % n] - 1e-6) j++;
      const from = (start + i) % n,
        to = (start + j) % n,
        drop = speed[from] - speed[to];
      if (drop >= TYRE_MARKS.minimumDrop)
        zones.push({
          kind: 'braking',
          start: from * step,
          end: from * step + (j - i) * step,
          strength: drop,
        });
      visited += j - i + 1;
      i = j + 1;
    } else {
      visited++;
      i++;
    }
  }
  // Slow-corner exits: from the apex (slowest point) while still slow, and
  // never into the next braking zone.
  const brakingStarts = new Set(zones.map((z) => Math.round(z.start / step) % n));
  for (const zone of zones.filter((z) => z.kind === 'braking')) {
    const apex = Math.round(zone.end / step) % n;
    if (speed[apex] >= TYRE_MARKS.slowExit) continue;
    let j = apex;
    while (
      speed[(j + 1) % n] < TYRE_MARKS.slowExit + 14 &&
      j - apex < n / 8 &&
      !brakingStarts.has((j + 1) % n)
    )
      j++;
    zones.push({
      kind: 'exit',
      start: apex * step,
      end: j * step,
      strength: speed[j % n] - speed[apex],
    });
  }
  return zones.sort((a, b) => a.start - b.start);
}
