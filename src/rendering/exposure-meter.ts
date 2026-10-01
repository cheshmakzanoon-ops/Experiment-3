/** Bounded photometric adaptation. All time is supplied by the presented
 * simulation clock: pausing, seeking and a late GPU result cannot advance it. */
export const METER_LOG_MIN = -12;
export const METER_LOG_RANGE = 24;
/** Exposed log2 luminance (scene log2 luminance plus log2 of the base
 * exposure) of the 90th-percentile meter sample in the authored look, by
 * lighting: the mean over chase, cockpit and trackside views at four points
 * of an Aurel lap at 0 EV, the exposure every review was made at. The bright
 * part of the frame follows the lit exterior in all three views (spread
 * 0.4 EV by day); a mean over asphalt and carbon reads 2 EV darker in the
 * cockpit and asked for +1.2 to +4.7 EV in every view, so the meter sat at
 * its +0.85 EV ceiling. */
export const METER_KEY = Object.freeze({ day: -2.44, sunset: -3.6, night: -3.91 });
/** Share of the difference from the key that exposure follows. */
export const METER_RESPONSE = 0.5;
export interface ExposureObservation {
  logLuminance: number;
  highlightLogLuminance: number;
  validPixels: number;
  trimmedPixels: number;
}

/** The GPU encodes log2(linear luminance) into red and validity into alpha.
 * Trim both tails so a sun glint or an empty black margin cannot drive exposure. */
export function readExposureMeter(pixels: Uint8Array): ExposureObservation | null {
  if (!pixels.length || pixels.length % 4) throw new Error('Invalid exposure meter pixels');
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 250) continue;
    histogram[pixels[i]]++;
    count++;
  }
  if (count < 16) return null;
  const lower = Math.floor(count * 0.1),
    upper = count - Math.floor(count * 0.1);
  let cursor = 0,
    sum = 0,
    kept = 0,
    highlightBin = -1;
  for (let bin = 0; bin < 256; bin++) {
    const next = cursor + histogram[bin];
    if (highlightBin < 0 && next >= Math.ceil(count * 0.9)) highlightBin = bin;
    const weight = Math.max(0, Math.min(next, upper) - Math.max(cursor, lower));
    sum += weight * (METER_LOG_MIN + (bin / 255) * METER_LOG_RANGE);
    kept += weight;
    cursor = next;
  }
  return kept
    ? {
        logLuminance: sum / kept,
        highlightLogLuminance: METER_LOG_MIN + (highlightBin / 255) * METER_LOG_RANGE,
        validPixels: count,
        trimmedPixels: count - kept,
      }
    : null;
}

export class ExposureAdaptation {
  ev = 0;
  targetEV = 0;
  samples = 0;
  private previousTime = NaN;
  private identity = '';
  generation = 0;
  reset() {
    this.ev = this.targetEV = 0;
    this.samples = 0;
    this.previousTime = NaN;
    this.identity = '';
    this.generation++;
  }
  /** Camera cuts discard asynchronous samples of the old view, not the viewer's
   * already adapted exposure. A seek still resets through step's time checks. */
  reframe(identity: string) {
    if (!identity) throw new Error('Invalid exposure view identity');
    this.identity = identity;
    this.targetEV = this.ev;
    this.samples = 0;
    this.generation++;
  }
  step(time: number, identity: string, active: boolean) {
    if (!Number.isFinite(time) || time < 0 || !identity) throw new Error('Invalid exposure clock');
    if (
      identity !== this.identity ||
      (Number.isFinite(this.previousTime) &&
        (time < this.previousTime || time - this.previousTime > 2))
    ) {
      this.reset();
      this.identity = identity;
    }
    const dt = Number.isFinite(this.previousTime)
      ? Math.min(0.25, Math.max(0, time - this.previousTime))
      : 0;
    this.previousTime = time;
    if (active && dt > 0 && this.samples) {
      const tau = this.targetEV < this.ev ? 0.35 : 1.6;
      this.ev += (this.targetEV - this.ev) * -Math.expm1(-dt / tau);
    }
    return active ? 2 ** this.ev : 1;
  }
  observe(
    logLuminance: number,
    baseExposure: number,
    generation: number,
    highlightLogLuminance?: number,
    key: number = METER_KEY.day,
  ) {
    if (!Number.isFinite(logLuminance) || !Number.isFinite(baseExposure) || baseExposure <= 0)
      throw new Error('Invalid photometric observation');
    if (highlightLogLuminance !== undefined && !Number.isFinite(highlightLogLuminance))
      throw new Error('Invalid highlight observation');
    if (!Number.isFinite(key)) throw new Error('Invalid exposure key');
    if (generation !== this.generation) return false;
    // Authored day/sunset/night exposure remains the artistic baseline:
    // adaptation follows half of the bright region's departure from the key
    // for that lighting, within -0.7..+0.85 EV, so a night scene never turns
    // into daylight. A small glint stays outside the 90th percentile; a broad
    // bright region pulls exposure down.
    const bright = highlightLogLuminance ?? logLuminance;
    const departure = key - bright - Math.log2(baseExposure);
    this.targetEV = Math.max(-0.7, Math.min(0.85, METER_RESPONSE * departure));
    this.samples++;
    return true;
  }
}
