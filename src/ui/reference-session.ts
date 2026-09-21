import { validateReferenceImage } from './reference-image.ts';
import type { RacingRenderer } from '../rendering/renderer.ts';
import {
  ReferenceEventWatch,
  referenceEvent,
  type ReferenceCamera,
} from '../rendering/reference-events.ts';
import { ReferenceEvidenceStore, referenceCapture } from './reference-evidence.ts';
import { REFERENCES } from './reference-catalogue.ts';
import { downloadBlob } from '../storage/data.ts';
import { escapeHtml } from './team-hub.ts';

export function referenceSessionPanel(id: number, canResume: boolean) {
  const entry = REFERENCES.find((e) => e.id === id),
    rule = referenceEvent(id);
  if (!entry || !rule) throw new Error('Unknown event reference');
  return `<section class="reference-event-config"><header><div><span class="eyebrow">REFERENCE ${String(id).padStart(3, '0')} / LIVE SCENE</span><h2>${escapeHtml(entry.title)}</h2></div><button data-action="modalClose">CLOSE</button></header>
  <div class="event-requirements"><article><small>CAMERA</small><b>${rule.camera.toUpperCase()}</b></article><article><small>OBSERVATION</small><b>${rule.kind.toUpperCase()}</b></article><article><small>CONTINUOUS HOLD</small><b>${rule.holdSeconds.toFixed(1)} s</b></article></div>
  <p>${escapeHtml(rule.instruction)}</p><p>This watch reads actual worker/replay snapshots. It selects the requested camera, but does not move cars, request a pit stop, turn on rain, alter physics or silently enable AI driving. All automation remains labelled.</p>
  <div class="event-scope"><b>What is captured</b><p>When the condition is observed, the current production canvas is captured and hashed immediately. The JSON records the event, source, camera and framing diagnostics. The PNG does <strong>not</strong> include the HTML HUD; capture a full application screenshot separately for HUD references. An observed condition is not human, audiovisual or artistic acceptance.</p></div>
  <div class="team-actions"><button class="primary" data-action="eventReview:arm:${id}">${canResume ? 'RESUME & WATCH THIS SESSION' : 'ARM FOR NEXT SESSION'}</button><button data-action="references">ALL REFERENCE FINDINGS</button></div></section>`;
}

/** Opt-in controller for live event evidence. The canvas is read in the same
 * task as the production draw, not reconstructed later from a different frame.
 * It adds no work to ordinary driving while inactive. */
