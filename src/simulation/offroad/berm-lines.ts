/** Racing grooves cut into the surveyed bank. Dimensions are in metres
 * measured toward the outside of the turn, so the same section mirrors
 * correctly through left and right corners. */
export interface BermLine {
  entry: number;
  apex: number;
  exit: number;
  halfWidth: number;
  depth: number;
}

export const OUTDOOR_BERM_LINES: readonly BermLine[] = [
  { entry: -0.65, apex: 0.8, exit: -1.05, halfWidth: 0.79, depth: 0.062 },
  { entry: 1.6, apex: 3.65, exit: 1.18, halfWidth: 0.92, depth: 0.108 },
];
export const ARENA_BERM_LINES: readonly BermLine[] = [
  { entry: -0.65, apex: 0.42, exit: -0.78, halfWidth: 0.72, depth: 0.042 },
  { entry: 1.24, apex: 2.82, exit: 1.05, halfWidth: 0.81, depth: 0.072 },
];

export interface BermFinish {
  bed: number;
  lip: number;
}

/** Add the cut and the displaced outer bank to the same ground query used
 * by tyres and mesh vertices. The polynomial sections have zero slope at
 * their boundaries. The centreline enters and leaves tangent to the run. */
export function addBermLines(
  lines: readonly BermLine[], side: number, lateral: number, into: number, span: number,
  envelope: number, envelopeSlope: number, out: { h: number; ds: number; dl: number },
  finish?: BermFinish,
) {
  if (envelope === 0 || span <= 0) return;
  const u = into / span, arch = u * (1 - u);
  const progress = u * u * (3 - 2 * u), bend = 16 * arch * arch;
  const dProgress = 6 * arch / span, dBend = 32 * arch * (1 - 2 * u) / span;
  for (const line of lines) {
    const sweep = line.apex - (line.entry + line.exit) * 0.5;
    const centre = line.entry + (line.exit - line.entry) * progress + sweep * bend;
    const centreSlope = (line.exit - line.entry) * dProgress + sweep * dBend;
    const x = (side * lateral - centre) / line.halfWidth;
    // A broad polished bed and a narrower pile of loose earth on its outer
    // shoulder. Only part of the churned material builds up beside the cut.
    const shoulderWidth = 0.76, shoulder = (x - 0.98) / shoulderWidth;
    if (x <= -1 || shoulder >= 1) continue;
    const bedBase = Math.max(0, 1 - x * x), lipBase = Math.max(0, 1 - shoulder * shoulder);
    const bed = bedBase ** 3, lip = lipBase ** 3;
    const lipHeight = 0.68;
    const section = line.depth * (lipHeight * lip - bed);
    const acrossSlope = (6 * line.depth / line.halfWidth) *
      (x * bedBase ** 2 - (lipHeight / shoulderWidth) * shoulder * lipBase ** 2);
    out.h += envelope * section;
    out.ds += envelopeSlope * section - envelope * acrossSlope * centreSlope;
    out.dl += envelope * acrossSlope * side;
    if (finish) {
      finish.bed = Math.max(finish.bed, envelope * bed);
      finish.lip = Math.max(finish.lip, envelope * lip);
    }
  }
}
