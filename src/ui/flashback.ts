import { FLASHBACK } from '../core/flashback.ts';
import type { SessionOptions } from '../simulation/config.ts';

/** Flashback is offered in race sessions and free practice (a time-trial or
 * qualifying lap stays honest), up to FLASHBACK.perRace times per session. */
export function flashbackAllowed(mode: SessionOptions['mode'], used: number) {
  return (
    (mode === 'race' || mode === 'endurance' || mode === 'practice') && used < FLASHBACK.perRace
  );
}

/** The replay bar's flashback controls: a tag with the flashbacks left and
 * RESUME FROM HERE, shown only while choosing a flashback point. */
export class FlashbackPanel {
  readonly button: HTMLButtonElement;
  readonly tag: HTMLElement;
  constructor(private readonly replayBar: HTMLElement) {
    this.tag = document.createElement('span');
    this.tag.className = 'flashback-tag';
    this.tag.hidden = true;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.dataset.action = 'flashbackResume';
    this.button.className = 'primary flashback-resume';
    this.button.textContent = 'RESUME FROM HERE';
    this.button.hidden = true;
    const exit = replayBar.querySelector('[data-action="replayExit"]');
    replayBar.insertBefore(this.tag, exit);
    replayBar.insertBefore(this.button, exit);
  }
  show(active: boolean, left = 0) {
    this.tag.hidden = this.button.hidden = !active;
    // The transport never idles out while a flashback point is being chosen.
    this.replayBar.style.opacity = active ? '1' : '';
    this.tag.textContent = `FLASHBACK · ${left} LEFT`;
    this.busy(false);
  }
  busy(on: boolean) {
    this.button.disabled = on;
    this.button.textContent = on ? 'REWINDING…' : 'RESUME FROM HERE';
  }
}
