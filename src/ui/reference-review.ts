import {
  ReferenceEvidenceStore,
  REFERENCE_AUDIT_LIMIT,
  type AcceptanceStatus,
} from './reference-evidence.ts';
import { referenceEvent } from '../rendering/reference-events.ts';
import { REFERENCES } from './reference-catalogue.ts';
import { referenceRoute } from './reference-routes.ts';
import { escapeHtml } from './team-hub.ts';
export interface ReferenceReviewContext {
  source: string;
  store: ReferenceEvidenceStore;
}
function evidenceForm(id: number, context?: ReferenceReviewContext) {
  if (!context) return '';
  const row = context.store.get(id, context.source);
  const fixed = row.status === 'duplicate' || row.status === 'not-applicable';
  return `<section class="reference-evidence" aria-label="Visual acceptance for reference ${id}">
    <p><b>Visual acceptance</b> — <output id="qualityState${id}">${row.status.toUpperCase()}${row.stale ? ' · STALE CAPTURE' : ''}</output></p>
    ${row.capture ? `<p>PNG: <code>${escapeHtml(row.capture.imageFile)}</code><br>SHA-256: <code>${row.capture.imageHash}</code><br>Source: <code>${row.capture.source}</code></p>` : '<p>No rendered counterpart attached. Use this reference’s inspection route, then export a PNG in Photo Studio. A capture does not approve the image.</p>'}
    <label>Reviewer<input id="qualityReviewer${id}" maxlength="80" value="${escapeHtml(row.reviewer)}"></label>
    <label>Comparison / remaining discrepancy<textarea id="qualityNotes${id}" maxlength="2000" rows="3">${escapeHtml(row.notes)}</textarea></label>
    <label>Decision<select id="qualityChoice${id}">${(fixed ? [row.status] : ['needs-work', 'accepted']).map((status) => `<option value="${status}" ${status === row.status ? 'selected' : ''}>${status.toUpperCase()}</option>`).join('')}</select></label>
    <button data-audit-save="${id}">SAVE COMPARISON</button><output id="qualityMessage${id}" aria-live="polite"></output>
  </section>`;
}
export function referenceReview(context?: ReferenceReviewContext): string {
  return `<div class="reference-review"><header><div><span class="eyebrow">REFERENCE → GAME / AUDITABLE COVERAGE</span><h2>100 frames. No silent skips.</h2></div><button data-action="modalClose">CLOSE</button></header><p class="reference-summary">100 individually reviewed files: <b>16 unrelated images excluded</b>, 2 peripheral product photos retained as supplementary evidence, and repeated compositions explicitly cross-referenced. “Enhanced” means a working cue was added—not pixel parity or a completed commercial game. No reference artwork is included in the build.</p>${context ? `<p class="team-footnote">Build <code>${context.source}</code>. Source-level cue status and visual acceptance are separate. Stale captures cannot approve this build. Peripheral photos remain hardware evidence, not art requirements.</p><div class="team-actions"><button data-audit-export>EXPORT ALL 100 COMPARISONS</button><label>IMPORT AUDIT JSON<input data-audit-import type="file" accept="application/json,.json"></label><output id="auditMessage" aria-live="polite">${escapeHtml(context.store.persistenceError ?? '')}</output></div>` : ''}<div class="reference-filters"><input id="referenceSearch" type="search" aria-label="Search reference images" placeholder="Number, subject, feature, missing functionality…"><select id="referenceFilter" aria-label="Reference status"><option value="all">ALL 100</option><option value="enhanced">ENHANCED CUE</option><option value="cue-present">EXISTING CUE</option><option value="partial">PARTIAL / GAPS</option><option value="supplementary">SUPPLEMENTARY</option><option value="excluded">EXCLUDED</option></select><output id="referenceCount" aria-live="polite">100 / 100</output></div><div class="team-actions"><button data-action="photo">PHOTO / LIVERY</button><button data-action="academy">DRIVING ACADEMY</button><button data-action="team">TEAM HQ</button><button data-action="settings">GARAGE & CONTROLS</button></div><p class="team-footnote">Phase 27G adds shared vehicle silhouettes, manufactured finishes, grip-anchored hands, authored Aurel districts, a sunset mode and original captioned team briefings. Event watches observe actual race conditions rather than substituting unrelated still images. Export a current PNG and record the remaining discrepancy before declaring any comparison accepted.</p><div class="reference-list">${REFERENCES.map((entry) => `<details data-reference="${entry.id}" data-kind="${entry.status}"><summary><b>${String(entry.id).padStart(3, '0')}</b><span>${escapeHtml(entry.title)}</span><small>${entry.status.toUpperCase()}</small></summary><p><b>Observed</b> — ${escapeHtml(entry.observation)}</p>${entry.duplicateOf ? `<p>Repeated/variant composition of <b>${String(entry.duplicateOf).padStart(3, '0')}</b>; not a new independent feature.</p>` : ''}<p><b>In the game</b> — ${escapeHtml(entry.implementation)}</p>${referenceRoute(entry) ? `<button class="reference-inspect" data-action="reference:${entry.id}">${referenceRoute(entry)!.label}</button>` : '<p>Unrelated reference — intentionally no game feature.</p>'}${referenceEvent(entry.id) && referenceRoute(entry)?.destination !== 'event' ? `<button data-action="eventReference:${entry.id}">WATCH ACTUAL ${referenceEvent(entry.id)!.kind.toUpperCase()}</button>` : ''}<p><b>How to inspect</b> — ${escapeHtml(entry.view)}</p><p><b>Still missing / limitation</b> — ${escapeHtml(entry.gap)}</p><p><code>${escapeHtml(entry.file)} · ${entry.width} × ${entry.height}<br>${entry.sha256}<br>${entry.code.join('<br>')}</code></p>${evidenceForm(entry.id, context)}</details>`).join('')}</div></div>`;
}
export function bindReferenceReview(root: HTMLElement, context?: ReferenceReviewContext) {
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
  if (context) {
    root.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const save = target.closest<HTMLElement>('[data-audit-save]');
      if (save && root.contains(save)) {
        const id = Number(save.dataset.auditSave),
          message = root.querySelector<HTMLOutputElement>(`#qualityMessage${id}`)!;
        try {
          context.store.decide(
            id,
            root.querySelector<HTMLSelectElement>(`#qualityChoice${id}`)!.value as AcceptanceStatus,
            root.querySelector<HTMLInputElement>(`#qualityReviewer${id}`)!.value,
            root.querySelector<HTMLTextAreaElement>(`#qualityNotes${id}`)!.value,
            context.source,
          );
          root.querySelector<HTMLOutputElement>(`#qualityState${id}`)!.value = context.store
            .get(id, context.source)
            .status.toUpperCase();
          message.value = context.store.persistenceError ?? 'Comparison saved locally.';
        } catch (error) {
          message.value = error instanceof Error ? error.message : String(error);
        }
      }
      if (target.closest('[data-audit-export]')) {
        const blob = new Blob(
          [JSON.stringify(context.store.export(context.source), null, 2) + '\n'],
          { type: 'application/json' },
        );
        const url = URL.createObjectURL(blob),
          anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `apex-reference-acceptance-${context.source.slice(0, 12)}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    root
      .querySelector<HTMLInputElement>('[data-audit-import]')
      ?.addEventListener('change', async (event) => {
        const input = event.target as HTMLInputElement,
          file = input.files?.[0];
        const message = root.querySelector<HTMLOutputElement>('#auditMessage')!;
        if (!file) return;
        try {
          if (file.size > REFERENCE_AUDIT_LIMIT) throw new Error('Reference audit exceeds 3 MB');
          context.store.replace(await file.text());
          message.value =
            context.store.persistenceError ??
            'Imported. Reopen Reference Review to display the comparisons.';
        } catch (error) {
          message.value = error instanceof Error ? error.message : String(error);
        }
        input.value = '';
      });
  }
}
