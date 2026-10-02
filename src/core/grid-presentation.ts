/** A presentation-only pre-race clock. It never advances the physics worker. */
export const GRID_PRESENTATION_SECONDS = 24;
export const GRID_PRESENTATION_STAGES = [
  {
    start: 0,
    end: 4,
    title: 'On the grid',
    detail: 'Review the conditions. The race clock has not started.',
  },
  { start: 4, end: 7, title: 'Final checks', detail: 'Mechanics approach their assigned wheels.' },
  {
    start: 7,
    end: 12,
    title: 'Tyre preparation',
    detail: 'Crew kneel and take hold of the blanket handles.',
  },
  {
    start: 12,
    end: 17,
    title: 'Blankets off',
    detail: 'Blankets are gathered and lifted clear of the tyres.',
  },
  {
    start: 17,
    end: 22,
    title: 'Clear the grid',
    detail: 'Crew carry the blankets out of the starting corridor.',
  },
  {
    start: 22,
    end: 24,
    title: 'Ready to race',
    detail: 'The grid is clear. Continue to the starting lights.',
  },
] as const;

export function gridPresentationStage(time: number) {
  if (!Number.isFinite(time)) throw new Error('Invalid grid presentation time');
  return (
    GRID_PRESENTATION_STAGES.find((stage) => time < stage.end) ?? GRID_PRESENTATION_STAGES.at(-1)!
  );
}

export class GridPresentationClock {
  time = 0;
  playing = false;
  get complete() {
    return this.time >= GRID_PRESENTATION_SECONDS;
  }
  reset() {
    this.time = 0;
    this.playing = false;
  }
  play() {
    if (!this.complete) this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(time: number) {
    if (!Number.isFinite(time)) throw new Error('Invalid grid presentation time');
    this.time = Math.max(0, Math.min(GRID_PRESENTATION_SECONDS, time));
    this.playing = false;
  }
  advance(seconds: number, visible = true) {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid presentation delta');
    if (!visible) this.pause();
    // Slow renders do not skip whole actions. Hidden time is never caught up.
    if (this.playing)
      this.time = Math.min(GRID_PRESENTATION_SECONDS, this.time + Math.min(seconds, 0.1));
    if (this.complete) this.pause();
    return this.time;
  }
}
