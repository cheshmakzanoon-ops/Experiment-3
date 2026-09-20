import { DECAL_LIMIT, emptyDecal, validateDecals, type DecalSlot } from '../storage/livery.ts';
import { escapeHtml } from './team-hub.ts';

/** Independent, keyboard-operable slots. Browser controls edit bounded UV-space
 * transforms; FormulaCar.setLivery paints those exact transforms on the car. */
export class DecalEditor {
  private slots: DecalSlot[] = [];
  private selected = 1;
  constructor(
    private root: HTMLElement,
    private change: () => void,
  ) {
    root.addEventListener('input', (event) => {
      const input = event.target as HTMLInputElement;
      if (!input.dataset.decal) return;
      if (input.dataset.decal === 'slot') {
        this.selected = Number(input.value);
        this.render();
        this.root.querySelector<HTMLSelectElement>('[data-decal="slot"]')?.focus();
        return;
      }
      const selected = this.current();
      const enabled = this.root.querySelector<HTMLInputElement>('[data-decal="enabled"]')!.checked;
      for (const key of ['text', 'color', 'side', 'x', 'y', 'scale', 'rotation'] as const) {
        const control = this.root.querySelector<HTMLInputElement>(`[data-decal="${key}"]`)!;
        Object.assign(selected, {
          [key]: ['x', 'y', 'scale', 'rotation'].includes(key)
            ? Number(control.value)
            : control.value,
        });
      }
      this.slots = validateDecals([
        ...this.slots.filter((row) => row.id !== this.selected),
        ...(enabled ? [selected] : []),
      ]);
      const output = this.root.querySelector<HTMLOutputElement>(
        `output[for="decal-${input.dataset.decal}"]`,
      );
      if (output) output.value = input.value;
      this.preview();
      this.change();
    });
  }
  load(value: unknown) {
    this.slots = validateDecals(value);
    this.selected = 1;
    this.render();
  }
  value() {
    return validateDecals(this.slots);
  }
  private current() {
    return { ...(this.slots.find((row) => row.id === this.selected) ?? emptyDecal(this.selected)) };
  }
  private preview() {
    const slot = this.current(),
      rows = this.slots.filter((row) => row.side === slot.side);
    const node = this.root.querySelector('#decalMap');
    if (node)
      node.innerHTML = `<svg viewBox="0 0 400 150" role="img" aria-label="${slot.side} flank decal positions"><path d="M12 117L50 35L285 18L388 110L388 135H12Z" fill="#17242d" stroke="#64818e"/>${rows.map((r) => `<g transform="translate(${200 + r.x * 142} ${77 + r.y * 44}) rotate(${r.rotation})"><rect x="-39" y="-12" width="78" height="24" rx="3" fill="${r.id === slot.id ? '#394a56' : '#17242d'}" stroke="#78919b"/><text text-anchor="middle" dominant-baseline="central" font-size="11" fill="${r.color}">${escapeHtml(r.text)}</text><text y="-16" text-anchor="middle" font-size="10" fill="#e9f5f4">${r.id}</text></g>`).join('')}</svg><small>${slot.side.toUpperCase()} FLANK · SCHEMATIC UV GUIDE · ${this.slots.length}/10 ACTIVE</small>`;
  }
  private render() {
    const slot = this.current();
    this.root.innerHTML = `<h4>Ten independent decal slots</h4><label>SLOT<select data-decal="slot" aria-label="Decal slot">${Array.from({ length: DECAL_LIMIT }, (_, i) => `<option value="${i + 1}" ${this.selected === i + 1 ? 'selected' : ''}>SLOT ${i + 1}${this.slots.some((r) => r.id === i + 1) ? ' / ACTIVE' : ''}</option>`).join('')}</select></label><label class="check"><input type="checkbox" data-decal="enabled" ${this.slots.some((r) => r.id === this.selected) ? 'checked' : ''}>ENABLE THIS SLOT</label><label>SURFACE<select data-decal="side" aria-label="Decal surface"><option value="left" ${slot.side === 'left' ? 'selected' : ''}>LEFT FLANK</option><option value="right" ${slot.side === 'right' ? 'selected' : ''}>RIGHT FLANK</option></select></label><label>DECAL WORDMARK<input data-decal="text" aria-label="Decal wordmark" maxlength="14" value="${escapeHtml(slot.text)}"></label><label>DECAL COLOUR<input data-decal="color" aria-label="Decal colour" type="color" value="${slot.color}"></label>${(
      [
        ['x', 'LONGITUDINAL', -1, 1, 0.01],
        ['y', 'VERTICAL', -1, 1, 0.01],
        ['scale', 'SCALE', 0.35, 1.75, 0.05],
        ['rotation', 'ROTATION', -90, 90, 1],
      ] as const
    )
      .map(
        ([key, label, min, max, step]) =>
          `<label for="decal-${key}">${label}<output for="decal-${key}">${slot[key]}</output></label><input id="decal-${key}" data-decal="${key}" aria-label="Decal ${key}" type="range" min="${min}" max="${max}" step="${step}" value="${slot[key]}">`,
      )
      .join(
        '',
      )}<div id="decalMap"></div><p class="photo-help">Slots preview on the actual left or right body skin. Save livery to keep them. Original text only; no licensed sponsor logos or reference images.</p>`;
    this.preview();
  }
}
