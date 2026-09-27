import styles from './compact-race-hud.css?inline';

/** One live data set, reflowed rather than cloned or updated by another timer.
 * The optional compact panel never pauses, seeks, or writes driving requests.
 * Listeners belong to this Interface's nodes; no global resize/keyboard listener
 * or retained observer survives replacement of the interface. */
export function installCompactRaceHud(hud: HTMLElement) {
  const header = hud.querySelector('.hud-top');
  const panels = ['.timing', '.lap-panel', '.minimap', '.car-status'].map((selector) =>
    hud.querySelector<HTMLElement>(selector),
  );
  if (!header || panels.some((panel) => !panel)) throw new Error('Incomplete racing HUD');
  if (hud.querySelector('.race-info-toggle')) throw new Error('Racing HUD already installed');
  const style = document.createElement('style');
  style.textContent = styles;
  const region = document.createElement('div');
  region.id = 'raceInfoPanels';
  region.className = 'race-info-panels';
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', 'Live race information');
  const hint = document.createElement('p');
  hint.className = 'race-info-hint';
  hint.textContent = 'Live race information. Driving continues while this panel is open.';
  region.append(hint, ...(panels as HTMLElement[]));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'race-info-toggle';
  button.textContent = 'RACE INFO';
  button.setAttribute('aria-controls', region.id);
  button.setAttribute('aria-expanded', 'false');
  header.insertBefore(button, header.lastElementChild);
  hud.append(style, region);
  const setOpen = (open: boolean) => {
    hud.dataset.infoOpen = String(open);
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? 'CLOSE INFO' : 'RACE INFO';
  };
  setOpen(false);
  button.addEventListener('click', () => setOpen(hud.dataset.infoOpen !== 'true'));
  button.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  });
  hud.addEventListener('keydown', (event) => {
    if (hud.dataset.infoOpen !== 'true' || button.getClientRects().length === 0) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.focus();
    } else if (
      region.contains(event.target as Node) &&
      [
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' ',
      ].includes(event.key)
    ) {
      // Native scrolling stays native; keyup must reach input to release any
      // throttle/steering key held before focus entered the information panel.
      event.stopPropagation();
    }
  });
  hud.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-action]')) setOpen(false);
  });
}
