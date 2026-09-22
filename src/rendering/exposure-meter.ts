/** Bounded photometric adaptation. All time is supplied by the presented
 * simulation clock: pausing, seeking and a late GPU result cannot advance it. */
export const METER_LOG_MIN = -12;
export const METER_LOG_RANGE = 24;
export interface ExposureObservation {
  logLuminance: number;
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
    kept = 0;
  for (let bin = 0; bin < 256; bin++) {
    const next = cursor + histogram[bin];
    const weight = Math.max(0, Math.min(next, upper) - Math.max(cursor, lower));
    sum += weight * (METER_LOG_MIN + (bin / 255) * METER_LOG_RANGE);
    kept += weight;
    cursor = next;
  }
  return kept
    ? { logLuminance: sum / kept, validPixels: count, trimmedPixels: count - kept }
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
  step(time: number, identity: string, active: boolean) {
    if (!Number.isFinite(time) || time < 0 || !identity) throw new Error('Invalid exposure clock');
    if (
      identity !== this.identity ||
      (Number.isFinite(this.previousTime) && time < this.previousTime)
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
  observe(logLuminance: number, baseExposure: number, generation: number) {
    if (!Number.isFinite(logLuminance) || !Number.isFinite(baseExposure) || baseExposure <= 0)
      throw new Error('Invalid photometric observation');
    if (generation !== this.generation) return false;
    // Authored day/night exposure remains the artistic baseline. Adaptation is
    // deliberately restrained: never turn a night scene into daylight.
    this.targetEV = Math.max(-0.7, Math.min(0.85, Math.log2(0.22 / baseExposure) - logLuminance));
    this.samples++;
    return true;
  }
}