export class ReferenceSessionReview {
  readonly watch = new ReferenceEventWatch();
  private pending: number | null = null;
  private readonly panel: HTMLElement;
  private blob: Blob | null = null;
  private imageFile = '';
  private generation = 0;
  private captureState = 'No capture.';
  private displayKey = '';
  private disposed = false;
  constructor(
    parent: HTMLElement,
    private source: string,
    private store: ReferenceEvidenceStore,
  ) {
    this.panel = document.createElement('aside');
    this.panel.className = 'reference-live';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Reference scene observation');
    this.panel.innerHTML =
      '<b data-event-title></b><output data-event-status aria-live="polite"></output><small data-event-capture></small><div><button data-action="eventReview:image">PNG</button><button data-action="eventReview:export">JSON</button><button data-action="eventReview:close" aria-label="Stop reference observation">CLOSE</button></div>';
    parent.append(this.panel);
  }
  arm(id: number, session: string | null, replay = false): ReferenceCamera {
    const rule = referenceEvent(id);
    if (!rule) throw new Error('No live reference event');
    this.generation++;
    this.blob = null;
    this.imageFile = '';
    this.captureState = 'No capture.';
    this.displayKey = '';
    if (session) {
      this.pending = null;
      this.watch.arm(id, this.source, session, replay);
    } else {
      this.watch.clear();
      this.pending = id;
    }
    this.render();
    return rule.camera;
  }
  beginSession(session: string): ReferenceCamera | null {
    if (this.pending === null) {
      this.watch.interrupt('A new session started.');
      this.render();
      return null;
    }
    return this.arm(this.pending, session, false);
  }
  sample(renderer: RacingRenderer, session: string, replay: boolean, automated: boolean) {
    if (!this.watch.active) return;
    this.watch.sample(
      renderer.presented.value,
      renderer.reviewCar(),
      renderer.mode,
      session,
      replay,
      automated,
    );
    const report = this.watch.report();
    if (report?.status === 'observed') {
      const token = this.generation;
      this.captureState = 'Encoding observed canvas…';
      const imageFile = `apex-reference-${String(report.reference).padStart(3, '0')}-event-${this.source.slice(0, 12)}.png`;
      const stats = renderer.stats();
      const meta = {
        source: this.source,
        imageFile,
        capturedAt: new Date().toISOString(),
        simulationTime: report.lastTime,
        width: renderer.canvas.width,
        height: renderer.canvas.height,
        view: JSON.stringify({
          kind: 'production-canvas-only',
          htmlHudIncluded: false,
          event: report,
          cameraPosition: renderer.camera.position.toArray(),
          cameraQuaternion: renderer.camera.quaternion.toArray(),
          lighting: renderer.lighting,
          broadcast: {
            rig: stats.tracksideRig,
            occluded: stats.broadcastOccluded,
            radius: stats.broadcastSubjectRadius,
          },
        }),
      };
      void renderer
        .capturePhoto()
        .then(async (blob) => {
          if (blob.size === 0 || blob.size > 16 * 1024 * 1024)
            throw new Error('Event PNG is empty or exceeds 16 MiB');
          await validateReferenceImage(blob, meta.width, meta.height);
          const evidence = await referenceCapture(blob, report.reference, meta);
          if (this.disposed || token !== this.generation) return;
          this.blob = blob;
          this.imageFile = imageFile;
          this.store.capture(report.reference, evidence);
          this.captureState =
            this.store.persistenceError ??
            'Canvas PNG captured and hashed. Visual acceptance remains open.';
          this.render();
        })
        .catch((error) => {
          if (!this.disposed && token === this.generation) {
            this.captureState = `Capture failed: ${String(error)}`;
            this.render();
          }
        });
    }
    this.render();
  }
  interrupt(reason: string) {
    this.watch.interrupt(reason);
    this.render();
  }
  exportImage() {
    if (this.blob) downloadBlob(this.blob, this.imageFile);
  }
  exportReport() {
    const report = this.watch.report();
    if (!report) return;
    downloadBlob(
      new Blob(
        [
          JSON.stringify(
            {
              ...report,
              capture: this.store.get(report.reference, this.source).capture ?? null,
              captureState: this.captureState,
              htmlHudIncluded: false,
            },
            null,
            2,
          ) + '\n',
        ],
        { type: 'application/json' },
      ),
      `apex-reference-${String(report.reference).padStart(3, '0')}-event-${this.source.slice(0, 12)}.json`,
    );
  }
  clear() {
    this.generation++;
    this.pending = null;
    this.watch.clear();
    this.blob = null;
    this.imageFile = '';
    this.render();
  }
  private render() {
    const report = this.watch.report();
    this.panel.hidden = !report && this.pending === null;
    const id = report?.reference ?? this.pending;
    if (id === null) return;
    const title = `REFERENCE ${String(id).padStart(3, '0')} · ${report?.status.toUpperCase() ?? 'NEXT SESSION'}`;
    const status =
      report?.reason ??
      'Choose a race or practice session. The watch will use that session’s real conditions.';
    const key = title + status + this.captureState;
    if (key === this.displayKey) return;
    this.displayKey = key;
    this.panel.querySelector('[data-event-title]')!.textContent = title;
    this.panel.querySelector('[data-event-status]')!.textContent = status;
    this.panel.querySelector('[data-event-capture]')!.textContent = this.captureState;
    this.panel.querySelector<HTMLButtonElement>('[data-action="eventReview:image"]')!.disabled =
      !this.blob;
    this.panel.querySelector<HTMLButtonElement>('[data-action="eventReview:export"]')!.disabled =
      !report;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    this.blob = null;
    this.panel.remove();
  }
}
