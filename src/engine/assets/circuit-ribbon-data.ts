import { clamp } from '../../core/math.ts';
import { trackPoint, type Track, type TrackPoint } from '../../simulation/track.ts';

export interface CircuitRibbonOptions {
  start?: number;
  end?: number;
  step?: number;
  offset: (s: number, t: number) => number;
  height?: (s: number, l: number, t: number) => number;
  stripes?: boolean;
  /** Run-off ribbon: per-vertex `runoffStyle` (D15). */
  runoff?: boolean;
  columns?: number;
  road?: boolean;
  include?: (s: number, lateral: number) => boolean;
  /** Extra per-vertex float attributes by name (GP gravel cover). */
  attributes?: Readonly<Record<string, (s: number, lateral: number) => number>>;
}
/** Presentation fields supplied explicitly by the existing owner. No renderer,
 * material, colour-management singleton or shader module is imported here.
 * Callbacks retain their original order and the shared scratch line output. */
export interface CircuitRibbonFields {
  hasGpDesign(): boolean;
  apex(s: number, lateral: number, out: [number, number], motorcycle?: boolean): [number, number];
  color(s: number): { readonly r: number; readonly g: number; readonly b: number };
  kerbStyle(s: number): number;
  runoffStyle(s: number): number;
  usage(distance: number): number;
  gpPaint(s: number, lateral: number): number;
  gpGravel(point: TrackPoint, side: number): number;
}

/** One ribbon chunk's original double-precision construction arrays. Preserve
 * expression order; Float32 conversion and Three normal generation stay with
 * the existing caller. Chunking, materials, scheduling and resource ownership
 * are deliberately outside this extraction. This does not change physics. */
export function circuitRibbonData(
  track: Track,
  options: CircuitRibbonOptions,
  fields: CircuitRibbonFields,
) {
  const start = options.start ?? 0,
    end = options.end ?? track.length,
    rows = Math.ceil((end - start) / (options.step ?? 2)),
    cols = options.columns ?? 1;
  const vertices: number[] = [],
    uv: number[] = [],
    state: number[] = [],
    colors: number[] = [],
    edge: number[] = [],
    apex: number[] = [],
    bikeBrake: number[] = [],
    kerb: number[] = [],
    runoff: number[] = [],
    gpPaint: number[] = [],
    gpGravel: number[] = [],
    custom = Object.entries(options.attributes ?? {}).map(
      ([name, value]) => [name, value, [] as number[]] as const,
    ),
    indices: number[] = [];
  const gpDesign = fields.hasGpDesign();
  const p = trackPoint(),
    line: [number, number] = [0, 0];
  for (let i = 0; i <= rows; i++) {
    const s = start + ((end - start) * i) / rows;
    track.at(s, p);
    for (let j = 0; j <= cols; j++) {
      const t = j / cols,
        l = options.offset(s, t),
        extra = options.height?.(s, l, t) ?? 0;
      vertices.push(p.x + p.nx * l, p.y + p.bank * clamp(l, -12, 12) + extra, p.z + p.nz * l);
      uv.push(l / 5, s / 5);
      state.push(clamp((l / p.width) * 0.5 + 0.5, 0, 1), s / track.length);
      // Signed metres beyond the asphalt edge (negative on the road), shared
      // by the kerb, verge and terrain shaders.
      edge.push(Math.abs(l) - p.width);
      for (const [, value, out] of custom) out.push(value(s, l));
      if (options.road) {
        apex.push(...fields.apex(s, l, line));
        bikeBrake.push(fields.apex(s, l, line, true)[1]);
      }
      const c = fields.color(s);
      colors.push(c.r, c.g, c.b);
      if (options.stripes) {
        // D15: kerb scheme and how much the racing line uses this kerb.
        kerb.push(fields.kerbStyle(s));
        const side = Math.sign(l) || 1;
        kerb.push(fields.usage(Math.abs(fields.apex(s, side * p.width, line)[0])));
      }
      if (options.runoff) {
        runoff.push(fields.runoffStyle(s));
        const side = Math.sign(l) || 1;
        runoff.push(fields.usage(Math.abs(fields.apex(s, side * p.width, line)[0])));
        gpPaint.push(fields.gpPaint(s, l));
        // GP: is the verge beyond this apron edge a gravel trap? (litter)
        if (gpDesign) gpGravel.push(fields.gpGravel(p, side));
      }
    }
  }
  const ascending = options.offset(start, 1) >= options.offset(start, 0);
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const centreS = start + ((end - start) * (i + 0.5)) / rows;
      if (options.include && !options.include(centreS, options.offset(centreS, (j + 0.5) / cols)))
        continue;
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      if (ascending) indices.push(a, b, a + 1, b, b + 1, a + 1);
      else indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  return {
    start,
    end,
    rows,
    cols,
    vertices,
    uv,
    state,
    colors,
    edge,
    apex,
    bikeBrake,
    kerb,
    runoff,
    gpPaint,
    gpGravel,
    custom,
    indices,
    gpDesign,
  };
}
