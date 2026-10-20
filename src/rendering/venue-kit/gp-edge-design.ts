import { clamp, mod } from '../../core/math.ts';
import { gpCornerShapes } from '../../simulation/gp-corner-shape.ts';
import type { Track } from '../../simulation/track.ts';

export interface GpEdgeDesign {
  readonly id: string;
  readonly kerb: readonly [number, number];
  readonly apron: number;
  readonly marking: number;
  /** Existing style indices remain meaningful in geometry diagnostics. */
  readonly kerbStyle: number;
  readonly runoffStyle: number;
}

/** Original venue identities, drawn from the coherent kerb/apron relationships
 * in REF015/025/027/031/033/044/045/047. These are our own colour schemes, not
 * replicas of named real circuits. Paint stays below paper-white reflectance. */
const DESIGNS: Readonly<Record<string, GpEdgeDesign>> = Object.freeze({
  'poggio-alto': Object.freeze({
    id: 'tuscan-red-and-sage',
    kerb: Object.freeze([0xa82a26, 0xcfccc3] as const),
    apron: 0x397363,
    marking: 0xc9c7bc,
    kerbStyle: 0,
    runoffStyle: 0,
  }),
  'cape-wrenna': Object.freeze({
    id: 'coastal-blue-and-chalk',
    kerb: Object.freeze([0x315e88, 0xcdcec7] as const),
    apron: 0x327d95,
    marking: 0xc7ccc8,
    kerbStyle: 1,
    runoffStyle: 2,
  }),
  haarveld: Object.freeze({
    id: 'heath-blue-and-ochre',
    kerb: Object.freeze([0x31577c, 0xc5ad59] as const),
    apron: 0x335c89,
    marking: 0xc9b66d,
    kerbStyle: 1,
    runoffStyle: 2,
  }),
  montejaral: Object.freeze({
    id: 'sierra-oxide-and-limestone',
    kerb: Object.freeze([0xa33b31, 0xd0cabd] as const),
    apron: 0xa24d3a,
    marking: 0xd1c9b6,
    kerbStyle: 0,
    runoffStyle: 1,
  }),
});

export function gpEdgeDesign(track: Track): GpEdgeDesign | null {
  return DESIGNS[track.circuit.id] ?? null;
}

const windows = new WeakMap<Track, ReturnType<typeof gpCornerShapes>>();
const smooth = (value: number) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Signed painted-corner envelope: + outside entry/exit, - inside apex.
 * Broad escape-side paint follows the whole bend; the inner apron opens only
 * near the apex. It does not invent a racing line or recommend a safe speed.
 * The geometry supplies this immutable value, so held/replayed views are exact.
 * Each side is sampled independently instead of giving both sides the same
 * arbitrary every-fourth-corner colour. No per-frame work or new draw calls. */
export function gpCornerPaint(track: Track, s: number, lateral: number): number {
  if (!gpEdgeDesign(track) || !Number.isFinite(s) || !Number.isFinite(lateral) || lateral === 0)
    return 0;
  let shapes = windows.get(track);
  if (!shapes) windows.set(track, (shapes = gpCornerShapes(track)));
  let strongest = 0;
  const side = Math.sign(lateral);
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (shape.direction === 'straight') continue;
    const distance =
      mod(s - track.circuit.corners[i].s + track.length / 2, track.length) - track.length / 2;
    const outside = side === (shape.direction === 'left' ? -1 : 1),
      before = shape.entry * (outside ? 1 : 0.58),
      after = shape.exit * (outside ? 1 : 0.7),
      extent = distance < 0 ? before : after;
    // Fade over the outer 45 percent of the relevant road-shaped window.
    const weight = 1 - smooth((Math.abs(distance) / Math.max(1, extent) - 0.55) / 0.45);
    if (weight > Math.abs(strongest)) strongest = weight * (outside ? 1 : -1);
  }
  return strongest;
}
