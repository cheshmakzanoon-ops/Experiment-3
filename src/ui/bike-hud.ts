import styles from './bike-hud.css?inline';
import { bikeReadout } from './bike-readout.ts';
import { GPRidingCues } from './gp-riding-cues.ts';
import { GpCornerPractice, type GpPracticeContext } from './gp-corner-practice.ts';
import { H } from '../simulation/protocol.ts';
import type { Track } from '../simulation/track.ts';

/** Reflows the live speed/gear/controls into a peripheral GP cluster and adds
 * only motorcycle-specific channels. It shares Interface's snapshot clock. */
export class BikeHud {
  private readonly nodes: Record<string, HTMLElement> = {};
  private readonly ridingCues = new GPRidingCues();
  private readonly practice = new GpCornerPractice();
  constructor(private readonly hud: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = styles;
    const feedback = document.createElement('div');
    feedback.className = 'gp-feedback';
    feedback.setAttribute('aria-label', 'Motorcycle telemetry');
    feedback.innerHTML = `
      <div id="gpCraft" class="gp-craft" hidden aria-label="Corner and slipstream guide">
        <div class="gp-next"><b id="gpTurnArrow" aria-hidden="true">↑</b><span id="gpCorner">STRAIGHT</span><small id="gpCornerDistance"></small></div>
        <div id="gpCornerProgress" class="gp-phase" hidden role="meter" aria-label="Corner progress" aria-valuemin="0" aria-valuemax="100"><span>ENTRY</span><span>APEX</span><span>EXIT</span><i id="gpPhaseFill" aria-hidden="true"></i></div>
        <div class="gp-cue"><b id="gpAction"></b><span id="gpTow" hidden></span></div><small id="gpAdvice"></small>
        <div id="gpPractice" class="gp-practice" hidden aria-label="Personal corner practice"><span id="gpPracticeLabel"></span><b id="gpPracticeTime"></b><small id="gpPracticeDetail"></small></div>
      </div>
      <div class="gp-lean"><span>LEAN</span><div class="gp-lean-track" aria-hidden="true"><i id="gpLeanMarker"></i></div><b id="gpLean">0°</b></div>
      <div class="gp-rear-brake" title="Independent rear-brake pedal input; combined braking assistance can also apply the rear brake"><span>REAR PEDAL</span><div aria-hidden="true"><i id="gpRearBrakeBar"></i></div><b id="gpRearBrake">0%</b></div>
      <div class="gp-tyres"><div><span>FRONT</span><b id="gpFrontTemp">—</b><small id="gpFrontLife">—</small></div><div><span>REAR</span><b id="gpRearTemp">—</b><small id="gpRearLife">—</small></div></div>
      <div class="gp-rider"><span id="gpRiderState">RIDING</span><span id="gpTuck">TUCK 0%</span><b id="gpElectronics" title="Combined traction and wheelie control intervention">TC/WC 0%</b></div>`;
    const heading = document.createElement('div');
    heading.className = 'gp-heading';
    heading.innerHTML = '<span id="gpSeries">GP / LIVE</span><b id="gpMachine">MOTORCYCLE</b>';
    const cluster = hud.querySelector('.instruments')!;
    cluster.prepend(heading);
    cluster.append(feedback);
    hud.append(style);
    for (const node of [
      ...feedback.querySelectorAll<HTMLElement>('[id]'),
      ...heading.querySelectorAll<HTMLElement>('[id]'),
    ])
      this.nodes[node.id] = node;
    this.nodes.gpWordmark = hud.querySelector('.f1-wordmark')!;
    hud.dataset.bike = 'false';
  }
  resetPractice() {
    this.practice.reset();
    this.nodes.gpPractice.hidden = true;
  }
  suspendPractice() {
    this.practice.suspend();
    this.nodes.gpPractice.hidden = true;
  }
  /** Timing consumes each original worker snapshot, independently of drawing.
   * PresentedFrame has an interpolated clock but discrete track stations. */
  observePractice(frame: Float32Array, track: Track, context: GpPracticeContext) {
    this.practice.observe(frame, track, context);
  }
  update(frame: Float32Array, track?: Track) {
    // MX has its own jump/landing status stack and tested instrument layout.
    // Keeping this flag exclusive prevents the GP stylesheet from replacing
    // that cluster or showing a second motorcycle telemetry panel.
    const readout = this.hud.dataset.motocross === 'true' ? null : bikeReadout(frame);
    const active = String(readout !== null);
    if (this.hud.dataset.bike !== active) {
      this.hud.dataset.bike = active;
      const labels = this.hud.querySelectorAll<HTMLElement>('#tires > div > label');
      labels.forEach((node, i) => {
        node.textContent = readout
          ? ['FRONT', 'FRONT', 'REAR', 'REAR'][i]
          : ['FR', 'FL', 'RR', 'RL'][i];
      });
      this.hud.querySelector('[data-touch="brake"]')!.textContent = readout
        ? 'FRONT BRAKE'
        : 'BRAKE';
      if (!readout) this.nodes.gpWordmark.textContent = 'APEX';
      for (const side of ['Left', 'Right'])
        this.hud.querySelector(`#proximity${side} > span`)!.textContent =
          `${readout ? 'RIDER' : 'CAR'} ${side.toUpperCase()}`;
    }
    if (!readout) {
      this.nodes.gpPractice.hidden = true;
      return;
    }
    const set = (id: string, text: string) => {
      if (this.nodes[id].textContent !== text) this.nodes[id].textContent = text;
    };
    set('gpMachine', readout.name);
    set('gpSeries', `${readout.discipline} / LIVE`);
    set('gpWordmark', readout.discipline);
    set(
      'gpLean',
      `${readout.lean > 0 ? 'L ' : readout.lean < 0 ? 'R ' : ''}${Math.abs(readout.lean)}°`,
    );
    this.nodes.gpLeanMarker.style.left = `${50 - (readout.lean / 90) * 46}%`;
    set('gpRearBrake', `${readout.rearBrake}%`);
    this.nodes.gpRearBrakeBar.style.width = `${readout.rearBrake}%`;
    for (const [key, tyre] of [
      ['Front', readout.front],
      ['Rear', readout.rear],
    ] as const) {
      set(`gp${key}Temp`, `${tyre.temperature}°C`);
      set(`gp${key}Life`, tyre.punctured ? 'PUNCTURE' : `${tyre.life}% LIFE`);
      this.nodes[`gp${key}Life`].dataset.punctured = String(tyre.punctured);
    }
    set('gpRiderState', readout.state);
    set('gpTuck', `TUCK ${readout.tuck}%`);
    set('gpElectronics', `TC/WC ${readout.intervention}%`);
    this.nodes.gpElectronics.dataset.active = String(readout.intervention > 0);
    const cue = track ? this.ridingCues.read(frame, track) : null;
    const attempt = this.practice.active,
      result = this.practice.last;
    const showPractice = !!cue && cue.tone !== 'caution' && this.practice.eligible;
    const showResult =
      !attempt && result && frame[H.TIME] >= result.at && frame[H.TIME] - result.at < 6;
    this.nodes.gpPractice.hidden = !(showPractice && (attempt || showResult));
    if (!this.nodes.gpPractice.hidden) {
      const improved = !!showResult && result!.delta !== null && result!.delta < -0.005;
      this.nodes.gpPractice.dataset.improved = String(improved);
      set(
        'gpPracticeLabel',
        attempt
          ? `T${attempt.corner.index + 1} · PRACTICE`
          : `T${result!.corner.index + 1} · ${improved ? 'NEW BEST' : 'CORNER TIME'}`,
      );
      set('gpPracticeTime', `${(attempt?.elapsed ?? result!.seconds).toFixed(2)} s`);
      set(
        'gpPracticeDetail',
        attempt
          ? attempt.best === null
            ? 'Bank a clean entry-to-exit run'
            : `Your best ${attempt.best.toFixed(2)} s`
          : `${result!.delta === null ? 'First clean run' : `${result!.delta < -0.005 ? '−' : '+'}${Math.abs(result!.delta).toFixed(2)} s`} · exit ${Math.round(result!.exitSpeed * 3.6)} km/h · ${result!.condition}`,
      );
    }
    this.nodes.gpCraft.hidden = !cue;
    if (cue) {
      set('gpCorner', cue.corner);
      set(
        'gpTurnArrow',
        cue.direction === 'left'
          ? '↰'
          : cue.direction === 'right'
            ? '↱'
            : cue.direction === 'straight'
              ? '↑'
              : '·',
      );
      set('gpCornerDistance', cue.distance);
      set('gpAction', cue.action);
      set('gpAdvice', cue.detail);
      const meter = this.nodes.gpCornerProgress,
        hidden = cue.phase === 'none',
        value = String(Math.round(cue.progress * 100)),
        description = `${hidden ? 'No corner' : cue.phase}, ${cue.corner}`,
        transform = `scaleX(${Math.round(cue.progress * 10000) / 10000})`;
      if (meter.hidden !== hidden) meter.hidden = hidden;
      if (meter.dataset.phase !== cue.phase) meter.dataset.phase = cue.phase;
      if (meter.getAttribute('aria-valuenow') !== value) meter.setAttribute('aria-valuenow', value);
      if (meter.getAttribute('aria-valuetext') !== description)
        meter.setAttribute('aria-valuetext', description);
      if (this.nodes.gpPhaseFill.style.transform !== transform)
        this.nodes.gpPhaseFill.style.transform = transform;
      this.nodes.gpCraft.dataset.tone = cue.tone;
      this.nodes.gpTow.hidden = cue.tow < 0.08;
      set('gpTow', `TOW ${Math.round(cue.tow * 100)}%`);
      this.nodes.gpCorner.setAttribute(
        'aria-label',
        cue.direction === 'none' ? cue.corner : `${cue.corner}, ${cue.direction}`,
      );
    }
  }
}
