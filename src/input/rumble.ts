import { clamp } from '../core/math.ts';
import { F, W, WHEEL_BASE, WHEEL_STRIDE, carBase } from '../simulation/protocol.ts';

/** Gamepad rumble with separately adjustable channels (D088, §21.2):
 * traction (wheelspin/lockup), impact (contacts and kerb/curb loads) and
 * engine texture. It is a cue, not force feedback, and never claims to be. */
export interface RumbleSettings {
  traction: number;
  impact: number;
  engine: number;
}
export const DEFAULT_RUMBLE: Readonly<RumbleSettings> = Object.freeze({
  traction: 0.5,
  impact: 0.5,
  engine: 0,
});
export function validateRumble(value: unknown): RumbleSettings {
  const p = value && typeof value === 'object' ? (value as Partial<RumbleSettings>) : {};
  const level = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : fallback;
  return {
    traction: level(p.traction, DEFAULT_RUMBLE.traction),
    impact: level(p.impact, DEFAULT_RUMBLE.impact),
    engine: level(p.engine, DEFAULT_RUMBLE.engine),
  };
}
/** Weak (high-frequency) and strong (low-frequency) motor magnitudes for the
 * player car from one authoritative snapshot. */
export function rumbleFrom(frame: Float32Array, settings: RumbleSettings, limiterRPM = 13700) {
  const o = carBase(0);
  let slip = 0,
    kerb = 0;
  for (let i = 0; i < 4; i++) {
    const p = o + WHEEL_BASE + i * WHEEL_STRIDE;
    slip = Math.max(slip, Math.abs(frame[p + W.SLIP]));
    kerb = Math.max(kerb, frame[p + W.SURFACE] === 2 ? 1 : 0);
  }
  const speed = Math.abs(frame[o + F.SPEED]);
  const traction = clamp((slip - 0.12) / 0.3, 0, 1) * clamp(speed / 8, 0, 1) * settings.traction;
  const impact =
    clamp(frame[o + F.IMPACT] + kerb * 0.35 * clamp(speed / 20, 0, 1), 0, 1) * settings.impact;
  const engine = clamp(frame[o + F.RPM] / limiterRPM, 0, 1) * 0.25 * settings.engine;
  return {
    weak: clamp(traction + engine, 0, 1),
    strong: clamp(impact, 0, 1),
  };
}
type RumblePad = Pick<Gamepad, 'vibrationActuator'>;
/** Rate-limits each actuator to 10 updates per second and stops its output when asked. */
export class Rumble {
  private sentAt = -Infinity;
  private active = false;
  private actuator: GamepadHapticActuator | null = null;
  private generation = 0;
  private release() {
    const actuator = this.actuator;
    // The selected pad may already be gone or replaced. Revoke ownership
    // before asking the actuator that actually received output to stop.
    this.actuator = null;
    this.active = false;
    this.sentAt = -Infinity;
    this.generation++;
    try {
      void actuator?.reset?.()?.catch(() => undefined);
    } catch {
      // Disconnected/unsupported hardware must not interrupt the game loop.
    }
  }
  update(pad: RumblePad | null, magnitudes: { weak: number; strong: number }, now: number) {
    const actuator = pad?.vibrationActuator ?? null;
    if (this.actuator && actuator !== this.actuator) this.release();
    if (!actuator?.playEffect || !Number.isFinite(now)) return;
    const quiet = magnitudes.weak < 0.02 && magnitudes.strong < 0.02;
    if (quiet && !this.active) return;
    // A changed clock origin starts a fresh deadline instead of suppressing
    // the device until an old session's timestamp is reached again.
    if (now >= this.sentAt && now - this.sentAt < 100) return;
    const generation = ++this.generation;
    this.actuator = actuator;
    this.sentAt = now;
    this.active = !quiet;
    const failed = () => {
      // A rejected older effect cannot stop a newer one, even on the same pad.
      if (this.generation === generation && this.actuator === actuator) this.release();
    };
    try {
      void actuator
        .playEffect('dual-rumble', {
          duration: 120,
          weakMagnitude: quiet ? 0 : magnitudes.weak,
          strongMagnitude: quiet ? 0 : magnitudes.strong,
        })
        .catch(failed);
    } catch {
      failed();
    }
  }
  /** Pause, focus loss, disconnect and menus: no stale vibration survives. */
  stop(_pad: RumblePad | null) {
    this.release();
  }
}
