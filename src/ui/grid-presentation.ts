import {
  GRID_PRESENTATION_SECONDS,
  GridPresentationClock,
  gridPresentationStage,
} from '../core/grid-presentation.ts';

export class GridPresentationPanel {
  readonly root = document.createElement('section');
  private readonly heading: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly progress: HTMLInputElement;
  private readonly toggle: HTMLButtonElement;
  private readonly start: HTMLButtonElement;
  constructor(
    parent: HTMLElement,
    callbacks: { toggle(): void; seek(time: number): void; start(): void; back(): void },
  ) {
    this.root.id = 'gridPresentation';
    this.root.className = 'grid-presentation';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Pre-race presentation');
    this.root.innerHTML = `<header><div class="grid-event"><span class="eyebrow">APEX / RACE DAY</span><h1 id="gridEventTitle"></h1><p id="gridEventBrief"></p></div>
      <div class="grid-stage" role="status" aria-live="polite"><span class="eyebrow">CREW PREPARATION</span><h2 id="gridStage"></h2><p id="gridStageDetail"></p></div></header>
      <div class="grid-presentation-footer"><label class="grid-timeline">PRESENTATION POSITION <input id="gridPresentationSeek" type="range" min="0" max="${GRID_PRESENTATION_SECONDS}" step=".1" value="0" aria-label="Grid presentation position"></label>
      <div class="grid-presentation-actions"><button type="button" id="gridPresentationPlay" class="primary">PLAY PREPARATION</button><button type="button" id="gridPresentationStart">SKIP TO START LIGHTS</button><button type="button" id="gridPresentationBack">BACK TO GRID MENU</button></div>
      <small>Race simulation is held. This presentation does not change tyre temperature, fuel, or grip.</small></div>`;
    parent.append(this.root);
    this.heading = this.root.querySelector('#gridStage')!;
    this.detail = this.root.querySelector('#gridStageDetail')!;
    this.progress = this.root.querySelector('#gridPresentationSeek')!;
    this.toggle = this.root.querySelector('#gridPresentationPlay')!;
    this.start = this.root.querySelector('#gridPresentationStart')!;
    this.toggle.addEventListener('click', callbacks.toggle);
    this.start.addEventListener('click', callbacks.start);
    this.root.querySelector('#gridPresentationBack')!.addEventListener('click', callbacks.back);
    this.progress.addEventListener('input', () => callbacks.seek(Number(this.progress.value)));
    // The native slider controls the presentation, never a hidden driving action.
    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') event.stopPropagation();
    });
  }
  show(circuit: string, brief: string, automatic = false) {
    this.root.dataset.automatic = String(automatic);
    (this.root.querySelector('.grid-timeline') as HTMLElement).hidden = automatic;
    this.root.querySelector('#gridPresentationBack')!.textContent = automatic
      ? 'BACK TO BRIEFING'
      : 'BACK TO GRID MENU';
    this.root.querySelector('#gridEventTitle')!.textContent = circuit;
    this.root.querySelector('#gridEventBrief')!.textContent = brief;
    this.root.hidden = false;
    this.toggle.focus();
  }
  update(clock: GridPresentationClock) {
    const stage = gridPresentationStage(clock.time);
    if (this.heading.textContent !== stage.title) {
      this.heading.textContent = stage.title;
      this.detail.textContent = stage.detail;
    }
    this.progress.value = String(clock.time);
    this.progress.setAttribute(
      'aria-valuetext',
      `${clock.time.toFixed(1)} seconds. ${stage.title}`,
    );
    this.toggle.textContent = clock.complete
      ? 'REPLAY PREPARATION'
      : clock.playing
        ? 'PAUSE PREPARATION'
        : 'PLAY PREPARATION';
    this.start.textContent = clock.complete ? 'BEGIN RACE' : 'SKIP TO START LIGHTS';
  }
  hide() {
    this.root.hidden = true;
  }
}
