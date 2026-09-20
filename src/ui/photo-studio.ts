import { DEFAULT_PHOTO, validatePhoto, type PhotoSettings } from '../rendering/photo-camera.ts';
import { LIVERY_PRESETS, validateLivery, type Livery } from '../storage/livery.ts';
import { escapeHtml } from './team-hub.ts';
interface PhotoCallbacks {
  change(settings: PhotoSettings): void;
  preview(livery: Livery): void;
  save(livery: Livery): Promise<void>;
  capture(): void;
  close(): void;
}
const sliders = [
  ['azimuth', 'ORBIT', -180, 180, 1, '°'],
  ['elevation', 'ELEVATION', 0, 75, 1, '°'],
  ['distance', 'DISTANCE', 2, 45, 0.1, ' m'],
  ['focalLength', 'FOCAL LENGTH', 18, 150, 1, ' mm'],
  ['exposure', 'EXPOSURE', -2, 2, 0.05, ' EV'],
  ['roll', 'ROLL', -45, 45, 1, '°'],
] as const;
export class PhotoStudio {
  readonly element = document.createElement('section');
  private settings: PhotoSettings = { ...DEFAULT_PHOTO };
  private cars = 1;
  private generation = 0;
  private saving = false;
  constructor(
    root: HTMLElement,
    private callbacks: PhotoCallbacks,
  ) {
    this.element.id = 'photoStudio';
    this.element.className = 'photo-studio';
    this.element.hidden = true;
    root.append(this.element);
    this.element.addEventListener('input', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.dataset.photo) {
        this.settings = validatePhoto(
          {
            ...this.settings,
            [input.dataset.photo]:
              input.dataset.photo === 'backdrop' ? input.value : Number(input.value),
          },
          this.cars,
        );
        this.callbacks.change(this.settings);
        const output = this.element.querySelector<HTMLOutputElement>(`output[for="${input.id}"]`);
        if (output) output.value = input.value;
        this.element.querySelector<HTMLElement>('#photoLivery')!.hidden =
          this.settings.target !== 0;
      } else if (input.closest('#photoLivery')) this.callbacks.preview(this.readLivery());
    });
    this.element.addEventListener('change', (e) => {
      const select = e.target as HTMLSelectElement;
      if (select.id !== 'liveryPreset' || !(select.value in LIVERY_PRESETS)) return;
      const preset = LIVERY_PRESETS[select.value as keyof typeof LIVERY_PRESETS];
      this.fillLivery(preset);
      this.callbacks.preview(preset);
    });
    this.element.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-photo-action]');
      if (!button) return;
      const action = button.dataset.photoAction;
      if (action === 'close') this.callbacks.close();
      else if (action === 'capture') this.callbacks.capture();
      else if (action === 'reset') {
        this.settings = { ...DEFAULT_PHOTO };
        this.callbacks.change(this.settings);
        this.fillCamera();
      } else if (action === 'clean') {
        const clean = this.element.classList.toggle('clean-frame');
        button.textContent = clean ? 'SHOW CONTROLS' : 'CLEAN FRAME';
      }
    });
    this.element.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.saving) return;
      this.saving = true;
      const generation = this.generation;
      const button = this.element.querySelector<HTMLButtonElement>('#saveLivery')!;
      button.disabled = true;
      this.status('Saving livery…');
      void this.callbacks
        .save(this.readLivery())
        .then(() => {
          if (generation === this.generation)
            this.status('Livery saved. Applied to your car in every session.');
        })
        .catch((error) => {
          if (generation === this.generation)
            this.status(`Not saved: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          this.saving = false;
          if (button.isConnected) button.disabled = false;
        });
    });
  }
  open(livery: Livery, cars: number) {
    this.generation++;
    this.cars = Math.max(1, Math.min(12, cars));
    this.settings = { ...DEFAULT_PHOTO };
    this.element.classList.remove('clean-frame');
    this.element.innerHTML = `<header class="photo-title"><span class="eyebrow">APEX / PHOTO STUDIO</span><h2>Hold the moment.</h2><p>FROZEN SIMULATION · ORIGINAL GAME RENDER</p></header><div class="photo-top-actions"><button data-photo-action="clean">CLEAN FRAME</button><button data-photo-action="close">RETURN / ESC</button></div><aside class="photo-drawer" aria-label="Photo studio controls"><h3>Compose</h3><label>SETTING<select id="photoBackdrop" data-photo="backdrop"><option value="circuit">ON CIRCUIT</option><option value="studio">DARK SHOWROOM</option></select></label><label>SUBJECT<select id="photoTarget" data-photo="target">${Array.from({ length: this.cars }, (_, id) => `<option value="${id}">${id === 0 ? 'YOUR CAR' : `CAR ${id + 1}`}</option>`).join('')}</select></label>${sliders.map(([key, title, min, max, step, unit]) => `<label for="photo-${key}">${title}<span><output for="photo-${key}">${this.settings[key]}</output>${unit}</span></label><input id="photo-${key}" data-photo="${key}" aria-label="${title}" type="range" min="${min}" max="${max}" step="${step}" value="${this.settings[key]}">`).join('')}<p class="photo-help">Lens framing uses a 24 mm vertical film gate. Exposure adjusts the actual renderer. No artificial depth of field or shutter blur is claimed.</p><div class="photo-buttons"><button data-photo-action="reset">RESET CAMERA</button><button class="primary" id="capturePhoto" data-photo-action="capture">DOWNLOAD PNG</button></div><form id="photoLivery"><h3>Make it yours.</h3><label>STUDIO PRESET<select id="liveryPreset"><option value="">CUSTOM</option>${Object.keys(
      LIVERY_PRESETS,
    )
      .map((key) => `<option value="${key}">${key.toUpperCase()}</option>`)
      .join(
        '',
      )}</select></label><div class="livery-paints"><label>BODY<input id="liveryPrimary" type="color" value="${livery.primary}"></label><label>ACCENT<input id="liveryAccent" type="color" value="${livery.accent}"></label><label>NUMBER<input id="liveryNumber" type="number" min="1" max="99" value="${livery.number}" required></label></div><label>WORDMARK<input id="liverySponsor" maxlength="14" value="${escapeHtml(livery.sponsor)}" required></label><label>GRAPHIC<select id="liveryPattern"><option value="sweep">SWEEP</option><option value="split">SPLIT</option><option value="minimal">MINIMAL</option></select></label><button type="submit" id="saveLivery">SAVE LIVERY</button><p class="photo-help">Changes preview immediately. Save to keep them; unsaved edits are discarded on return.</p></form><p id="photoStatus" role="status">PNG contains the game canvas only, without menus or reference artwork.</p></aside>`;
    this.fillLivery(livery);
    this.element.hidden = false;
    this.callbacks.change(this.settings);
    this.element.querySelector<HTMLButtonElement>('[data-photo-action="close"]')?.focus();
  }
  compose(value: Partial<PhotoSettings>) {
    this.settings = validatePhoto({ ...this.settings, ...value }, this.cars);
    this.fillCamera();
    this.callbacks.change(this.settings);
  }
  private fillCamera() {
    (this.element.querySelector('#photoBackdrop') as HTMLSelectElement).value =
      this.settings.backdrop;
    for (const [key] of sliders) {
      (this.element.querySelector(`#photo-${key}`) as HTMLInputElement).value = String(
        this.settings[key],
      );
      (this.element.querySelector(`output[for="photo-${key}"]`) as HTMLOutputElement).value =
        String(this.settings[key]);
    }
    (this.element.querySelector('#photoTarget') as HTMLSelectElement).value = String(
      this.settings.target,
    );
    this.element.querySelector<HTMLElement>('#photoLivery')!.hidden = this.settings.target !== 0;
  }
  private fillLivery(value: Livery) {
    for (const key of ['primary', 'accent', 'number', 'sponsor', 'pattern'] as const) {
      const id = 'livery' + key[0].toUpperCase() + key.slice(1);
      (this.element.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement).value = String(
        value[key],
      );
    }
  }
  private readLivery(): Livery {
    const value = (id: string) => (this.element.querySelector(`#${id}`) as HTMLInputElement).value;
    return validateLivery({
      primary: value('liveryPrimary'),
      accent: value('liveryAccent'),
      number: Number(value('liveryNumber')),
      sponsor: value('liverySponsor'),
      pattern: value('liveryPattern'),
    });
  }
  status(value: string) {
    const node = this.element.querySelector('#photoStatus');
    if (node) node.textContent = value;
  }
  captureBusy(busy: boolean) {
    const node = this.element.querySelector<HTMLButtonElement>('#capturePhoto');
    if (node) node.disabled = busy;
  }
  close() {
    this.generation++;
    this.element.hidden = true;
  }
}
