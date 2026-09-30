import type * as T from 'three';

export const DRAW_PHASES = ['environment', 'probe', 'mirrors', 'shadow', 'composer', 'other'] as const;
export type DrawPhase = (typeof DRAW_PHASES)[number];
export type DrawBreakdown = Record<DrawPhase, { calls: number; triangles: number }>;

interface RenderInfo {
  calls: number;
  triangles: number;
}

/** Attributes WebGLRenderer.info draw calls and triangles to render phases of
 * one presented frame. Shadow-map passes run inside the first scene render, so
 * the shadow map's own render method is bracketed. Counting reads two integers
 * per phase change; it never inspects scene objects or allocates per frame. */
export class DrawLedger {
  private current: DrawPhase = 'other';
  private lastCalls = 0;
  private lastTriangles = 0;
  private working = DrawLedger.empty();
  /** The most recently completed frame. */
  readonly completed = DrawLedger.empty();
  constructor(private info: RenderInfo) {}
  static empty(): DrawBreakdown {
    const out = {} as DrawBreakdown;
    for (const phase of DRAW_PHASES) out[phase] = { calls: 0, triangles: 0 };
    return out;
  }
  /** Bracket the renderer's shadow-map pass without changing its behaviour. */
  instrumentShadows(shadowMap: { render: (...args: never[]) => void }) {
    const original = shadowMap.render.bind(shadowMap) as (...args: unknown[]) => void;
    (shadowMap as { render: (...args: unknown[]) => void }).render = (...args: unknown[]) => {
      const previous = this.current;
      this.mark('shadow');
      try {
        original(...args);
      } finally {
        this.mark(previous);
      }
    };
  }
  /** Call immediately after renderer.info.reset(). */
  begin() {
    for (const phase of DRAW_PHASES) {
      this.working[phase].calls = 0;
      this.working[phase].triangles = 0;
    }
    this.current = 'other';
    this.lastCalls = this.info.calls;
    this.lastTriangles = this.info.triangles;
  }
  mark(next: DrawPhase) {
    const bucket = this.working[this.current];
    bucket.calls += this.info.calls - this.lastCalls;
    bucket.triangles += this.info.triangles - this.lastTriangles;
    this.lastCalls = this.info.calls;
    this.lastTriangles = this.info.triangles;
    this.current = next;
  }
  end() {
    this.mark('other');
    for (const phase of DRAW_PHASES) {
      this.completed[phase].calls = this.working[phase].calls;
      this.completed[phase].triangles = this.working[phase].triangles;
    }
  }
  snapshot(): DrawBreakdown {
    const out = DrawLedger.empty();
    for (const phase of DRAW_PHASES) Object.assign(out[phase], this.completed[phase]);
    return out;
  }
}

export function attachDrawLedger(renderer: T.WebGLRenderer) {
  const ledger = new DrawLedger(renderer.info.render);
  ledger.instrumentShadows(renderer.shadowMap as unknown as { render: () => void });
  return ledger;
}
