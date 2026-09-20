import { REFERENCES } from './reference-catalogue.ts';
import { referenceRoute } from './reference-routes.ts';
import { escapeHtml } from './team-hub.ts';
export function referenceReview(): string {
  return `<div class="reference-review"><header><div><span class="eyebrow">REFERENCE → GAME / AUDITABLE COVERAGE</span><h2>100 frames. No silent skips.</h2></div><button data-action="modalClose">CLOSE</button></header><p class="reference-summary">100 individually reviewed files: <b>16 unrelated images excluded</b>, 2 peripheral product photos retained as supplementary evidence, and repeated compositions explicitly cross-referenced. “Enhanced” means a working cue was added—not pixel parity or a completed commercial game. No reference artwork is included in the build.</p><div class="reference-filters"><input id="referenceSearch" type="search" aria-label="Search reference images" placeholder="Number, subject, feature, missing functionality…"><select id="referenceFilter" aria-label="Reference status"><option value="all">ALL 100</option><option value="enhanced">ENHANCED CUE</option><option value="cue-present">EXISTING CUE</option><option value="partial">PARTIAL / GAPS</option><option value="supplementary">SUPPLEMENTARY</option><option value="excluded">EXCLUDED</option></select><output id="referenceCount" aria-live="polite">100 / 100</output></div><div class="team-actions"><button data-action="photo">PHOTO / LIVERY</button><button data-action="academy">DRIVING ACADEMY</button><button data-action="team">TEAM HQ</button><button data-action="settings">GARAGE & CONTROLS</button></div><div class="reference-list">${REFERENCES.map((entry) => `<details data-reference="${entry.id}" data-kind="${entry.status}"><summary><b>${String(entry.id).padStart(3, '0')}</b><span>${escapeHtml(entry.title)}</span><small>${entry.status.toUpperCase()}</small></summary><p><b>Observed</b> — ${escapeHtml(entry.observation)}</p>${entry.duplicateOf ? `<p>Repeated/variant composition of <b>${String(entry.duplicateOf).padStart(3, '0')}</b>; not a new independent feature.</p>` : ''}<p><b>In the game</b> — ${escapeHtml(entry.implementation)}</p>${referenceRoute(entry) ? `<button class="reference-inspect" data-action="reference:${entry.id}">${referenceRoute(entry)!.label}</button>` : '<p>Unrelated reference — intentionally no game feature.</p>'}<p><b>How to inspect</b> — ${escapeHtml(entry.view)}</p><p><b>Still missing / limitation</b> — ${escapeHtml(entry.gap)}</p><p><code>${escapeHtml(entry.file)} · ${entry.width} × ${entry.height}<br>${entry.sha256}<br>${entry.code.join('<br>')}</code></p></details>`).join('')}</div></div>`;
}
export function bindReferenceReview(root: HTMLElement) {
  const search = root.querySelector<HTMLInputElement>('#referenceSearch')!;
  const filter = root.querySelector<HTMLSelectElement>('#referenceFilter')!;
  const count = root.querySelector<HTMLOutputElement>('#referenceCount')!;
  const details = [...root.querySelectorAll<HTMLDetailsElement>('[data-reference]')];
  const update = () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (let i = 0; i < REFERENCES.length; i++) {
      const e = REFERENCES[i];
      const match =
        (filter.value === 'all' || e.status === filter.value) &&
        (!query ||
          `${String(e.id).padStart(3, '0')} ${e.title} ${e.observation} ${e.implementation} ${e.gap}`
            .toLowerCase()
            .includes(query));
      details[i].hidden = !match;
      if (match) visible++;
    }
    count.value = `${visible} / 100`;
  };
  search.addEventListener('input', update);
  filter.addEventListener('change', update);
}
