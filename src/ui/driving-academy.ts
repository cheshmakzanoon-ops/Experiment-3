import type { LightingMode } from '../rendering/daylight.ts';
import type { GuideMode } from '../rendering/driving-guide.ts';
import type { PracticeProgress } from '../simulation/practice-programme.ts';
import { escapeHtml } from './team-hub.ts';
export function programmeTime(seconds: number) {
  return Number.isFinite(seconds) && seconds > 0
    ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(3).padStart(6, '0')}`
    : '—';
}
export function drivingAcademy(
  progress: PracticeProgress,
  guide: GuideMode,
  night: boolean,
  illumination: LightingMode = night ? 'night' : 'day',
) {
  return `<section class="driving-academy"><header><div><span class="eyebrow">DRIVING ACADEMY / REFERENCES 034 · 037 · 070 · 072 · 074 · 089 · 097</span><h2>Find your repeatable lap.</h2></div><button data-action="modalClose">CLOSE</button></header>
  <p>A five-attempt consistency programme, measured at actual start/finish crossings. Your first clean, human-driven lap locks the target. Subsequent attempts earn gold at or below it, silver within 2%, or bronze within 5%.</p>
  <div class="academy-controls"><fieldset><legend>ON-TRACK GUIDANCE</legend>${(['off', 'corners', 'full'] as const).map((mode) => `<button data-action="guide:${mode}" aria-pressed="${guide === mode}">${mode.toUpperCase()}</button>`).join('')}<p>Road-centre chevrons estimate braking from the circuit geometry. This is not an optimal racing line, collision avoidance or automatic steering. Yellow flags and wet surfaces lower the advisory speed; traffic always has priority.</p></fieldset><fieldset><legend>CIRCUIT LIGHTING</legend><button data-action="lighting:day" aria-pressed="${illumination === 'day'}">DAY</button><button data-action="lighting:sunset" aria-pressed="${illumination === 'sunset'}">SUNSET</button><button data-action="lighting:night" aria-pressed="${night}">NIGHT</button><p>A low warm sun with matching shadows and environment reflections at sunset; original floodlights and a trackside LED landmark at night. Presentation only: selecting night does not secretly change weather, tyre temperature, grip or the simulation clock.</p></fieldset></div>
  <p class="academy-warning">Traffic awareness: left/right arrows show nearby cars using their physical positions and your heading. A larger arrow indicates overlap. They are warnings, not permission to change lanes.</p>
  <div class="academy-score"><span>${progress.finished ? 'COMPLETE' : progress.active ? 'IN PROGRESS' : 'READY TO START'}</span><strong>${progress.attempts.length} / 5</strong><label>LOCKED TARGET <b>${programmeTime(progress.target)}</b></label></div>
  <ol class="academy-attempts">${Array.from({ length: 5 }, (_, index) => {
    const lap = progress.attempts[index];
    return `<li data-grade="${lap?.grade ?? 'pending'}"><span>ATTEMPT ${index + 1}</span><b>${lap ? programmeTime(lap.seconds) : '—'}</b><strong>${lap?.grade.toUpperCase() ?? 'WAITING'}</strong><small>${escapeHtml(lap?.reason ?? 'Complete the next measured lap.')}</small></li>`;
  }).join('')}</ol><p role="status">${escapeHtml(progress.message)}</p>
  <div class="team-actions"><button class="primary" data-action="academy:start">START NEW FIVE-ATTEMPT SESSION</button>${progress.active ? '<button data-action="academy:stop">STOP PROGRAMME</button>' : ''}<button data-action="references">REFERENCE REVIEW</button></div>
  <p class="academy-warning">Starting replaces the current session and its replay with a fresh solo, dry, medium-tyre practice session. A second confirmation is required. ABS/traction control follow your selected assist profile. AI demonstration, pit assist, invalid laps and missed crossings cannot earn clean human awards. No online ranking is claimed.</p></section>`;
}
export function academyConfirmation() {
  return `<section class="driving-academy"><span class="eyebrow">NEW PRACTICE SESSION</span><h2>Replace the current session?</h2><p>Your current session and replay will be cleared. Saved livery, team finances, settings and research are kept. The new programme starts solo on a dry circuit with medium tyres.</p><div class="team-actions"><button class="primary" data-action="academy:confirm">REPLACE & START</button><button data-action="academy">KEEP CURRENT SESSION</button></div></section>`;
}
export function programmeHud(progress: PracticeProgress, replay: boolean) {
  if (!progress.active) return '';
  if (replay) return 'REPLAY · PRACTICE AWARDS PAUSED';
  return `${progress.finished ? 'PROGRAMME COMPLETE' : 'CONSISTENCY'} · ${progress.attempts.length}/5 · ${progress.target ? `TARGET ${programmeTime(progress.target)}` : 'BANK A CLEAN LAP'}${progress.attempts.length ? ` · ${progress.attempts.at(-1)!.grade.toUpperCase()}` : ''}`;
}
